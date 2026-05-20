export type { ApiError, Pagination } from "@/utils/api-client";

export type DeliveryStatus = "pending" | "delivering" | "succeeded" | "failed";

export interface WebhookEndpoint {
	created_at: string;
	disabled_at: string | null;
	enabled: boolean;
	id: string;
	labels: string[];
	name: string | null;
	organization_id: string;
	subscribed_event_types: string[];
	undelivered_payload_retention_hours: number;
	updated_at: string;
	url: string;
}

export interface WebhookEndpointCreateResult {
	endpoint: WebhookEndpoint;
	signing_secret: string;
}

export interface WebhookDeleteResult {
	message: string;
	status: "success";
}

export interface WebhookSigningSecretResult {
	endpoint_id: string;
	signing_secret: string;
}

export interface WebhookEncryptionKey {
	algorithm: string;
	created_at: string;
	disabled_at: string | null;
	id: string;
	is_active: boolean;
	jwk: JsonWebKey;
	key_id: string;
	key_type: string;
	updated_at: string;
	webhook_endpoint_id: string;
}

export interface WebhookEventDelivery {
	attempt_count: number;
	id: string;
	last_attempt_at: string | null;
	last_status_code: number | null;
	payload_expires_at: string | null;
	payload_retention_reason: WebhookPayloadRetentionReason;
	payload_scrubbed_at: string | null;
	status: DeliveryStatus;
	webhook_endpoint_id: string;
}

export interface WebhookEvent {
	created_at: string;
	deliveries: WebhookEventDelivery[];
	id: string;
	trigger_id: string;
	trigger_type: "verification_session";
	type: string;
}

export interface WebhookDelivery {
	attempt_count: number;
	created_at: string;
	event_id: string;
	id: string;
	last_attempt_at: string | null;
	last_status_code: number | null;
	next_attempt_at: string | null;
	payload_expires_at: string | null;
	payload_retention_reason: WebhookPayloadRetentionReason;
	payload_scrubbed_at: string | null;
	status: DeliveryStatus;
	updated_at: string;
	webhook_encryption_key_id: string | null;
	webhook_endpoint_id: string;
}

export type WebhookPayloadRetentionReason =
	| "delivered"
	| "expired"
	| "jwe_creation_failed"
	| "no_active_key"
	| "pending_delivery"
	| "privacy_request"
	| "terminal_failure_retention"
	| null;
