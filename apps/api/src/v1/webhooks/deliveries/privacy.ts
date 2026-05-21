import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
	type DeliveryAttemptContext,
	getSessionPrivacyStateForDeliveryEvent,
} from "./repository";

export type WebhookPayloadPrivacyScrubResult = {
	deliveredDeliveryCount: number;
	scrubbedDeliveryCount: number;
	totalDeliveryCount: number;
};

export async function cancelWebhookDeliveryAfterPrivacyWithdrawal({
	deliveryId,
	event,
	now = new Date(),
}: {
	deliveryId: string;
	event: DeliveryAttemptContext["event"];
	now?: Date;
}): Promise<boolean> {
	if (event.type === "verification.session.cancelled") {
		return false;
	}

	const session = await getSessionPrivacyStateForDeliveryEvent(event);
	const isWithdrawn = Boolean(
		session?.cancelTokenConsumedAt || session?.status === "cancelled",
	);

	if (!isWithdrawn) {
		return false;
	}

	await db
		.update(webhook_deliveries)
		.set({
			nextAttemptAt: null,
			payload: null,
			payloadExpiresAt: null,
			payloadRetentionReason: "privacy_request",
			payloadScrubbedAt: now,
			status: "failed",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				ne(webhook_deliveries.status, "succeeded"),
			),
		);

	return true;
}

export async function scrubWebhookPayloadsForVerificationSessionPrivacyRequest({
	now = new Date(),
	organizationId,
	sessionId,
}: {
	now?: Date;
	organizationId: string;
	sessionId: string;
}): Promise<WebhookPayloadPrivacyScrubResult> {
	const eventRows = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.organizationId, organizationId),
				eq(events.triggerId, sessionId),
			),
		);

	if (eventRows.length === 0) {
		return {
			deliveredDeliveryCount: 0,
			scrubbedDeliveryCount: 0,
			totalDeliveryCount: 0,
		};
	}

	const deliveryRows = await db
		.select({
			id: webhook_deliveries.id,
			payload: webhook_deliveries.payload,
			status: webhook_deliveries.status,
		})
		.from(webhook_deliveries)
		.where(
			inArray(
				webhook_deliveries.eventId,
				eventRows.map((event) => event.id),
			),
		);
	const scrubbedDeliveryIds = deliveryRows
		.filter((delivery) => delivery.status !== "succeeded" && delivery.payload)
		.map((delivery) => delivery.id);

	if (scrubbedDeliveryIds.length > 0) {
		await db
			.update(webhook_deliveries)
			.set({
				nextAttemptAt: null,
				payload: null,
				payloadExpiresAt: null,
				payloadRetentionReason: "privacy_request",
				payloadScrubbedAt: now,
				status: "failed",
			})
			.where(inArray(webhook_deliveries.id, scrubbedDeliveryIds));
	}

	return {
		deliveredDeliveryCount: deliveryRows.filter(
			(delivery) => delivery.status === "succeeded",
		).length,
		scrubbedDeliveryCount: scrubbedDeliveryIds.length,
		totalDeliveryCount: deliveryRows.length,
	};
}
