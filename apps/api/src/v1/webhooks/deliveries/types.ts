import type { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import type { VerifyShareManifest } from "@/v1/verify/share-manifest";

export const MAX_DELIVERY_ATTEMPTS = 3;
export const INITIAL_RETRY_DELAY_MS = 60_000;

export type DeliveryStatus = typeof webhook_deliveries.$inferSelect.status;

export type VerificationAttemptFailedCode =
	| "passport_authenticity_failed"
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
