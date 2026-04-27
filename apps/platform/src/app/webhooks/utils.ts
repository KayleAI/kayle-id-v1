import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { formatDate } from "@/utils/format-date";
import {
	type DeliveryStatus,
	parsePublicKeyInput,
	type WebhookDelivery,
	type WebhookEncryptionKey,
	type WebhookEndpoint,
	type WebhookEvent,
} from "./api";

export type WebhooksTab = "endpoints" | "events";
export type EndpointDetailTab = "overview" | "performance" | "deliveries";

export interface EndpointDeliveryStats {
	failed: number;
	inFlight: number;
	lastAttemptAt: string | null;
	lastStatusCode: number | null;
	total: number;
}

export interface DeliveryTrendPoint {
	failed: number;
	label: string;
	total: number;
}

export interface CreateEndpointInitialPublicKey {
	jwk: JsonWebKey;
	keyId: string;
}

export interface CreateEndpointSubmission {
	enabled: boolean;
	initialPublicKey: CreateEndpointInitialPublicKey | null;
	name: string | null;
	subscribedEventTypes: string[];
	url: string;
}

export interface CreateEndpointSubmissionResult {
	publicKeyError: string | null;
}

export const TAB_OPTIONS: Array<{
	label: string;
	value: WebhooksTab;
}> = [
	{
		value: "endpoints",
		label: "Endpoints",
	},
	{
		value: "events",
		label: "Events",
	},
];

export const EMPTY_ENDPOINT_DELIVERY_STATS: EndpointDeliveryStats = {
	failed: 0,
	inFlight: 0,
	lastAttemptAt: null,
	lastStatusCode: null,
	total: 0,
};

const WWW_PREFIX_REGEX = /^www\./;

export function formatOptionalDate(dateString: string | null): string {
	return dateString ? formatDate(dateString) : "Never";
}

export function formatCount(value: number): string {
	return value.toLocaleString();
}

