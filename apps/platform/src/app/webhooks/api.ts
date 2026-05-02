import {
	type Pagination,
	requestApiResource,
	requestApiResourcePage,
} from "@/utils/api-client";
import type {
	DeliveryStatus,
	WebhookDeleteResult,
	WebhookDelivery,
	WebhookEncryptionKey,
	WebhookEndpoint,
	WebhookEndpointCreateResult,
	WebhookEvent,
	WebhookSigningSecretResult,
} from "./types";

export { parseJwkInput, parsePublicKeyInput } from "./jwk";
export type {
	ApiError,
	DeliveryStatus,
	Pagination,
	WebhookDeleteResult,
	WebhookDelivery,
	WebhookEncryptionKey,
	WebhookEndpoint,
	WebhookEndpointCreateResult,
	WebhookEvent,
	WebhookEventDelivery,
	WebhookSigningSecretResult,
} from "./types";

const WEBHOOKS_PATH = "/api/webhooks";
const UNEXPECTED_WEBHOOK_RESPONSE = "Unexpected webhook response.";

export function listWebhookEndpoints({
	enabled,
	limit = 20,
	startingAfter,
}: {
	enabled?: boolean;
	limit?: number;
	startingAfter?: string | null;
} = {}): Promise<{ data: WebhookEndpoint[]; pagination: Pagination }> {
	return requestApiResourcePage<WebhookEndpoint>({
		basePath: WEBHOOKS_PATH,
		path: "/endpoints",
		query: {
			enabled,
			limit,
			starting_after: startingAfter,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function createWebhookEndpoint({
	enabled,
	name,
	subscribedEventTypes,
	url,
}: {
	enabled: boolean;
	name?: string | null;
	subscribedEventTypes: string[];
	url: string;
}): Promise<WebhookEndpointCreateResult> {
	return requestApiResource<WebhookEndpointCreateResult>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: "/endpoints",
		body: {
			name,
			url,
			enabled,
			subscribed_event_types: subscribedEventTypes,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function updateWebhookEndpoint({
	endpointId,
	enabled,
	name,
	subscribedEventTypes,
	url,
}: {
	endpointId: string;
	enabled: boolean;
	name?: string | null;
	subscribedEventTypes: string[];
	url: string;
}): Promise<WebhookEndpoint> {
	return requestApiResource<WebhookEndpoint>({
		basePath: WEBHOOKS_PATH,
		method: "PATCH",
		path: `/endpoints/${endpointId}`,
		body: {
			name,
			url,
			enabled,
			subscribed_event_types: subscribedEventTypes,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function deleteWebhookEndpoint(
	endpointId: string,
): Promise<WebhookDeleteResult> {
	return requestApiResource<WebhookDeleteResult>({
		basePath: WEBHOOKS_PATH,
		method: "DELETE",
		path: `/endpoints/${endpointId}`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function revealWebhookSigningSecret(
	endpointId: string,
): Promise<WebhookSigningSecretResult> {
	return requestApiResource<WebhookSigningSecretResult>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/endpoints/${endpointId}/signing-secret/reveal`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function rotateWebhookSigningSecret(
	endpointId: string,
): Promise<WebhookSigningSecretResult> {
	return requestApiResource<WebhookSigningSecretResult>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/endpoints/${endpointId}/signing-secret/rotate`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function listWebhookKeys({
	endpointId,
	isActive,
	limit = 20,
	startingAfter,
}: {
	endpointId: string;
	isActive?: boolean;
	limit?: number;
	startingAfter?: string | null;
}): Promise<{ data: WebhookEncryptionKey[]; pagination: Pagination }> {
	return requestApiResourcePage<WebhookEncryptionKey>({
		basePath: WEBHOOKS_PATH,
		path: `/endpoints/${endpointId}/keys`,
		query: {
			is_active: isActive,
			limit,
			starting_after: startingAfter,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function createWebhookKey({
	endpointId,
	jwk,
	keyId,
}: {
	endpointId: string;
	jwk: JsonWebKey;
	keyId: string;
}): Promise<WebhookEncryptionKey> {
	return requestApiResource<WebhookEncryptionKey>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/endpoints/${endpointId}/keys`,
		body: {
			key_id: keyId,
			jwk,
			algorithm: "RSA-OAEP-256",
			key_type: "RSA",
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function deactivateWebhookKey(
	keyId: string,
): Promise<WebhookEncryptionKey> {
	return requestApiResource<WebhookEncryptionKey>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/keys/${keyId}/deactivate`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function reactivateWebhookKey(
	keyId: string,
): Promise<WebhookEncryptionKey> {
	return requestApiResource<WebhookEncryptionKey>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/keys/${keyId}/reactivate`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function listWebhookEvents({
	limit = 20,
	startingAfter,
}: {
	limit?: number;
	startingAfter?: string | null;
} = {}): Promise<{ data: WebhookEvent[]; pagination: Pagination }> {
	return requestApiResourcePage<WebhookEvent>({
		basePath: WEBHOOKS_PATH,
		path: "/events",
		query: {
			limit,
			starting_after: startingAfter,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function replayWebhookEvent(eventId: string): Promise<WebhookEvent> {
	return requestApiResource<WebhookEvent>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/events/${eventId}/replay`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function listWebhookDeliveries({
	endpointId,
	limit = 20,
	startingAfter,
	status,
}: {
	endpointId?: string;
	limit?: number;
	startingAfter?: string | null;
	status?: DeliveryStatus;
} = {}): Promise<{ data: WebhookDelivery[]; pagination: Pagination }> {
	return requestApiResourcePage<WebhookDelivery>({
		basePath: WEBHOOKS_PATH,
		path: "/deliveries",
		query: {
			endpoint_id: endpointId,
			limit,
			starting_after: startingAfter,
			status,
		},
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}

export function retryWebhookDelivery(
	deliveryId: string,
): Promise<WebhookDelivery> {
	return requestApiResource<WebhookDelivery>({
		basePath: WEBHOOKS_PATH,
		method: "POST",
		path: `/deliveries/${deliveryId}/retry`,
		unexpectedMessage: UNEXPECTED_WEBHOOK_RESPONSE,
	});
}
