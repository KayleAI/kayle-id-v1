import type { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import type { VerifyShareManifest } from "@/v1/verify/share-manifest";

/**
 * Backoff schedule between webhook delivery attempts. Mirrors Resend's
 * webhook retry policy (https://resend.com/docs/webhooks/retries-and-replays):
 *
 *   attempt 1   immediate
 *   attempt 2   +5s
 *   attempt 3   +5m
 *   attempt 4   +30m
 *   attempt 5   +2h
 *   attempt 6   +5h
 *   attempt 7   +10h
 *   attempt 8   +10h     (final, ~32h35m after the initial event)
 *
 * Each entry is the wall-clock delay between the previous attempt and the
 * next one. Strings are passed verbatim to `step.sleep` so the Workflow
 * runtime parses them — keep the units aligned with Cloudflare's accepted
 * duration grammar ("seconds" / "minutes" / "hours").
 */
export const WEBHOOK_DELIVERY_RETRY_SCHEDULE = [
	"5 seconds",
	"5 minutes",
	"30 minutes",
	"2 hours",
	"5 hours",
	"10 hours",
	"10 hours",
] as const;

/** Total attempts = 1 initial + N retries from the schedule above. */
export const MAX_DELIVERY_ATTEMPTS = 1 + WEBHOOK_DELIVERY_RETRY_SCHEDULE.length;

export type DeliveryStatus = typeof webhook_deliveries.$inferSelect.status;

export type VerificationAttemptFailedCode =
	| "document_anti_cloning_attestation_failed"
	| "document_authenticity_failed"
	| "document_active_authentication_failed"
	| "document_chip_authentication_failed"
	| "liveness_failed"
	| "selfie_face_mismatch";

export type VerificationAttemptMetadata = {
	contract_version: number;
	event_id: string;
	verification_attempt_id: string;
	verification_session_id: string;
};

export type VerificationSessionMetadata = {
	contract_version: number;
	event_id: string;
	verification_session_id: string;
};

export type VerificationSucceededPayload = {
	data: {
		claims: VerifyShareManifest["claims"];
		selected_field_keys: string[];
	};
	metadata: VerificationAttemptMetadata;
	type: "verification.attempt.succeeded";
};

export type VerificationAttemptFailedPayload = {
	data: {
		failure_code: VerificationAttemptFailedCode;
	};
	metadata: VerificationAttemptMetadata;
	type: "verification.attempt.failed";
};

export type VerificationSessionExpiredPayload = {
	data: Record<string, never>;
	metadata: VerificationSessionMetadata;
	type: "verification.session.expired";
};

export type VerificationSessionCancelledPayload = {
	data: Record<string, never>;
	metadata: VerificationSessionMetadata;
	type: "verification.session.cancelled";
};

export type WebhookPayload =
	| VerificationAttemptFailedPayload
	| VerificationSessionCancelledPayload
	| VerificationSessionExpiredPayload
	| VerificationSucceededPayload;

export type DeliveryRowResponse = {
	attempt_count: number;
	created_at: string;
	event_id: string;
	id: string;
	last_attempt_at: string | null;
	last_status_code: number | null;
	next_attempt_at: string | null;
	status: DeliveryStatus;
	updated_at: string;
	webhook_encryption_key_id: string | null;
	webhook_endpoint_id: string;
};
