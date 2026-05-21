import {
	createSafeRequestLogger,
	logSafeError,
} from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { cancelWebhookDeliveryAfterPrivacyWithdrawal } from "./privacy";
import {
	claimPendingWebhookDelivery,
	getDeliveryAttemptContext,
	getWebhookDeliveryById,
	insertAttempt,
	type WebhookDeliveryRow,
} from "./repository";
import {
	getWebhookEndpointLogTarget,
	resolveEndpointSigningSecret,
	sendWebhookDeliveryRequest,
} from "./request";

class WebhookDeliveryAttemptError extends Error {
	readonly statusCode: number | null;

	constructor(message: string, statusCode: number | null) {
		super(message);
		this.name = "WebhookDeliveryAttemptError";
		this.statusCode = statusCode;
	}
}

async function persistWebhookDeliveryAttemptResult({
	attemptedAt,
	delivery,
	response,
}: {
	attemptedAt: Date;
	delivery: WebhookDeliveryRow;
	response: Response;
}): Promise<void> {
	const nextAttemptCount = delivery.attemptCount + 1;

	await insertAttempt({
		deliveryId: delivery.id,
		status: response.ok ? "succeeded" : "failed",
		statusCode: response.status,
	});

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: attemptedAt,
			lastStatusCode: response.status,
			nextAttemptAt: null,
			payload: response.ok ? null : delivery.payload,
			payloadExpiresAt: response.ok ? null : delivery.payloadExpiresAt,
			payloadRetentionReason: response.ok ? "delivered" : "pending_delivery",
			payloadScrubbedAt: response.ok ? attemptedAt : delivery.payloadScrubbedAt,
			status: response.ok ? "succeeded" : "pending",
		})
		.where(
			and(
				eq(webhook_deliveries.id, delivery.id),
				eq(webhook_deliveries.status, "delivering"),
			),
		);
}

async function recordPreflightFailure({
	deliveryId,
}: {
	deliveryId: string;
}): Promise<void> {
	const delivery = await getWebhookDeliveryById(deliveryId);

	if (!delivery?.payload) {
		return;
	}

	const nextAttemptCount = delivery.attemptCount + 1;

	await insertAttempt({
		deliveryId,
		status: "failed",
		statusCode: null,
	});

	await db
		.update(webhook_deliveries)
		.set({
			attemptCount: nextAttemptCount,
			lastAttemptAt: new Date(),
			lastStatusCode: null,
			nextAttemptAt: null,
			status: "pending",
		})
		.where(
			and(
				eq(webhook_deliveries.id, deliveryId),
				eq(webhook_deliveries.status, "delivering"),
			),
		);
}

export async function runWebhookDeliveryAttempt({
	authSecret,
	deliveryId,
}: {
	authSecret: string;
	deliveryId: string;
}): Promise<void> {
	const context = await getDeliveryAttemptContext(deliveryId);

	if (!context) {
		return;
	}

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const claimedDelivery = await claimPendingWebhookDelivery(deliveryId);
	if (!claimedDelivery) {
		const currentDelivery = await getWebhookDeliveryById(deliveryId);
		if (
			!currentDelivery?.payload ||
			currentDelivery.payloadRetentionReason === "privacy_request"
		) {
			return;
		}

		if (
			currentDelivery?.status === "pending" ||
			currentDelivery?.status === "delivering"
		) {
			throw new WebhookDeliveryAttemptError(
				"webhook_delivery_claim_unavailable",
				null,
			);
		}

		return;
	}

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const latestClaimedDelivery = await getWebhookDeliveryById(deliveryId);
	if (
		latestClaimedDelivery?.status !== "delivering" ||
		!latestClaimedDelivery.payload ||
		latestClaimedDelivery.payloadRetentionReason === "privacy_request"
	) {
		return;
	}

	if (!context.endpoint.enabled) {
		await recordPreflightFailure({ deliveryId });
		throw new WebhookDeliveryAttemptError(
			"webhook_delivery_endpoint_disabled_or_payload_missing",
			null,
		);
	}

	const signingSecret = await resolveEndpointSigningSecret({
		authSecret,
		endpoint: context.endpoint,
	});

	if (!signingSecret) {
		await recordPreflightFailure({ deliveryId });
		throw new WebhookDeliveryAttemptError(
			"webhook_delivery_signing_secret_unavailable",
			null,
		);
	}

	if (
		await cancelWebhookDeliveryAfterPrivacyWithdrawal({
			deliveryId,
			event: context.event,
		})
	) {
		return;
	}

	const deliveryBeforeSend = await getWebhookDeliveryById(deliveryId);
	if (
		deliveryBeforeSend?.status !== "delivering" ||
		!deliveryBeforeSend.payload ||
		deliveryBeforeSend.payloadRetentionReason === "privacy_request"
	) {
		return;
	}

	const now = new Date();

	let response: Response;
	try {
		response = await sendWebhookDeliveryRequest({
			delivery: deliveryBeforeSend,
			endpoint: context.endpoint,
			eventType: context.event.type,
			signingSecret,
		});
	} catch (error) {
		const logger = createSafeRequestLogger({
			headers: new Headers(),
			method: "POST",
			path: "/internal/webhook-delivery",
		});
		logSafeError(logger, {
			code: "webhook_delivery_attempt_threw",
			details: {
				delivery_id: deliveryId,
				endpoint_url: getWebhookEndpointLogTarget(context.endpoint.url),
			},
			error,
			event: "webhooks.delivery.attempt_threw",
			message: "Webhook delivery attempt threw before persisting a result.",
		});
		logger.emit({ _forceKeep: true });
		await recordPreflightFailure({ deliveryId });
		throw error instanceof Error
			? error
			: new WebhookDeliveryAttemptError("webhook_delivery_threw", null);
	}

	await persistWebhookDeliveryAttemptResult({
		attemptedAt: now,
		delivery: deliveryBeforeSend,
		response,
	});

	if (!response.ok) {
		throw new WebhookDeliveryAttemptError(
			`webhook_delivery_failed_${response.status}`,
			response.status,
		);
	}
}
