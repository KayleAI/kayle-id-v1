import { logEvent } from "@kayle-id/config/logging";
import { redis } from "@kayle-id/database/redis";
import type { Context } from "hono";
import { getRequestLogger } from "@/logging";
import { bytesToBase64Url } from "./app-attest-bytes";
import {
	ATTEST_CHALLENGE_BYTES,
	ATTEST_CHALLENGE_REDIS_PREFIX,
	ATTEST_CHALLENGE_TTL_SECONDS,
} from "./attest-handler-config";
import {
	checkAttestChallengeRateLimit,
	resolveAttestChallengeRateLimitIdentity,
} from "./attest-rate-limit";

export async function handleAttestChallenge(
	c: Context<{ Bindings: CloudflareBindings }>,
): Promise<Response> {
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
}
