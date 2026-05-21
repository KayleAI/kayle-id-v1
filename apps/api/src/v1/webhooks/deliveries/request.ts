import { parseSafeUrl } from "@kayle-id/config/safe-url";
import type { SupportedWebhookEventType } from "@kayle-id/config/webhook-events";
import {
	createWebhookSignatureHeader,
	decryptWebhookSigningSecret,
} from "@/v1/webhooks/signing-secret";
import type { WebhookDeliveryRow, WebhookEndpointRow } from "./repository";

const WEBHOOK_DELIVERY_TIMEOUT_MS = 15_000;
const WEBHOOK_FETCH_REJECTED_STATUS = 400;
const ALLOW_LOOPBACK_WEBHOOK_URLS = process.env.NODE_ENV !== "production";

export async function resolveEndpointSigningSecret({
	authSecret,
	endpoint,
}: {
	authSecret: string;
	endpoint: WebhookEndpointRow;
}): Promise<string | null> {
	if (!endpoint.signingSecretCiphertext) {
		return null;
	}

	try {
		return await decryptWebhookSigningSecret({
			ciphertext: endpoint.signingSecretCiphertext,
			secret: authSecret,
		});
	} catch {
		return null;
	}
}

export function getWebhookEndpointLogTarget(endpointUrl: string): string {
	try {
		return new URL(endpointUrl).origin;
	} catch {
		return "invalid_webhook_url";
	}
}

export async function sendWebhookDeliveryRequest({
	delivery,
	endpoint,
	eventType,
	signingSecret,
}: {
	delivery: WebhookDeliveryRow;
	endpoint: WebhookEndpointRow;
	eventType: SupportedWebhookEventType;
	signingSecret: string;
}): Promise<Response> {
	const urlOutcome = parseSafeUrl(endpoint.url, {
		allowLoopback: ALLOW_LOOPBACK_WEBHOOK_URLS,
		mode: "webhook",
	});

	if (!urlOutcome.ok) {
		return new Response(
			JSON.stringify({
				error: {
					code: "WEBHOOK_URL_REJECTED",
					message: `Webhook endpoint URL is not acceptable: ${urlOutcome.reason}`,
				},
			}),
			{
				headers: { "Content-Type": "application/json" },
				status: WEBHOOK_FETCH_REJECTED_STATUS,
			},
		);
	}

	const signatureHeader = await createWebhookSignatureHeader({
		payload: delivery.payload ?? "",
		secret: signingSecret,
	});

	return fetch(urlOutcome.url.toString(), {
		body: delivery.payload,
		headers: {
			"Content-Type": "application/jose",
			"X-Kayle-Delivery-Id": delivery.id,
			"X-Kayle-Event": eventType,
			"X-Kayle-Signature": signatureHeader,
		},
		method: "POST",
		redirect: "manual",
		signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
	});
}
