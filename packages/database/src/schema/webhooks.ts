import {
	DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	SUPPORTED_WEBHOOK_EVENT_TYPES,
} from "@kayle-id/config/webhook-events";
import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { auth_organizations } from "./auth";
import { events } from "./core";

/**
 * Endpoints for sending webhooks to.
 *
 * @see https://docs.kayle.id/webhooks
 */
export const webhook_endpoints = pgTable(
	"webhook_endpoints",
	{
		/**
		 * The ID of the webhook endpoint.
		 *
		 * Always prefixed with `whe_...`
		 */
		id: text("id").primaryKey(),
		organizationId: uuid("organization_id")
			.notNull()
			.references(() => auth_organizations.id, { onDelete: "cascade" }),
		name: text("name"),
		url: text("url").notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		subscribedEventTypes: jsonb("subscribed_event_types")
			.default([...SUPPORTED_WEBHOOK_EVENT_TYPES])
			.notNull(),
		undeliveredPayloadRetentionHours: integer(
			"undelivered_payload_retention_hours",
		)
			.default(DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS)
			.notNull(),
		signingSecretCiphertext: text("signing_secret_ciphertext"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		disabledAt: timestamp("disabled_at"),
	},
	(table) => [
		index("wh_endpoints_org_idx").on(table.organizationId),
		index("wh_endpoints_enabled_idx").on(table.enabled),
	],
);

/**
 * Encryption keys for encrypting payloads before sending to webhook endpoints.
 */
export const webhook_encryption_keys = pgTable(
	"webhook_encryption_keys",
	{
		/**
		 * The ID of the encryption key.
		 *
		 * Always prefixed with `whk_...`
		 */
		id: text("id").primaryKey(),
		webhookEndpointId: text("webhook_endpoint_id")
			.notNull()
			.references(() => webhook_endpoints.id, { onDelete: "cascade" }),
		keyId: text("key_id").notNull(),
		algorithm: text("algorithm").notNull(),
		keyType: text("key_type").notNull(),
		jwk: jsonb("jwk").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		disabledAt: timestamp("disabled_at"),
	},
	(table) => [
		index("webhook_encryption_keys_webhook_endpoint_id_idx").on(
			table.webhookEndpointId,
		),
		index("webhook_encryption_keys_is_active_idx").on(table.isActive),
		uniqueIndex("webhook_encryption_keys_one_active_per_endpoint_uidx")
			.on(table.webhookEndpointId)
			.where(sql`${table.isActive}`),
	],
);

/**
 * Webhook deliveries represent the intention to deliver a single event (from events table)
 * to a single webhook endpoint, using a specific encryption key (from webhook_encryption_keys table).
 */
export const webhook_deliveries = pgTable(
	"webhook_deliveries",
	{
		/**
		 * The ID of the webhook delivery.
		 *
		 * Always prefixed with `whd_...`
		 */
		id: text("id").primaryKey(),

		/**
		 * The event being delivered.
		 */
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),

		/**
		 * The webhook endpoint this delivery targets.
		 */
		webhookEndpointId: text("webhook_endpoint_id")
			.notNull()
			.references(() => webhook_endpoints.id, { onDelete: "cascade" }),

		/**
		 * The encryption key used to encrypt the payload for this delivery.
		 *
		 * This allows key rotation per endpoint without breaking old deliveries.
		 */
		webhookEncryptionKeyId: text("webhook_encryption_key_id").references(
			() => webhook_encryption_keys.id,
			{ onDelete: "restrict" },
		),

		/**
		 * Current status of this delivery.
		 *
		 * - pending: queued but not yet attempted
		 * - delivering: actively being attempted (optional, but useful)
		 * - succeeded: last attempt succeeded
		 * - failed: permanently failed (no further retries)
		 */
		status: text({
			enum: ["pending", "delivering", "succeeded", "failed"],
		})
			.default("pending")
			.notNull(),

		/**
		 * Number of attempts made so far.
		 *
		 * This is a cached counter; the detailed history lives in webhook_delivery_attempts.
		 */
		attemptCount: integer("attempt_count").default(0).notNull(),

		/**
		 * Next time this delivery should be attempted (for retry scheduling).
		 *
		 * When null and status = 'pending', it can be treated as ready to send.
		 */
		nextAttemptAt: timestamp("next_attempt_at"),

		/**
		 * Last HTTP status code received from the endpoint, if any.
		 */
		lastStatusCode: integer("last_status_code"),

		/**
		 * The payload sent to the endpoint.
		 *
		 * This may contain end-user personal data, but only encrypted with
		 * the platform's public key. Kayle ID cannot decrypt it.
		 */
		payload: text("payload"),
		payloadExpiresAt: timestamp("payload_expires_at"),
		payloadScrubbedAt: timestamp("payload_scrubbed_at"),
		payloadRetentionReason: text("payload_retention_reason", {
			enum: [
				"pending_delivery",
				"delivered",
				"terminal_failure_retention",
				"expired",
				"no_active_key",
				"jwe_creation_failed",
				"privacy_request",
			],
		}),

		/**
		 * When the last delivery attempt was made, if any.
		 */
		lastAttemptAt: timestamp("last_attempt_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// Queue: pick next pending items
		index("wh_deliveries_status_next_attempt_idx").on(
			table.status,
			table.nextAttemptAt,
		),
		// Look up deliveries for a given event
		index("wh_deliveries_event_id_idx").on(table.eventId),
		// Look up deliveries for a given endpoint
		index("wh_deliveries_endpoint_id_idx").on(table.webhookEndpointId),
		index("wh_deliveries_payload_expires_at_idx")
			.on(table.payloadExpiresAt)
			.where(
				sql`${table.payload} IS NOT NULL AND ${table.payloadExpiresAt} IS NOT NULL`,
			),
	],
);

/**
 * Individual attempts to deliver an event_delivery to its endpoint.
 *
 * This table provides a detailed history for debugging and audit.
 */
export const webhook_delivery_attempts = pgTable(
	"webhook_delivery_attempts",
	{
		/**
		 * The ID of the delivery attempt.
		 *
		 * Always prefixed with `wha_...`
		 */
		id: text("id").primaryKey(),

		/**
		 * The event delivery this attempt belongs to.
		 */
		webhookDeliveryId: text("webhook_delivery_id")
			.notNull()
			.references(() => webhook_deliveries.id, { onDelete: "cascade" }),

		/**
		 * Status of this specific attempt.
		 *
		 * - succeeded: endpoint returned 2xx status code
		 * - failed: attempt failed (network error, 4xx/5xx, timeout, etc.)
		 */
		status: text({
			enum: ["succeeded", "failed"],
		}).notNull(),

		/**
		 * HTTP status code received from the endpoint, if any.
		 */
		statusCode: integer("status_code"),

		/**
		 * When this attempt was made.
		 */
		attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
	},
	(table) => [
		index("wh_delivery_attempts_delivery_id_idx").on(table.webhookDeliveryId),
	],
);
