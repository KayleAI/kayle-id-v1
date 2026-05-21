import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";

export type DemoFieldMode = "off" | "optional" | "required";

export interface DemoRequestedShareField {
	reason: string;
	required: boolean;
}

export type DemoRequestedShareFields = Record<string, DemoRequestedShareField>;

export interface DemoSessionShareField {
	reason: string;
	required: boolean;
	source: "default" | "rc";
}

export type DemoSessionShareFields = Record<string, DemoSessionShareField>;

export interface DemoSessionStatus {
	completed_at: string | null;
	is_terminal: boolean;
	failure_code: string | null;
	redirect_url: string | null;
	session_id: string;
	status:
		| "cancelled"
		| "created"
		| "expired"
		| "failed"
		| "in_progress"
		| "succeeded";
}

export interface DemoWebhookEnvelope {
	body: string;
	delivery_id: string | null;
	event_type: SupportedWebhookEventType | null;
	received_at: string;
	signature_header: string | null;
}

export interface DemoRunRecord {
	created_at: string;
	endpoint_id: string;
	key_id: string;
	last_session_status: DemoSessionStatus | null;
	org_slug: string;
	receiver_token: string;
	session_id: string | null;
	share_fields: DemoSessionShareFields | null;
	verification_url: string | null;
	webhook: DemoWebhookEnvelope | null;
	webhooks: DemoWebhookEnvelope[];
}

export interface DemoRunView {
	endpoint_id: string;
	id: string;
	key_id: string;
	org_slug: string;
	session_id: string | null;
	session_status: DemoSessionStatus | null;
	share_fields: DemoSessionShareFields | null;
	verification_url: string | null;
	webhook: DemoWebhookEnvelope | null;
	webhooks: DemoWebhookEnvelope[];
}

export interface DemoRunCreateResult {
	demo_run_id: string;
	endpoint_id: string;
	org_slug: string;
	signing_secret: string;
}

export interface DemoRunSessionResult {
	session_id: string;
	share_fields: DemoSessionShareFields;
	verification_url: string;
}
