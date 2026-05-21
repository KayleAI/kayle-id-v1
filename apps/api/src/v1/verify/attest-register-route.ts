import { logEvent } from "@kayle-id/config/logging";
import type { Context, Handler } from "hono";
import { z } from "zod";
import { getRequestLogger } from "@/logging";
import { verifyAttestation } from "./app-attest";
import { base64ToBytes, base64UrlToBytes, sha256 } from "./app-attest-bytes";
import { resolveAppAttestEnvironment } from "./attest-gate";
import {
	ATTEST_CHALLENGE_BASE64URL_LENGTH,
	ATTEST_CHALLENGE_REDIS_PREFIX,
	BASE64URL_PATTERN,
	MAX_ATTESTATION_BASE64_LENGTH,
} from "./attest-handler-config";
import { attestJsonError } from "./attest-handler-errors";
import {
	consumeRedisKey,
	persistMobileAttestKey,
} from "./attest-register-store";
import { createVerifyJsonErrorResponse } from "./error-response";

export const registerBodySchema = z.object({
	key_id: z.string().min(1).max(512),
	attestation: z.string().min(1).max(MAX_ATTESTATION_BASE64_LENGTH),
	challenge: z
		.string()
		.length(ATTEST_CHALLENGE_BASE64URL_LENGTH)
		.regex(BASE64URL_PATTERN),
});

type AttestRegisterBody = z.infer<typeof registerBodySchema>;
type AttestRegisterInput = { out: { json: AttestRegisterBody } };

export function validateAttestRegisterBody(value: unknown, c: Context) {
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
}

export const handleAttestRegister: Handler<
	{ Bindings: CloudflareBindings },
	string,
	AttestRegisterInput,
	Promise<Response>
> = async (c) => {
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
		return attestJsonError(c, "HELLO_ATTEST_INVALID", 401);
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
		return attestJsonError(c, "INVALID_REQUEST", 400);
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
		return attestJsonError(c, "HELLO_ATTEST_INVALID", 401);
	}

	await persistMobileAttestKey({
		counter: result.counter,
		keyId: body.key_id,
		publicKeyCose: result.publicKeyCose,
		receipt: result.receipt,
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
};
