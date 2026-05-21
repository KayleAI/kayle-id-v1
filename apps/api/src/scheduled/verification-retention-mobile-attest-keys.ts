import { db } from "@kayle-id/database/drizzle";
import {
	mobile_attest_keys,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, asc, eq, exists, inArray, lte, not, sql } from "drizzle-orm";
import {
	MOBILE_ATTEST_KEY_RETENTION_DAYS,
	subtractDays,
} from "./verification-retention-config";

export async function deleteStaleMobileAttestKeys({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(now, MOBILE_ATTEST_KEY_RETENTION_DAYS);
	const staleRows = await db
		.select({ keyId: mobile_attest_keys.keyId })
		.from(mobile_attest_keys)
		.where(
			and(
				lte(mobile_attest_keys.lastUsedAt, cutoff),
				not(
					exists(
						db
							.select({ presence: sql`1` })
							.from(verification_sessions)
							.where(
								eq(
									verification_sessions.mobileAttestKeyId,
									mobile_attest_keys.keyId,
								),
							),
					),
				),
			),
		)
		.orderBy(asc(mobile_attest_keys.lastUsedAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(mobile_attest_keys)
		.where(
			inArray(
				mobile_attest_keys.keyId,
				staleRows.map((row) => row.keyId),
			),
		)
		.returning({ keyId: mobile_attest_keys.keyId });

	return deletedRows.length;
}
