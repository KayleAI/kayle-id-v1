export const VERIFICATION_ATTEMPT_MINIMIZATION_RETENTION_DAYS = 7;
export const TERMINAL_VERIFICATION_SESSION_RETENTION_DAYS = 30;
export const VERIFICATION_EVENT_RETENTION_DAYS = 30;
export const VERIFICATION_AUDIT_LOG_RETENTION_DAYS = 365;
export const MOBILE_ATTEST_KEY_RETENTION_DAYS = 90;

export const VERIFICATION_RETENTION_BATCH_SIZE = 500;
export const RETENTION_SWEEP_UTC_HOUR = 2;
export const RETENTION_SWEEP_UTC_MINUTE = 23;

const DAY_MS = 24 * 60 * 60_000;

export const TERMINAL_SESSION_STATUSES = [
	"succeeded",
	"failed",
	"expired",
	"cancelled",
] as const;

export const VERIFICATION_EVENT_TYPES = [
	"verification.session.succeeded",
	"verification.session.failed",
	"verification.session.expired",
	"verification.session.cancelled",
] as const;

export const VERIFICATION_AUDIT_LOG_EVENTS = [
	"session.created",
	"session.cancelled",
	"session.expired",
	"session.succeeded",
	"session.check.failed",
	"session.failed",
] as const;

export function subtractDays(date: Date, days: number): Date {
	return new Date(date.getTime() - days * DAY_MS);
}
