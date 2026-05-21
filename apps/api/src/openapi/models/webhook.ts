import { type RouteConfig, z } from "@hono/zod-openapi";
import {
	DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	SUPPORTED_WEBHOOK_EVENT_TYPES,
	webhookEventTypeSchema,
	webhookPayloadRetentionHoursSchema,
} from "@kayle-id/config/webhook-events";

const WEBHOOK_RESOURCE_ID_MAX_LENGTH = 128;
const WEBHOOK_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const WEBHOOK_ENDPOINT_LABEL_MAX_COUNT = 8;
const WEBHOOK_ENDPOINT_LABEL_MAX_LENGTH = 40;

export const WebhookResourceIdParam = z
	.string()
	.min(1)
	.max(WEBHOOK_RESOURCE_ID_MAX_LENGTH)
	.regex(WEBHOOK_RESOURCE_ID_PATTERN);

export const WebhookEndpointLabels = z
	.array(z.string().transform((label) => label.trim()))
	.max(WEBHOOK_ENDPOINT_LABEL_MAX_COUNT)
	.superRefine((labels, ctx) => {
		const seen = new Set<string>();

		for (const [index, label] of labels.entries()) {
			if (label.length === 0) {
				ctx.addIssue({
					code: "custom",
					message: "Labels must be non-empty strings.",
					path: [index],
				});
				continue;
			}

			if (label.length > WEBHOOK_ENDPOINT_LABEL_MAX_LENGTH) {
				ctx.addIssue({
					code: "custom",
					message: `Labels must be ${WEBHOOK_ENDPOINT_LABEL_MAX_LENGTH} characters or fewer.`,
					path: [index],
				});
				continue;
			}

			const normalized = label.toLowerCase();
			if (seen.has(normalized)) {
				ctx.addIssue({
					code: "custom",
					message: "Labels must be unique case-insensitively.",
					path: [index],
				});
				continue;
			}

			seen.add(normalized);
		}
	})
	.describe(
		"Endpoint labels used as tag-style purpose markers. Labels are trimmed, case-insensitively unique, max 8 labels, max 40 characters each.",
	);

export const WebhookDelivery = z
	.object({
		id: z.string().describe("Webhook delivery ID"),
		event_id: z.string().describe("Event ID"),
		webhook_endpoint_id: z
			.string()
			.describe("The ID of the webhook endpoint this delivery targets"),
		webhook_encryption_key_id: z
			.string()
			.nullable()
			.describe(
				"The ID of the encryption key used to encrypt the payload for this delivery",
			),
		status: z
			.enum(["pending", "delivering", "succeeded", "failed"])
			.describe("The status of the webhook delivery"),
		attempt_count: z
			.number()
			.describe("The number of attempts made to deliver the webhook"),
		next_attempt_at: z
			.string()
			.nullable()
			.describe(
				"The next time this delivery should be attempted, or null if ready to send.",
			),
		payload_expires_at: z
			.string()
			.nullable()
			.describe("When the encrypted payload expires for manual retry/replay."),
		payload_scrubbed_at: z
			.string()
			.nullable()
			.describe(
				"When the encrypted payload was scrubbed, if no longer stored.",
			),
		payload_retention_reason: z
			.enum([
				"pending_delivery",
				"delivered",
				"terminal_failure_retention",
				"expired",
				"no_active_key",
				"jwe_creation_failed",
				"privacy_request",
			])
			.nullable()
			.describe("Why the payload is retained or why it was scrubbed."),
		last_status_code: z
			.number()
			.nullable()
			.describe(
				"The last HTTP status code received from the endpoint, if any.",
			),
		last_attempt_at: z
			.string()
			.nullable()
			.describe("The time the last delivery attempt was made, if any."),
		created_at: z.string().describe("The time the delivery was created"),
		updated_at: z.string().describe("The time the delivery was last updated"),
	})
	.openapi("Webhook Delivery");

export const WebhookEndpoint = z
	.object({
		id: z.string().describe("The ID of the webhook endpoint"),
		organization_id: z
			.string()
			.describe("The ID of the organization that owns this endpoint"),
		name: z
			.string()
			.nullable()
			.describe("An optional display name for the webhook endpoint."),
		labels: WebhookEndpointLabels.describe(
			"Tag-style purpose labels for this endpoint.",
		),
		url: z.string().url().describe("The URL of the webhook endpoint"),
		enabled: z.boolean().describe("Whether the webhook endpoint is enabled"),
		subscribed_event_types: z
			.array(webhookEventTypeSchema)
			.describe(
				`The event types this endpoint is subscribed to. Supported values: ${SUPPORTED_WEBHOOK_EVENT_TYPES.join(
					", ",
				)}.`,
			),
		undelivered_payload_retention_hours: webhookPayloadRetentionHoursSchema
			.default(DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS)
			.describe(
				"How long Kayle retains encrypted payloads after terminal delivery failure.",
			),
		created_at: z
			.string()
			.describe("The time the webhook endpoint was created"),
		updated_at: z
			.string()
			.describe("The time the webhook endpoint was last updated"),
		disabled_at: z
			.string()
			.nullable()
			.describe("The time the webhook endpoint was disabled, null if enabled"),
	})
	.openapi("Webhook Endpoint");

