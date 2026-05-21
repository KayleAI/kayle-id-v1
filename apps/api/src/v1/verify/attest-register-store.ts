import { db } from "@kayle-id/database/drizzle";
import { redis } from "@kayle-id/database/redis";
import { mobile_attest_keys } from "@kayle-id/database/schema/core";
import { bytesToBase64 } from "./app-attest-bytes";

export async function consumeRedisKey(key: string): Promise<boolean> {
	const value = await redis.getdel<string>(key);
	return value !== null;
}

export async function persistMobileAttestKey({
	counter,
	keyId,
	publicKeyCose,
	receipt,
}: {
	counter: number;
	keyId: string;
	publicKeyCose: Uint8Array;
	receipt: Uint8Array;
}): Promise<void> {
	const publicKeyCoseBase64 = bytesToBase64(publicKeyCose);
	const receiptBase64 = bytesToBase64(receipt);
	const lastUsedAt = new Date();

	await db
		.insert(mobile_attest_keys)
		.values({
			keyId,
			provider: "ios_app_attest",
			publicKeyCose: publicKeyCoseBase64,
			counter,
			receipt: receiptBase64,
			receiptRefreshedAt: null,
			riskMetric: null,
			lastUsedAt,
		})
		.onConflictDoUpdate({
			target: mobile_attest_keys.keyId,
			set: {
				publicKeyCose: publicKeyCoseBase64,
				counter,
				receipt: receiptBase64,
				receiptRefreshedAt: null,
				riskMetric: null,
				lastUsedAt,
			},
		});
}
