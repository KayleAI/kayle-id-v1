import { db } from "@kayle-id/database/drizzle";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getWebhookDeliveryById, type WebhookDeliveryRow } from "./repository";
import { WEBHOOK_PAYLOAD_EXPIRED_ERROR_CODE } from "./types";

export type WebhookDeliveryRetryBlockReason =
	| "delivering"
	| "payload_expired"
	| "payload_scrubbed";

export function getWebhookDeliveryRetryBlockReason(
	delivery: WebhookDeliveryRow,
	now = new Date(),
): WebhookDeliveryRetryBlockReason | null {
	if (delivery.status === "delivering") {
		return "delivering";
	}

	if (!delivery.payload) {
		return "payload_scrubbed";
	}

	if (!delivery.payloadExpiresAt || delivery.payloadExpiresAt <= now) {
		return "payload_expired";
	}

	return null;
}

export function getWebhookPayloadExpiredErrorResponse() {
	return {
		code: WEBHOOK_PAYLOAD_EXPIRED_ERROR_CODE,
		message: "Webhook payload is no longer retained.",
		hint: "Payload expired; create a new verification session or handle the event manually.",
		docs: "https://kayle.id/docs/api/webhooks/deliveries#payload-retention",
	};
}

export async function requeueWebhookDelivery({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<WebhookDeliveryRow | null> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery || getWebhookDeliveryRetryBlockReason(delivery) !== null) {
		return null;
	}

	const [updated] = await db
		.update(webhook_deliveries)
		.set({
			attemptCount: 0,
			lastAttemptAt: null,
			lastStatusCode: null,
			nextAttemptAt: null,
			status: "pending",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				ne(webhook_deliveries.status, "delivering"),
				isNotNull(webhook_deliveries.payload),
			),
		)
		.returning();

	return updated ?? null;
}

export async function requeueWebhookDeliveriesForEvent({
	eventId,
}: {
	eventId: string;
}): Promise<WebhookDeliveryRow[]> {
	const deliveries = await db
		.select()
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.eventId, eventId));

	const requeued: WebhookDeliveryRow[] = [];

	for (const delivery of deliveries) {
		const nextDelivery = await requeueWebhookDelivery({
			deliveryId: delivery.id,
		});

		if (nextDelivery) {
			requeued.push(nextDelivery);
		}
	}

	return requeued;
}
