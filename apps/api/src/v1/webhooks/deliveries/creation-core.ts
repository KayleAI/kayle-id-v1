import { indexBy } from "@kayle-id/config/collections";
import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import {
	webhook_deliveries,
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, eq, inArray } from "drizzle-orm";
import { createJWE } from "@/functions/jwe";
import { generateId } from "@/utils/generate-id";
import {
	getWebhookEndpointTargetIdsForSession,
	insertAttempt,
} from "./repository";
import { getPendingPayloadExpiry } from "./time";
import type { WebhookPayload } from "./types";

function isSubscribedToEventType(
	subscribedEventTypes: unknown,
	eventType: SupportedWebhookEventType,
): boolean {
	return (
		Array.isArray(subscribedEventTypes) &&
		subscribedEventTypes.includes(eventType)
	);
}

export async function createWebhookDeliveriesForEvent({
	eventId,
	eventType,
	organizationId,
	payload,
	webhookEndpointIds,
}: {
	eventId: string;
	eventType: SupportedWebhookEventType;
	organizationId: string;
	payload: WebhookPayload;
	webhookEndpointIds?: string[] | null;
}): Promise<string[]> {
	const serializedPayload = JSON.stringify(payload);
	const targetEndpointIds = webhookEndpointIds?.length
		? webhookEndpointIds
		: null;
	const candidateEndpoints = await db
		.select()
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.organizationId, organizationId),
				eq(webhook_endpoints.enabled, true),
				...(targetEndpointIds
					? [inArray(webhook_endpoints.id, targetEndpointIds)]
					: []),
			),
		);

	const subscribedEndpoints = candidateEndpoints.filter((endpoint) =>
		isSubscribedToEventType(endpoint.subscribedEventTypes, eventType),
	);

	if (subscribedEndpoints.length === 0) {
		return [];
	}

	const encryptionKeys = await db
		.select()
		.from(webhook_encryption_keys)
		.where(
			and(
				eq(webhook_encryption_keys.isActive, true),
				inArray(
					webhook_encryption_keys.webhookEndpointId,
					subscribedEndpoints.map((endpoint) => endpoint.id),
				),
			),
		);

	const keysByEndpointId = indexBy(encryptionKeys, "webhookEndpointId");
	const createdDeliveryIds: string[] = [];

	for (const endpoint of subscribedEndpoints) {
		const key = keysByEndpointId.get(endpoint.id) ?? null;
		const deliveryId = generateId({
			type: "whd",
		});
		createdDeliveryIds.push(deliveryId);
		const now = new Date();
		const payloadExpiresAt = getPendingPayloadExpiry({
			now,
			retentionHours: endpoint.undeliveredPayloadRetentionHours,
		});

		if (!key) {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: now,
				nextAttemptAt: null,
				payload: null,
				payloadRetentionReason: "no_active_key",
				payloadScrubbedAt: now,
				status: "failed",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: null,
			});
			await insertAttempt({
				deliveryId,
				status: "failed",
				statusCode: null,
			});
			continue;
		}

		try {
			const encryptedPayload = await createJWE(serializedPayload, {
				algorithm: "RSA-OAEP-256",
				keyId: key.keyId,
				publicJwk: key.jwk as Record<string, unknown>,
			});

			await db.insert(webhook_deliveries).values({
				eventId,
				id: deliveryId,
				payload: encryptedPayload,
				payloadExpiresAt,
				payloadRetentionReason: "pending_delivery",
				status: "pending",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: key.id,
			});
		} catch {
			await db.insert(webhook_deliveries).values({
				id: deliveryId,
				attemptCount: 1,
				eventId,
				lastAttemptAt: now,
				nextAttemptAt: null,
				payload: null,
				payloadRetentionReason: "jwe_creation_failed",
				payloadScrubbedAt: now,
				status: "failed",
				webhookEndpointId: endpoint.id,
				webhookEncryptionKeyId: key.id,
			});
			await insertAttempt({
				deliveryId,
				status: "failed",
				statusCode: null,
			});
		}
	}

	return createdDeliveryIds;
}

export async function createVerificationSessionWebhookDeliveries({
	eventId,
	eventType,
	organizationId,
	payload,
	sessionId,
}: {
	eventId: string;
	eventType: SupportedWebhookEventType;
	organizationId: string;
	payload: WebhookPayload;
	sessionId: string;
}): Promise<string[]> {
	const webhookEndpointIds =
		await getWebhookEndpointTargetIdsForSession(sessionId);

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType,
		organizationId,
		payload,
		webhookEndpointIds,
	});
}
