import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, asc, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import {
	subtractDays,
	TERMINAL_SESSION_STATUSES,
	TERMINAL_VERIFICATION_SESSION_RETENTION_DAYS,
	VERIFICATION_ATTEMPT_MINIMIZATION_RETENTION_DAYS,
} from "./verification-retention-config";

export async function deleteTerminalVerificationSessions({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(
		now,
		TERMINAL_VERIFICATION_SESSION_RETENTION_DAYS,
	);
	const staleRows = await db
		.select({ id: verification_sessions.id })
		.from(verification_sessions)
		.where(
			and(
				inArray(verification_sessions.status, TERMINAL_SESSION_STATUSES),
				lte(
					sql<Date>`coalesce(${verification_sessions.completedAt}, ${verification_sessions.updatedAt}, ${verification_sessions.createdAt})`,
					cutoff,
				),
			),
		)
		.orderBy(asc(verification_sessions.createdAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(verification_sessions)
		.where(
			inArray(
				verification_sessions.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: verification_sessions.id });

	return deletedRows.length;
}

export async function minimizeVerificationSessionsPostTerminal({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(
		now,
		VERIFICATION_ATTEMPT_MINIMIZATION_RETENTION_DAYS,
	);
	const staleRows = await db
		.select({ id: verification_sessions.id })
		.from(verification_sessions)
		.where(
			and(
				inArray(verification_sessions.status, TERMINAL_SESSION_STATUSES),
				isNotNull(verification_sessions.completedAt),
				lte(verification_sessions.completedAt, cutoff),
				or(
					isNotNull(verification_sessions.failureCode),
					isNotNull(verification_sessions.mobileWriteTokenSeed),
					isNotNull(verification_sessions.mobileWriteTokenHash),
					isNotNull(verification_sessions.mobileWriteTokenIssuedAt),
					isNotNull(verification_sessions.mobileWriteTokenExpiresAt),
					isNotNull(verification_sessions.mobileWriteTokenConsumedAt),
					isNotNull(verification_sessions.mobileHelloDeviceIdHash),
					isNotNull(verification_sessions.mobileHelloAppVersion),
					isNotNull(verification_sessions.currentPhase),
					isNotNull(verification_sessions.phaseUpdatedAt),
					ne(verification_sessions.riskScore, 0),
					isNotNull(verification_sessions.claimedByConnectionId),
					isNotNull(verification_sessions.claimedAt),
					isNotNull(verification_sessions.mobileAttestKeyId),
				),
			),
		)
		.orderBy(asc(verification_sessions.completedAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const minimizedRows = await db
		.update(verification_sessions)
		.set({
			claimedAt: null,
			claimedByConnectionId: null,
			currentPhase: null,
			mobileAttestKeyId: null,
			mobileHelloAppVersion: null,
			mobileHelloDeviceIdHash: null,
			mobileWriteTokenConsumedAt: null,
			mobileWriteTokenExpiresAt: null,
			mobileWriteTokenHash: null,
			mobileWriteTokenIssuedAt: null,
			mobileWriteTokenSeed: null,
			phaseUpdatedAt: null,
			riskScore: 0,
		})
		.where(
			inArray(
				verification_sessions.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: verification_sessions.id });

	return minimizedRows.length;
}
