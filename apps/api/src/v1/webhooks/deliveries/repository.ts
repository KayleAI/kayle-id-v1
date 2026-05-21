import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_delivery_attempts,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import type { DeliveryRowResponse } from "./types";

export type WebhookDeliveryRow = typeof webhook_deliveries.$inferSelect;
export type WebhookEndpointRow = typeof webhook_endpoints.$inferSelect;

export type DeliveryAttemptContext = {
	delivery: WebhookDeliveryRow;
	endpoint: WebhookEndpointRow;
	event: {
		triggerId: string;
		triggerType: string;
		type: SupportedWebhookEventType;
	};
};

export function mapWebhookDeliveryRowToResponse(
	row: WebhookDeliveryRow,
): DeliveryRowResponse {
	return {
		attempt_count: row.attemptCount,
		created_at: row.createdAt.toISOString(),
		event_id: row.eventId,
		id: row.id,
		last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
		last_status_code: row.lastStatusCode,
		next_attempt_at: row.nextAttemptAt?.toISOString() ?? null,
		payload_expires_at: row.payloadExpiresAt?.toISOString() ?? null,
		payload_retention_reason: row.payloadRetentionReason,
		payload_scrubbed_at: row.payloadScrubbedAt?.toISOString() ?? null,
		status: row.status,
		updated_at: row.updatedAt.toISOString(),
		webhook_encryption_key_id: row.webhookEncryptionKeyId,
		webhook_endpoint_id: row.webhookEndpointId,
	};
}

export async function insertAttempt({
	deliveryId,
	status,
	statusCode,
}: {
	deliveryId: string;
	status: "failed" | "succeeded";
	statusCode: number | null;
}): Promise<void> {
	await db.insert(webhook_delivery_attempts).values({
		id: generateId({
			type: "wha",
		}),
		status,
		statusCode,
		webhookDeliveryId: deliveryId,
	});
}

export async function getWebhookDeliveryById(
	deliveryId: string,
): Promise<WebhookDeliveryRow | null> {
	const [delivery] = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	return delivery ?? null;
}

export async function getMappedWebhookDelivery(
	deliveryId: string,
): Promise<DeliveryRowResponse | null> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	return delivery ? mapWebhookDeliveryRowToResponse(delivery) : null;
}

export async function getWebhookEndpointTargetIdsForSession(
	sessionId: string,
): Promise<string[] | null> {
	const [session] = await db
		.select({
			webhookEndpointIds: verification_sessions.webhookEndpointIds,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	return session?.webhookEndpointIds?.length
		? session.webhookEndpointIds
		: null;
}

export async function getDeliveryAttemptContext(
	deliveryId: string,
): Promise<DeliveryAttemptContext | null> {
	const [row] = await db
		.select({
			delivery: webhook_deliveries,
			endpoint: webhook_endpoints,
			eventTriggerId: events.triggerId,
			eventTriggerType: events.triggerType,
			eventType: events.type,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.innerJoin(
			webhook_endpoints,
			eq(webhook_endpoints.id, webhook_deliveries.webhookEndpointId),
		)
		.where(eq(webhook_deliveries.id, deliveryId))
		.limit(1);

	return row
		? {
				delivery: row.delivery,
				endpoint: row.endpoint,
				event: {
					triggerId: row.eventTriggerId,
					triggerType: row.eventTriggerType,
					type: row.eventType as SupportedWebhookEventType,
				},
			}
		: null;
}

export async function getSessionPrivacyStateForDeliveryEvent({
	triggerId,
	triggerType,
}: DeliveryAttemptContext["event"]): Promise<{
	cancelTokenConsumedAt: Date | null;
	status: string;
} | null> {
	if (triggerType !== "verification_session") {
		return null;
	}

	const [row] = await db
		.select({
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			status: verification_sessions.status,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, triggerId))
		.limit(1);

	return row ?? null;
}

export async function claimPendingWebhookDelivery(
	deliveryId: string,
): Promise<WebhookDeliveryRow | null> {
	const [claimed] = await db
		.update(webhook_deliveries)
		.set({
			status: "delivering",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(webhook_deliveries.status, "pending"),
				isNotNull(webhook_deliveries.payload),
				orPrivacyEligiblePayload(),
			),
		)
		.returning();

	return claimed ?? null;
}

function orPrivacyEligiblePayload() {
	return or(
		isNull(webhook_deliveries.payloadRetentionReason),
		ne(webhook_deliveries.payloadRetentionReason, "privacy_request"),
	);
}

export async function getWebhookDeliveryForOrganization({
	deliveryId,
	organizationId,
}: {
	deliveryId: string;
	organizationId: string;
}): Promise<WebhookDeliveryRow | null> {
	const [row] = await db
		.select({
			delivery: webhook_deliveries,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(events.organizationId, organizationId),
			),
		)
		.limit(1);

	return row?.delivery ?? null;
}
