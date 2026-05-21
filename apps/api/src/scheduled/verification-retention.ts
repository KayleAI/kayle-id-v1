import {
	createSafeRequestLogger,
	logEvent,
	logSafeError,
} from "@kayle-id/config/logging";
import {
	RETENTION_SWEEP_UTC_HOUR,
	RETENTION_SWEEP_UTC_MINUTE,
	VERIFICATION_RETENTION_BATCH_SIZE,
} from "./verification-retention-config";
import {
	deleteVerificationAuditLogs,
	deleteVerificationEvents,
} from "./verification-retention-events";
import { deleteStaleMobileAttestKeys } from "./verification-retention-mobile-attest-keys";
import {
	deleteTerminalVerificationSessions,
	minimizeVerificationSessionsPostTerminal,
} from "./verification-retention-sessions";

export {
	MOBILE_ATTEST_KEY_RETENTION_DAYS,
	TERMINAL_VERIFICATION_SESSION_RETENTION_DAYS,
	VERIFICATION_ATTEMPT_MINIMIZATION_RETENTION_DAYS,
	VERIFICATION_AUDIT_LOG_RETENTION_DAYS,
	VERIFICATION_EVENT_RETENTION_DAYS,
} from "./verification-retention-config";

export type VerificationRetentionSweepResult = {
	deletedAuditLogCount: number;
	deletedEventCount: number;
	deletedMobileAttestKeyCount: number;
	deletedSessionCount: number;
	failed: boolean;
	minimizedAttemptCount: number;
};

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
