import {
	createSafeRequestLogger,
	logEvent,
	logSafeError,
} from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import {
	events,
	mobile_attest_keys,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNotNull,
	lte,
	ne,
	not,
	or,
	sql,
} from "drizzle-orm";

export const VERIFICATION_ATTEMPT_MINIMIZATION_RETENTION_DAYS = 7;
export const TERMINAL_VERIFICATION_SESSION_RETENTION_DAYS = 30;
export const VERIFICATION_EVENT_RETENTION_DAYS = 30;
export const VERIFICATION_AUDIT_LOG_RETENTION_DAYS = 365;
export const MOBILE_ATTEST_KEY_RETENTION_DAYS = 90;

const VERIFICATION_RETENTION_BATCH_SIZE = 500;
const RETENTION_SWEEP_UTC_HOUR = 2;
const RETENTION_SWEEP_UTC_MINUTE = 23;
const DAY_MS = 24 * 60 * 60_000;

const TERMINAL_SESSION_STATUSES = [
	"succeeded",
	"failed",
	"expired",
	"cancelled",
] as const;

const VERIFICATION_EVENT_TYPES = [
	"verification.session.succeeded",
	"verification.session.failed",
	"verification.session.expired",
	"verification.session.cancelled",
] as const;

const VERIFICATION_AUDIT_LOG_EVENTS = [
	"session.created",
	"session.cancelled",
	"session.expired",
	"session.succeeded",
	"session.check.failed",
	"session.failed",
] as const;

export type VerificationRetentionSweepResult = {
	deletedAuditLogCount: number;
	deletedEventCount: number;
	deletedMobileAttestKeyCount: number;
	deletedSessionCount: number;
	failed: boolean;
	minimizedAttemptCount: number;
};

function subtractDays(date: Date, days: number): Date {
	return new Date(date.getTime() - days * DAY_MS);
}

export function shouldRunVerificationRetentionSweep(
	scheduledTime: Date | number,
): boolean {
	const date =
		scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);

	return (
		date.getUTCHours() === RETENTION_SWEEP_UTC_HOUR &&
		date.getUTCMinutes() === RETENTION_SWEEP_UTC_MINUTE
	);
}

async function deleteTerminalVerificationSessions({
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

/**
 * Minimize terminal session rows by nulling out anything tied to the
 * specific attempt that was running before the session terminalized. The
 * session id, organization id, terminal status, and timestamps survive.
 */
async function minimizeVerificationSessionsPostTerminal({
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
				inArray(verification_sessions.status, [
					"succeeded",
					"failed",
					"expired",
					"cancelled",
				]),
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

async function deleteVerificationEvents({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(now, VERIFICATION_EVENT_RETENTION_DAYS);
	const staleRows = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				inArray(events.type, VERIFICATION_EVENT_TYPES),
				lte(events.createdAt, cutoff),
				not(
					exists(
						db
							.select({ presence: sql`1` })
							.from(webhook_deliveries)
							.where(
								and(
									eq(webhook_deliveries.eventId, events.id),
									isNotNull(webhook_deliveries.payload),
								),
							),
					),
				),
			),
		)
		.orderBy(asc(events.createdAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(events)
		.where(
			inArray(
				events.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: events.id });

	return deletedRows.length;
}

async function deleteVerificationAuditLogs({
	batchSize,
	now,
}: {
	batchSize: number;
	now: Date;
}): Promise<number> {
	const cutoff = subtractDays(now, VERIFICATION_AUDIT_LOG_RETENTION_DAYS);
	const staleRows = await db
		.select({ id: audit_logs.id })
		.from(audit_logs)
		.where(
			and(
				inArray(audit_logs.event, VERIFICATION_AUDIT_LOG_EVENTS),
				lte(audit_logs.createdAt, cutoff),
			),
		)
		.orderBy(asc(audit_logs.createdAt))
		.limit(batchSize);

	if (staleRows.length === 0) {
		return 0;
	}

	const deletedRows = await db
		.delete(audit_logs)
		.where(
			inArray(
				audit_logs.id,
				staleRows.map((row) => row.id),
			),
		)
		.returning({ id: audit_logs.id });

	return deletedRows.length;
}

async function deleteStaleMobileAttestKeys({
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

export async function runVerificationRetentionSweep({
	batchSize = VERIFICATION_RETENTION_BATCH_SIZE,
	now,
}: {
	batchSize?: number;
	now: Date;
}): Promise<VerificationRetentionSweepResult> {
	const logger = createSafeRequestLogger({
		headers: new Headers(),
		method: "SCHEDULED",
		path: "/internal/verification-retention-sweep",
	});

	try {
		const deletedSessionCount = await deleteTerminalVerificationSessions({
			batchSize,
			now,
		});
		const minimizedAttemptCount =
			await minimizeVerificationSessionsPostTerminal({
				batchSize,
				now,
			});
		const deletedEventCount = await deleteVerificationEvents({
			batchSize,
			now,
		});
		const deletedAuditLogCount = await deleteVerificationAuditLogs({
			batchSize,
			now,
		});
		const deletedMobileAttestKeyCount = await deleteStaleMobileAttestKeys({
			batchSize,
			now,
		});

		logEvent(logger, {
			details: {
				deleted_audit_log_count: deletedAuditLogCount,
				deleted_event_count: deletedEventCount,
				deleted_mobile_attest_key_count: deletedMobileAttestKeyCount,
				deleted_session_count: deletedSessionCount,
				minimized_attempt_count: minimizedAttemptCount,
			},
			event: "verification.retention_sweep.completed",
		});
		logger.emit({
			_forceKeep:
				deletedSessionCount > 0 ||
				minimizedAttemptCount > 0 ||
				deletedEventCount > 0 ||
				deletedAuditLogCount > 0 ||
				deletedMobileAttestKeyCount > 0,
		});

		return {
			deletedAuditLogCount,
			deletedEventCount,
			deletedMobileAttestKeyCount,
			deletedSessionCount,
			failed: false,
			minimizedAttemptCount,
		};
	} catch (error) {
		logSafeError(logger, {
			code: "verification_retention_sweep_failed",
			error,
			event: "verification.retention_sweep.failed",
			message: "Verification retention sweep failed.",
		});
		logger.emit({ _forceKeep: true });

		return {
			deletedAuditLogCount: 0,
			deletedEventCount: 0,
			deletedMobileAttestKeyCount: 0,
			deletedSessionCount: 0,
			failed: true,
			minimizedAttemptCount: 0,
		};
	}
}