export const CreatedWebhookEndpoint = z
	.object({
		endpoint: WebhookEndpoint,
		signing_secret: z
			.string()
			.describe("The webhook signing secret. This value is shown only once."),
	})
	.openapi("Created Webhook Endpoint");

export const RotatedWebhookSigningSecret = z
	.object({
		endpoint_id: z.string().describe("The webhook endpoint ID"),
		signing_secret: z
			.string()
			.describe(
				"The rotated webhook signing secret. This value is shown only once.",
			),
	})
	.openapi("Rotated Webhook Signing Secret");

export const RevealedWebhookSigningSecret = z
	.object({
		endpoint_id: z.string().describe("The webhook endpoint ID"),
		signing_secret: z
			.string()
			.describe("The current webhook signing secret for the endpoint."),
	})
	.openapi("Revealed Webhook Signing Secret");

export const WebhookEncryptionKey = z
	.object({
		id: z.string().describe("The ID of the webhook encryption key"),
		webhook_endpoint_id: z
			.string()
			.describe("The ID of the webhook endpoint this key belongs to"),
		key_id: z
			.string()
			.describe("The key identifier, used as `kid` in the JWE header"),
		algorithm: z.string().describe("The JWE algorithm (e.g. ECDH-ES)"),
		key_type: z.string().describe("The JWK key type (e.g. EC)"),
		jwk: z
			.record(z.string(), z.unknown())
			.describe("The public JWK used to encrypt webhook payloads"),
		is_active: z
			.boolean()
			.describe("Whether this key is active for new webhook deliveries"),
		created_at: z.string().describe("The time the key was created"),
		updated_at: z.string().describe("The time the key was last updated"),
		disabled_at: z
			.string()
			.nullable()
			.describe("The time the key was disabled, null if still active"),
	})
	.openapi("Webhook Encryption Key");

export const WebhookEventDelivery = z.object({
	id: z.string().describe("Webhook delivery ID"),
	webhook_endpoint_id: z
		.string()
		.describe("The ID of the webhook endpoint this delivery targets"),
	status: z
		.enum(["pending", "delivering", "succeeded", "failed"])
		.describe("The status of the webhook delivery"),
	last_status_code: z
		.number()
		.nullable()
		.describe("The last HTTP status code received from the endpoint, if any."),
	attempt_count: z
		.number()
		.describe("The number of attempts made to deliver the webhook"),
	last_attempt_at: z
		.string()
		.nullable()
		.describe("The time the last delivery attempt was made, if any."),
	payload_expires_at: z
		.string()
		.nullable()
		.describe("When the encrypted payload expires for manual retry/replay."),
	payload_scrubbed_at: z
		.string()
		.nullable()
		.describe("When the encrypted payload was scrubbed, if no longer stored."),
	payload_retention_reason: z
		.enum([
			"pending_delivery",
			"delivered",
			"terminal_failure_retention",
			"expired",
			"no_active_key",
			"jwe_creation_failed",
			"privacy_request",
		])
		.nullable()
		.describe("Why the payload is retained or why it was scrubbed."),
});

export const WebhookEvent = z
	.object({
		id: z.string().describe("Event ID"),
		type: z
			.string()
			.describe(
				'The type of the event (e.g. "verification.session.succeeded").',
			),
		trigger_type: z
			.enum(["verification_session", "verification_attempt"])
			.describe("The type of object that triggered this event."),
		trigger_id: z
			.string()
			.describe(
				"The ID of the object that triggered this event (e.g. a verification session or attempt ID).",
			),
		created_at: z.string().describe("The time the event was created."),
		deliveries: z
			.array(WebhookEventDelivery)
			.describe("Deliveries associated with this event."),
	})
	.openapi("Webhook Event");

const WebhookSessionMetadata = z
	.object({
		contract_version: z
			.number()
			.int()
			.describe("Contract version the session was created against."),
		event_id: z.string().describe("Unique webhook event ID."),
		verification_session_id: z
			.string()
			.describe("The verification session this event belongs to."),
	})
	.openapi("Webhook Session Metadata");

const WebhookClaimValue = z
	.union([z.boolean(), z.string(), z.null()])
	.describe(
		"Consented claim value. Claims are strings, booleans for derived age gates, or null when a selected optional claim has no value.",
	);

export const VerificationAttemptSucceededWebhookPayload = z
	.object({
		type: z.literal("verification.session.succeeded"),
		metadata: WebhookSessionMetadata,
		data: z.object({
			claims: z
				.record(z.string(), WebhookClaimValue)
				.describe(
					"Only the claims the user consented to share, keyed by claim identifier.",
				),
			selected_field_keys: z
				.array(z.string())
				.describe("Canonical list of claim keys the user consented to share."),
		}),
	})
	.openapi("VerificationAttemptSucceededWebhookPayload");

