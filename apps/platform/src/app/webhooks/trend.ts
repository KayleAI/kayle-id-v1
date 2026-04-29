import type { WebhookDelivery } from "./api";
import { getDeliveryActivityTimestamp } from "./stats";

export interface DeliveryTrendPoint {
	failed: number;
	label: string;
	total: number;
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

function getDeliveryTrendAnchorDate(
	deliveries: WebhookDelivery[],
	endpointId: string,
): Date {
	const endpointDeliveries = deliveries.filter(
		(delivery) => delivery.webhook_endpoint_id === endpointId,
	);

	if (endpointDeliveries.length === 0) {
		return new Date();
	}

	const latestTimestamp = endpointDeliveries.reduce((latest, delivery) => {
		const nextTimestamp = Date.parse(getDeliveryActivityTimestamp(delivery));
		return Number.isNaN(nextTimestamp)
			? latest
			: Math.max(latest, nextTimestamp);
	}, 0);

	return latestTimestamp > 0 ? new Date(latestTimestamp) : new Date();
}

export function getEndpointDeliveryTrend(
	deliveries: WebhookDelivery[],
	endpointId: string,
	days = 7,
): DeliveryTrendPoint[] {
	const anchorDate = getDeliveryTrendAnchorDate(deliveries, endpointId);
	const points = new Map<string, DeliveryTrendPoint>();

	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = new Date(anchorDate);
		date.setDate(anchorDate.getDate() - offset);

		const key = formatDateKey(date);
		points.set(key, {
			failed: 0,
			label: date.toLocaleDateString("en-US", {
				day: "numeric",
				month: "numeric",
			}),
			total: 0,
		});
	}

	for (const delivery of deliveries) {
		if (delivery.webhook_endpoint_id !== endpointId) {
			continue;
		}

		const activityDate = new Date(getDeliveryActivityTimestamp(delivery));
		const point = points.get(formatDateKey(activityDate));

		if (!point) {
			continue;
		}

		point.total += 1;

		if (delivery.status === "failed") {
			point.failed += 1;
		}
	}

	return Array.from(points.values());
}
