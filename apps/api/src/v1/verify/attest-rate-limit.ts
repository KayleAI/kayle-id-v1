import { createHMAC } from "@/functions/hmac";
import { resolveTrustedClientIp } from "@/proxy-client-ip";
import {
	ANONYMOUS_CHALLENGE_RATE_LIMIT_ID,
	ATTEST_CHALLENGE_RATE_LIMIT_MAX,
	ATTEST_CHALLENGE_RATE_LIMIT_PREFIX,
	ATTEST_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS,
} from "./attest-handler-config";

export { ATTEST_CHALLENGE_RATE_LIMIT_MAX };

export interface AttestChallengeRateLimitStore {
	expire(key: string, seconds: number): Promise<unknown>;
	incr(key: string): Promise<number>;
	ttl(key: string): Promise<number>;
}

interface AttestChallengeRateLimitResult {
	ok: boolean;
	retryAfterSeconds: number;
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
