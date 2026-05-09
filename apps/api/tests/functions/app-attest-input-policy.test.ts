import { expect, test } from "bun:test";
import { createHMAC } from "@/functions/hmac";
import app from "@/index";
import {
	ATTEST_CHALLENGE_RATE_LIMIT_MAX,
	checkAttestChallengeRateLimit,
	resolveAttestChallengeRateLimitIdentity,
} from "@/v1/verify/attest-handlers";

const JSON_HEADERS = {
	"Content-Type": "application/json",
} as const;
const VALID_SHAPED_CHALLENGE = "a".repeat(43);
const OVERSIZED_ATTESTATION = "A".repeat(90_000);

test("rejects App Attest registration with malformed challenges", async () => {
	const response = await app.request("/v1/verify/attest/register", {
		body: JSON.stringify({
			attestation: "AA==",
			challenge: "not-a-generated-challenge",
			key_id: "test-key-id",
		}),
		headers: JSON_HEADERS,
		method: "POST",
	});

	expect(response.status).toBe(400);
});

test("rejects oversized App Attest registration payloads before decode", async () => {
	const response = await app.request("/v1/verify/attest/register", {
		body: JSON.stringify({
			attestation: OVERSIZED_ATTESTATION,
			challenge: VALID_SHAPED_CHALLENGE,
			key_id: "test-key-id",
		}),
		headers: JSON_HEADERS,
		method: "POST",
	});

	expect(response.status).toBe(400);
});

test("rate-limits App Attest challenge minting per resolved client identity", async () => {
	const counts = new Map<string, number>();
	const ttlByKey = new Map<string, number>();
	const store = {
		expire: async (key: string, seconds: number) => {
			ttlByKey.set(key, seconds);
			return 1;
		},
		incr: async (key: string) => {
			const next = (counts.get(key) ?? 0) + 1;
			counts.set(key, next);
			return next;
		},
		ttl: async (key: string) => ttlByKey.get(key) ?? -1,
	};

	for (let index = 0; index < ATTEST_CHALLENGE_RATE_LIMIT_MAX; index += 1) {
		const allowed = await checkAttestChallengeRateLimit({
			identity: "203.0.113.10",
			secret: "test-secret",
			store,
		});
		expect(allowed.ok).toBe(true);
	}

	const limited = await checkAttestChallengeRateLimit({
		identity: "203.0.113.10",
		secret: "test-secret",
		store,
	});

	expect(limited.ok).toBe(false);
	expect(limited.retryAfterSeconds).toBe(60);
	expect(counts.size).toBe(1);
});

test("resolves App Attest challenge limits from trusted IP headers", async () => {
	expect(
		await resolveAttestChallengeRateLimitIdentity({
			headers: new Headers({
				"cf-connecting-ip": "203.0.113.10",
				"x-forwarded-client-ip": "198.51.100.99",
			}),
			internalToken: "test-token",
		}),
	).toBe("203.0.113.10");

	const serializedCf = JSON.stringify({ city: "London" });
	const signature = await createHMAC(serializedCf, {
		algorithm: "SHA256",
		secret: "test-token",
	});

	expect(
		await resolveAttestChallengeRateLimitIdentity({
			headers: new Headers({
				"x-cf-geolocation": btoa(serializedCf),
				"x-cf-signature": signature,
				"x-forwarded-client-ip": "198.51.100.20",
			}),
			internalToken: "test-token",
		}),
	).toBe("198.51.100.20");
	expect(
		await resolveAttestChallengeRateLimitIdentity({
			headers: new Headers({
				"x-forwarded-client-ip": "198.51.100.30",
			}),
			internalToken: "test-token",
		}),
	).toBe("anonymous");
	expect(
		await resolveAttestChallengeRateLimitIdentity({
			headers: new Headers(),
			internalToken: "test-token",
		}),
	).toBe("anonymous");
});
