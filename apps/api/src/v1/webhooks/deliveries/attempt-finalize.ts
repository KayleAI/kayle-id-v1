import { MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { eq } from "drizzle-orm";
import {
	getDeliveryAttemptContext,
	getWebhookDeliveryById,
} from "./repository";
import { addHours } from "./time";

export async function finalizeWebhookDeliveryFailure({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const context = await getDeliveryAttemptContext(deliveryId);
	const delivery =
		context?.delivery ?? (await getWebhookDeliveryById(deliveryId));

	if (!delivery) {
		return;
	}

	if (delivery.status === "succeeded" || delivery.status === "failed") {
		return;
	}

	const terminalFailureAt = new Date();
	const retentionHours =
		context?.endpoint.undeliveredPayloadRetentionHours ??
		MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS;
	const payloadExpiresAt = addHours(terminalFailureAt, retentionHours);
	const shouldScrubImmediately =
		delivery.payload === null || retentionHours === 0;

	await db
		.update(webhook_deliveries)
		.set({
			nextAttemptAt: null,
			payload: shouldScrubImmediately ? null : delivery.payload,
			payloadExpiresAt: shouldScrubImmediately ? null : payloadExpiresAt,
			payloadRetentionReason: shouldScrubImmediately
				? "expired"
				: "terminal_failure_retention",
			payloadScrubbedAt: shouldScrubImmediately ? terminalFailureAt : null,
			status: "failed",
		})
		.where(eq(webhook_deliveries.id, deliveryId));
}
