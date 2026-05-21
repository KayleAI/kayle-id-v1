import { db } from "@kayle-id/database/drizzle";
import { mobile_attest_keys } from "@kayle-id/database/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { base64ToBytes } from "./attest-gate-bytes";

export async function loadAttestKey(keyId: string): Promise<{
	counter: number;
	publicKeyCose: Uint8Array;
} | null> {
	const [row] = await db
		.select({
			counter: mobile_attest_keys.counter,
			publicKeyCose: mobile_attest_keys.publicKeyCose,
		})
		.from(mobile_attest_keys)
		.where(
			and(
				eq(mobile_attest_keys.keyId, keyId),
				eq(mobile_attest_keys.provider, "ios_app_attest"),
			),
		)
		.limit(1);

	if (!row?.publicKeyCose) {
		return null;
	}

	return {
		counter: row.counter,
		publicKeyCose: base64ToBytes(row.publicKeyCose),
	};
}

export async function persistCounterIfHigher({
	keyId,
	newCounter,
	previousCounter,
}: {
	keyId: string;
	newCounter: number;
	previousCounter: number;
}): Promise<boolean> {
	const result = await db
		.update(mobile_attest_keys)
		.set({
			counter: newCounter,
			lastUsedAt: new Date(),
		})
		.where(
			and(
				eq(mobile_attest_keys.keyId, keyId),
				sql`${mobile_attest_keys.counter} = ${previousCounter}`,
			),
		)
		.returning({ keyId: mobile_attest_keys.keyId });

	return result.length === 1;
}
