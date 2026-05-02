import type { WebhookDelivery, WebhookEndpoint } from "./api";

export interface EndpointDeliveryStats {
	failed: number;
	inFlight: number;
	lastAttemptAt: string | null;
	lastStatusCode: number | null;
	total: number;
}

export const EMPTY_ENDPOINT_DELIVERY_STATS: EndpointDeliveryStats = {
	failed: 0,
	inFlight: 0,
	lastAttemptAt: null,
	lastStatusCode: null,
	total: 0,
};

export function getDeliveryActivityTimestamp(
	delivery: WebhookDelivery,
): string {
	return delivery.last_attempt_at ?? delivery.updated_at ?? delivery.created_at;
}

export function getEndpointDeliveryStats(
	deliveries: WebhookDelivery[],
): Record<string, EndpointDeliveryStats> {
	const statsByEndpoint = new Map<string, EndpointDeliveryStats>();
	const latestActivityByEndpoint = new Map<string, string>();

	for (const delivery of deliveries) {
		const current =
			statsByEndpoint.get(delivery.webhook_endpoint_id) ??
			EMPTY_ENDPOINT_DELIVERY_STATS;
		const currentActivityTime = latestActivityByEndpoint.get(
			delivery.webhook_endpoint_id,
		);
		const nextActivityTime = getDeliveryActivityTimestamp(delivery);
		const useLatestDetails =
			!currentActivityTime || currentActivityTime <= nextActivityTime;

		statsByEndpoint.set(delivery.webhook_endpoint_id, {
			failed: current.failed + (delivery.status === "failed" ? 1 : 0),
			inFlight:
				current.inFlight +
				(delivery.status === "pending" || delivery.status === "delivering"
					? 1
					: 0),
			lastAttemptAt: useLatestDetails
				? delivery.last_attempt_at
				: current.lastAttemptAt,
			lastStatusCode: useLatestDetails
				? delivery.last_status_code
				: current.lastStatusCode,
			total: current.total + 1,
		});

		if (useLatestDetails) {
			latestActivityByEndpoint.set(
				delivery.webhook_endpoint_id,
				nextActivityTime,
			);
		}
	}

	return Object.fromEntries(statsByEndpoint);
}

export function getSelectedEndpointDeliveryStats(
	deliveries: WebhookDelivery[],
	endpoint: WebhookEndpoint | null,
): EndpointDeliveryStats {
	if (!endpoint) {
		return EMPTY_ENDPOINT_DELIVERY_STATS;
	}

	return (
		getEndpointDeliveryStats(deliveries)[endpoint.id] ??
		EMPTY_ENDPOINT_DELIVERY_STATS
	);
}