export function formatCountLabel(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

export function getEndpointHostLabel(url: string): string {
	try {
		return new URL(url).host.replace(WWW_PREFIX_REGEX, "");
	} catch {
		return url;
	}
}

export function getEndpointPathLabel(url: string): string {
	try {
		const parsedUrl = new URL(url);
		return parsedUrl.pathname === "/" ? parsedUrl.host : parsedUrl.pathname;
	} catch {
		return url;
	}
}

export function getEndpointDisplayName(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string {
	return endpoint.name?.trim() || getEndpointPathLabel(endpoint.url);
}

export function getEndpointPageTitle(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string {
	return endpoint.name?.trim() || getEndpointHostLabel(endpoint.url);
}

export function getEndpointSecondaryLabel(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string {
	return endpoint.name?.trim()
		? endpoint.url
		: getEndpointHostLabel(endpoint.url);
}

export function getEndpointPageSubtitle(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string {
	return endpoint.url;
}

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

export function getEndpointsById(
	endpoints: WebhookEndpoint[],
): Record<string, WebhookEndpoint> {
	return Object.fromEntries(
		endpoints.map((endpoint) => [endpoint.id, endpoint] as const),
	);
}

export function getDeliveriesForEvent(
	deliveries: WebhookDelivery[],
	eventId: string,
): WebhookDelivery[] {
	return deliveries
		.filter((delivery) => delivery.event_id === eventId)
		.sort((left, right) =>
			getDeliveryActivityTimestamp(right).localeCompare(
				getDeliveryActivityTimestamp(left),
			),
		);
}

export function getAttachedEndpointIds(event: WebhookEvent): string[] {
	return Array.from(
		new Set(event.deliveries.map((delivery) => delivery.webhook_endpoint_id)),
	);
}

export function getRecentDeliveriesForEndpoint(
	deliveries: WebhookDelivery[],
	endpointId: string,
	limit = 10,
): WebhookDelivery[] {
	return deliveries
		.filter((delivery) => delivery.webhook_endpoint_id === endpointId)
		.sort((left, right) =>
			getDeliveryActivityTimestamp(right).localeCompare(
				getDeliveryActivityTimestamp(left),
			),
		)
		.slice(0, limit);
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

export function isWebhookEndpointDirty({
	endpoint,
	endpointEnabled,
	endpointName,
	endpointSubscribedEventTypes,
	endpointUrl,
}: {
	endpoint: WebhookEndpoint | null;
	endpointEnabled: boolean;
	endpointName: string;
	endpointSubscribedEventTypes: string[];
	endpointUrl: string;
}): boolean {
	if (!endpoint) {
		return false;
	}

	return (
		(endpoint.name ?? "") !== endpointName.trim() ||
		endpoint.url !== endpointUrl ||
		endpoint.enabled !== endpointEnabled ||
		!areEventSelectionsEqual(
			endpoint.subscribed_event_types,
			endpointSubscribedEventTypes,
		)
	);
}

export function shouldShowMissingKeyAlert({
	endpoint,
	isKeysLoading,
	keys,
}: {
	endpoint: WebhookEndpoint | null;
	isKeysLoading: boolean;
	keys: WebhookEncryptionKey[];
}): boolean {
	return (
		endpoint !== null && !isKeysLoading && keys.every((key) => !key.is_active)
	);
}

export function getEventTriggerLabel(event: WebhookEvent): string {
	return event.trigger_type.replace("_", " ");
}

export function areEventSelectionsEqual(
	left: string[],
	right: string[],
): boolean {
	const normalizedLeft = [...left].sort();
	const normalizedRight = [...right].sort();

	if (normalizedLeft.length !== normalizedRight.length) {
		return false;
	}

	return normalizedLeft.every(
		(eventType, index) => eventType === normalizedRight[index],
	);
}

export function toggleEventSelection(
	selectedEventTypes: string[],
	eventType: string,
): string[] {
	if (selectedEventTypes.includes(eventType)) {
		if (selectedEventTypes.length === 1) {
			return selectedEventTypes;
		}

		return selectedEventTypes.filter(
			(selectedEventType) => selectedEventType !== eventType,
		);
	}

	return [...selectedEventTypes, eventType];
}

export function getWebhookEventTypeDescription(eventType: string): string {
	if (eventType === "verification.attempt.succeeded") {
		return "Dispatch completed verification attempts to this endpoint.";
	}

	if (eventType === "verification.attempt.failed") {
		return "Dispatch failed verification attempts to this endpoint.";
	}

	if (eventType === "verification.session.expired") {
		return "Dispatch verification sessions that expire before completion.";
	}

	if (eventType === "verification.session.cancelled") {
		return "Dispatch verification sessions cancelled by the platform.";
	}

	return "Dispatch this event type to the endpoint when it is emitted.";
}

export function getEventSubscriptionSummary(
	selectedEventTypes: string[],
): string {
	if (selectedEventTypes.length === SUPPORTED_WEBHOOK_EVENT_TYPES.length) {
		return "All events";
	}

	return formatCountLabel(selectedEventTypes.length, "event");
}

export async function getCreateEndpointInitialPublicKey({
	publicKeyId,
	publicKeyInput,
	shouldConfigurePublicKey,
}: {
	publicKeyId: string;
	publicKeyInput: string;
	shouldConfigurePublicKey: boolean;
}): Promise<CreateEndpointInitialPublicKey | null> {
	if (!shouldConfigurePublicKey) {
		return null;
	}

	if (!publicKeyId.trim()) {
		throw new Error("Key ID is required.");
	}

	return {
		jwk: await parsePublicKeyInput(publicKeyInput),
		keyId: publicKeyId.trim(),
	};
}

export function getWebhookEventReplayDisabledReason(
	event: WebhookEvent,
): string | null {
	if (event.deliveries.length === 0) {
		return "This event has no deliveries to replay.";
	}

	return null;
}

export function getStatusBadgeClass(
	status: DeliveryStatus | "active" | "disabled" | "inactive",
): string {
	if (status === "active" || status === "succeeded") {
		return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400";
	}

	if (status === "disabled") {
		return "border-border bg-muted/50 text-muted-foreground";
	}

	if (status === "pending" || status === "delivering") {
		return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400";
	}

	return "border-red-500/20 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400";
}

export function getResponseCodeClass(statusCode: number | null): string {
	if (statusCode === null) {
		return "border-border bg-muted/50 text-muted-foreground";
	}

	if (statusCode < 300) {
		return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400";
	}

	if (statusCode < 500) {
		return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400";
	}

	return "border-red-500/20 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400";
}