export const VerificationAttemptFailedWebhookPayload = z
	.object({
		type: z.literal("verification.session.failed"),
		metadata: WebhookSessionMetadata,
		data: z.object({
			failure_code: z
				.enum([
					"document_anti_cloning_attestation_failed",
					"document_authenticity_failed",
					"document_active_authentication_failed",
					"document_chip_authentication_failed",
					"document_data_invalid",
					"liveness_failed",
					"selfie_face_mismatch",
				])
				.describe(
					"Reason Kayle could not confirm the session. Failed-session payloads do not include claims, biometrics, or risk scores.",
				),
			nfc_tries_used: z
				.number()
				.int()
				.min(0)
				.max(3)
				.describe(
					"How many NFC chip-read retries the session consumed before terminalizing.",
				),
			liveness_tries_used: z
				.number()
				.int()
				.min(0)
				.max(3)
				.describe(
					"How many liveness retries the session consumed before terminalizing.",
				),
		}),
	})
	.openapi("VerificationAttemptFailedWebhookPayload");

export const VerificationSessionExpiredWebhookPayload = z
	.object({
		type: z.literal("verification.session.expired"),
		metadata: WebhookSessionMetadata,
		data: z.object({}).describe("Reserved for future fields."),
	})
	.openapi("VerificationSessionExpiredWebhookPayload");

export const VerificationSessionCancelledWebhookPayload = z
	.object({
		type: z.literal("verification.session.cancelled"),
		metadata: WebhookSessionMetadata,
		data: z.object({
			outcome: z
				.enum(["not_verified"])
				.describe(
					"High-level outcome for the user. Cancelled sessions never produce a verified user.",
				),
			reason: z
				.enum([
					"cancelled",
					"cancelled_after_failed_check",
					"privacy_cancelled_after_terminal_failure",
					"privacy_cancelled_after_terminal_success",
				])
				.describe(
					"Why this terminal cancelled event was emitted. `cancelled_after_failed_check` indicates the user or relying party cancelled while a retry budget was already partially consumed. The `privacy_cancelled_after_terminal_*` reasons replace a previously-queued failed or succeeded webhook whose payload was scrubbed by a privacy request before delivery.",
				),
			nfc_tries_used: z
				.number()
				.int()
				.min(0)
				.max(3)
				.describe(
					"How many NFC chip-read retries the session consumed before cancellation.",
				),
			liveness_tries_used: z
				.number()
				.int()
				.min(0)
				.max(3)
				.describe(
					"How many liveness retries the session consumed before cancellation.",
				),
		}),
	})
	.openapi("VerificationSessionCancelledWebhookPayload");

export const webhookPayloadOpenApiDefinitions = [
	{
		description:
			"Delivered as a JWE-encrypted POST body when Kayle confirms an attempt.",
		path: "verification.session.succeeded",
		refId: "VerificationAttemptSucceededWebhookPayload",
		schema: VerificationAttemptSucceededWebhookPayload,
		summary: "verification.session.succeeded payload",
	},
	{
		description:
			"Delivered as a JWE-encrypted POST body when Kayle cannot confirm an attempt. This payload contains no claims, biometrics, face scores, or risk scores.",
		path: "verification.session.failed",
		refId: "VerificationAttemptFailedWebhookPayload",
		schema: VerificationAttemptFailedWebhookPayload,
		summary: "verification.session.failed payload",
	},
	{
		description:
			"Delivered as a JWE-encrypted POST body when a session expires without a confirmed attempt.",
		path: "verification.session.expired",
		refId: "VerificationSessionExpiredWebhookPayload",
		schema: VerificationSessionExpiredWebhookPayload,
		summary: "verification.session.expired payload",
	},
	{
		description:
			"Delivered as a JWE-encrypted POST body when a session is cancelled by the user or relying party.",
		path: "verification.session.cancelled",
		refId: "VerificationSessionCancelledWebhookPayload",
		schema: VerificationSessionCancelledWebhookPayload,
		summary: "verification.session.cancelled payload",
	},
] as const;

type WebhookPayloadOpenApiRegistry = {
	register: <Schema extends z.ZodType>(
		refId: string,
		zodSchema: Schema,
	) => Schema;
	registerWebhook: (webhook: RouteConfig) => void;
};

export function registerWebhookPayloadOpenApi(
	registry: WebhookPayloadOpenApiRegistry,
): void {
	for (const definition of webhookPayloadOpenApiDefinitions) {
		registry.register(definition.refId, definition.schema);
		registry.registerWebhook({
			method: "post",
			path: definition.path,
			tags: ["Webhook payloads"],
			summary: definition.summary,
			description: `${definition.description} Verify the \`X-Kayle-Signature\` header against the encrypted body before decrypting.`,
			request: {
				body: {
					required: true,
					description:
						"The decrypted JSON payload. The actual request body delivered to your endpoint is compact JWE.",
					content: {
						"application/json": {
							schema: definition.schema,
						},
					},
				},
			},
			responses: {
				"2XX": {
					description:
						"Return any 2xx response to acknowledge receipt. Non-2xx responses are retried while the encrypted payload remains retained.",
				},
			},
		});
	}
}
