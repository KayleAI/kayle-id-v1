import { logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { redis } from "@kayle-id/database/redis";
import { mobile_attest_keys } from "@kayle-id/database/schema/core";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { createHMAC } from "@/functions/hmac";
import { getRequestLogger } from "@/logging";
import { resolveTrustedClientIp } from "@/proxy-client-ip";
import { verifyAttestation } from "./app-attest";
import { resolveAppAttestEnvironment } from "./attest-gate";
import { createVerifyJsonErrorResponse } from "./error-response";

const ATTEST_CHALLENGE_BYTES = 32;
const ATTEST_CHALLENGE_BASE64URL_LENGTH = 43;
const ATTEST_CHALLENGE_TTL_SECONDS = 5 * 60;
const ATTEST_CHALLENGE_REDIS_PREFIX = "attest:register_challenge:";
const ATTEST_CHALLENGE_RATE_LIMIT_PREFIX = "attest:challenge_rate:";
const ATTEST_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ATTEST_CHALLENGE_RATE_LIMIT_MAX = 20;
const ANONYMOUS_CHALLENGE_RATE_LIMIT_ID = "anonymous";
const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_ATTESTATION_BASE64_LENGTH =
	Math.ceil(MAX_ATTESTATION_BYTES / 3) * 4 + 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const attest = new Hono<{ Bindings: CloudflareBindings }>();

interface AttestChallengeRateLimitStore {
	expire(key: string, seconds: number): Promise<unknown>;
	incr(key: string): Promise<number>;
	ttl(key: string): Promise<number>;
}

interface AttestChallengeRateLimitResult {
	ok: boolean;
	retryAfterSeconds: number;
}

const registerBodySchema = z.object({
	key_id: z.string().min(1).max(512),
	attestation: z.string().min(1).max(MAX_ATTESTATION_BASE64_LENGTH),
	challenge: z
		.string()
		.length(ATTEST_CHALLENGE_BASE64URL_LENGTH)
		.regex(BASE64URL_PATTERN),
});

attest.get("/challenge", async (c) => {
	const log = getRequestLogger(c);
	const rateLimit = await checkAttestChallengeRateLimit({
		identity: await resolveAttestChallengeRateLimitIdentity({
			headers: c.req.raw.headers,
			internalToken: c.env.KAYLE_INTERNAL_TOKEN,
		}),
		secret: c.env.AUTH_SECRET as string,
		store: redis,
	});

	if (!rateLimit.ok) {
		return c.json(
			{
				data: null,
				error: {
					code: "ATTEST_CHALLENGE_RATE_LIMITED" as const,
					message: "Too many App Attest challenge requests. Try again later.",
				},
			},
			429,
			{
				"Retry-After": String(rateLimit.retryAfterSeconds),
			},
		);
	}

	const challengeBytes = crypto.getRandomValues(
		new Uint8Array(ATTEST_CHALLENGE_BYTES),
	);
	const challenge = bytesToBase64Url(challengeBytes);
	const issuedAt = new Date();

	await redis.set(
		`${ATTEST_CHALLENGE_REDIS_PREFIX}${challenge}`,
		issuedAt.toISOString(),
		{ ex: ATTEST_CHALLENGE_TTL_SECONDS, nx: true },
	);

	logEvent(log, {
		details: {
			ttl_seconds: ATTEST_CHALLENGE_TTL_SECONDS,
		},
		event: "verify.attest.challenge_issued",
	});

	return c.json(
		{
			data: {
				challenge,
				expires_at: new Date(
					issuedAt.getTime() + ATTEST_CHALLENGE_TTL_SECONDS * 1000,
				).toISOString(),
			},
			error: null,
		},
		200,
	);
});

attest.post(
	"/register",
	validator("json", (value, c) => {
		const parsed = registerBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		const response = createVerifyJsonErrorResponse({
			code: "INVALID_REQUEST",
			status: 400,
		});

		return c.json(
			{
				data: response.data,
				error: response.error,
			},
			response.status,
		);
	}),
	async (c) => {
		const body = c.req.valid("json");
		const log = getRequestLogger(c);

		const challengeKey = `${ATTEST_CHALLENGE_REDIS_PREFIX}${body.challenge}`;
		const consumed = await consumeRedisKey(challengeKey);
		if (!consumed) {
			logEvent(log, {
				details: { reason: "challenge_unknown_or_expired" },
				event: "verify.attest.register_failed",
				level: "warn",
			});
			return jsonError(c, "HELLO_ATTEST_INVALID", 401);
		}

		let attestationBytes: Uint8Array;
		let challengeBytes: Uint8Array;
		let keyIdBytes: Uint8Array;
		try {
			attestationBytes = base64ToBytes(body.attestation);
			challengeBytes = base64UrlToBytes(body.challenge);
			keyIdBytes = base64UrlToBytes(body.key_id);
		} catch {
			logEvent(log, {
				details: { reason: "request_encoding_invalid" },
				event: "verify.attest.register_failed",
				level: "warn",
			});
			return jsonError(c, "INVALID_REQUEST", 400);
		}

		const clientDataHash = await sha256(challengeBytes);
		const environment = resolveAppAttestEnvironment(c.env);

		const result = await verifyAttestation({
			attestationCbor: attestationBytes,
			clientDataHash,
			environment,
			keyId: keyIdBytes,
		});

		if (!result.ok) {
			logEvent(log, {
				details: {
					environment,
					reason: result.reason,
					detail: result.detail ?? null,
				},
				event: "verify.attest.register_failed",
				level: "warn",
			});
			return jsonError(c, "HELLO_ATTEST_INVALID", 401);
		}

		// Persist the attested key. Idempotent on key_id: if a row exists for
		// the same key already, refresh the public key + receipt and reset the
		// counter back to the attestation baseline (zero). This handles the
		// `DCError.invalidKey` rotation flow where the iOS client rotates a
		// key that already had a row server-side.
		await db
			.insert(mobile_attest_keys)
			.values({
				keyId: body.key_id,
				provider: "ios_app_attest",
				publicKeyCose: bytesToBase64(result.publicKeyCose),
				counter: result.counter,
				receipt: bytesToBase64(result.receipt),
				receiptRefreshedAt: null,
				riskMetric: null,
				lastUsedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: mobile_attest_keys.keyId,
				set: {
					publicKeyCose: bytesToBase64(result.publicKeyCose),
					counter: result.counter,
					receipt: bytesToBase64(result.receipt),
					receiptRefreshedAt: null,
					riskMetric: null,
					lastUsedAt: new Date(),
				},
			});

		logEvent(log, {
			details: { environment },
			event: "verify.attest.register_succeeded",
		});

		return c.json(
			{
				data: {
					ok: true,
				},
				error: null,
			},
			200,
		);
	},
);

export default attest;

// ---- helpers ----------------------------------------------------------------

function jsonError(
	c: Context,
	code: "HELLO_ATTEST_INVALID" | "INVALID_REQUEST",
	status: 400 | 401,
): Response {
	const response = createVerifyJsonErrorResponse({
		code,
		status,
	});

	return c.json(
		{
			data: response.data,
			error: response.error,
		},
		response.status,
	);
}

export async function resolveAttestChallengeRateLimitIdentity({
	headers,
	internalToken,
}: {
	headers: Headers;
	internalToken: string | undefined;
}): Promise<string> {
	return (
		(await resolveTrustedClientIp({ headers, internalToken })) ??
		ANONYMOUS_CHALLENGE_RATE_LIMIT_ID
	);
}

export async function checkAttestChallengeRateLimit({
	identity,
	secret,
	store,
}: {
	identity: string;
	secret: string;
	store: AttestChallengeRateLimitStore;
}): Promise<AttestChallengeRateLimitResult> {
	const key = `${ATTEST_CHALLENGE_RATE_LIMIT_PREFIX}${await createHMAC(
		identity,
		{
			algorithm: "SHA256",
			secret,
		},
	)}`;
	const count = await store.incr(key);

	if (count === 1) {
		await store.expire(key, ATTEST_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS);
	}

	if (count <= ATTEST_CHALLENGE_RATE_LIMIT_MAX) {
		return { ok: true, retryAfterSeconds: 0 };
	}

	const ttl = await store.ttl(key);
	const retryAfterSeconds =
		ttl > 0 ? ttl : ATTEST_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS;

	return {
		ok: false,
		retryAfterSeconds,
	};
}

async function consumeRedisKey(key: string): Promise<boolean> {
	// Upstash's `redis.getdel` returns the previous value or null. A null
	// indicates the key was missing or already consumed; either way, fail.
	const value = await redis.getdel<string>(key);
	return value !== null;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		toAlignedArrayBuffer(bytes),
	);
	return new Uint8Array(buffer);
}

function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

function base64UrlToBytes(input: string): Uint8Array {
	const padded = input.replace(/-/g, "+").replace(/_/g, "/");
	const padLen = (4 - (padded.length % 4)) % 4;
	return base64ToBytes(padded + "=".repeat(padLen));
}
