import {
	DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	SUPPORTED_WEBHOOK_EVENT_TYPES,
	WEBHOOK_PAYLOAD_RETENTION_HOUR_OPTIONS,
} from "@kayle-id/config/webhook-events";
import {
	type DeliveryStatus,
	parsePublicKeyInput,
	type WebhookDelivery,
	type WebhookEncryptionKey,
	type WebhookEndpoint,
	type WebhookEvent,
	type WebhookEventDelivery,
} from "./api";
import {
	EMPTY_ENDPOINT_DELIVERY_STATS,
	type EndpointDeliveryStats,
	getDeliveryActivityTimestamp,
	getEndpointDeliveryStats,
	getSelectedEndpointDeliveryStats,
} from "./stats";
import { type DeliveryTrendPoint, getEndpointDeliveryTrend } from "./trend";

export type WebhooksTab = "endpoints" | "events";
export type EndpointDetailTab = "overview" | "public-keys" | "deliveries";

export type { DeliveryTrendPoint, EndpointDeliveryStats };
export {
	EMPTY_ENDPOINT_DELIVERY_STATS,
	getDeliveryActivityTimestamp,
	getEndpointDeliveryStats,
	getEndpointDeliveryTrend,
	getSelectedEndpointDeliveryStats,
};

export interface CreateEndpointInitialPublicKey {
	jwk: JsonWebKey;
	keyId: string;
}

export interface CreateEndpointSubmission {
	enabled: boolean;
	initialPublicKey: CreateEndpointInitialPublicKey | null;
	labels: string[];
	name: string | null;
	subscribedEventTypes: string[];
	undeliveredPayloadRetentionHours: number;
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

export const WEBHOOK_PAYLOAD_RETENTION_OPTIONS =
	WEBHOOK_PAYLOAD_RETENTION_HOUR_OPTIONS.map((hours) => ({
		description:
			hours === 0
				? "Scrub encrypted payloads as soon as delivery permanently fails."
				: `Retain encrypted payloads for ${hours} hours after final delivery failure.`,
		label:
			hours === 0
				? "Do not retain after final failure"
				: hours === DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS
					? `Retain for ${hours} hours (default)`
					: hours === 168
						? "Retain for 7 days"
						: `Retain for ${hours} hours`,
		value: hours,
	}));

const WWW_PREFIX_REGEX = /^www\./;

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
	return endpoint.name?.trim() || endpoint.url;
}

export function getEndpointSecondaryLabel(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string {
	return endpoint.name?.trim()
		? endpoint.url
		: getEndpointHostLabel(endpoint.url);
}

export function getEndpointLabelsInput(labels: string[]): string {
	return labels.join(", ");
}

export function parseEndpointLabels(input: string): string[] {
	const labels = input
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const normalizedLabels = new Set<string>();

	return labels.filter((label) => {
		const normalized = label.toLowerCase();
		if (normalizedLabels.has(normalized)) {
			return false;
		}
		normalizedLabels.add(normalized);
		return true;
	});
}

export function getSuccessfulDeliveryFraction(
	deliveries: Array<Pick<WebhookEventDelivery, "status">>,
): string {
	const successfulCount = deliveries.filter(
		(delivery) => delivery.status === "succeeded",
	).length;

	return `${formatCount(successfulCount)}/${formatCount(deliveries.length)}`;
}

export function getEndpointPageSubtitle(
	endpoint: Pick<WebhookEndpoint, "name" | "url">,
): string | null {
	return endpoint.name?.trim() ? endpoint.url : null;
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

export function isWebhookEndpointDirty({
	endpoint,
	endpointEnabled,
	endpointLabelsInput,
	endpointName,
	endpointSubscribedEventTypes,
	endpointUndeliveredPayloadRetentionHours,
	endpointUrl,
}: {
	endpoint: WebhookEndpoint | null;
	endpointEnabled: boolean;
	endpointLabelsInput: string;
	endpointName: string;
	endpointSubscribedEventTypes: string[];
	endpointUndeliveredPayloadRetentionHours: number;
	endpointUrl: string;
}): boolean {
	if (!endpoint) {
		return false;
	}

	return (
		(endpoint.name ?? "") !== endpointName.trim() ||
		!areEventSelectionsEqual(
			endpoint.labels,
			parseEndpointLabels(endpointLabelsInput),
		) ||
		endpoint.url !== endpointUrl ||
		endpoint.enabled !== endpointEnabled ||
		endpoint.undelivered_payload_retention_hours !==
			endpointUndeliveredPayloadRetentionHours ||
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
		return "Dispatch confirmed Kayle check attempts to this endpoint.";
	}

	if (eventType === "verification.attempt.failed") {
		return "Dispatch not-confirmed Kayle check attempts to this endpoint.";
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

export function getWebhookDeliveryRetryDisabledReason(
	delivery: Pick<
		WebhookDelivery,
		| "payload_expires_at"
		| "payload_retention_reason"
		| "payload_scrubbed_at"
		| "status"
	>,
): string | null {
	if (delivery.status === "delivering") {
		return "Delivery is already in progress.";
	}

	if (
		delivery.payload_scrubbed_at ||
		delivery.payload_retention_reason === "delivered"
	) {
		return "Payload no longer retained.";
	}

	if (
		delivery.payload_retention_reason === "expired" ||
		!delivery.payload_expires_at ||
		new Date(delivery.payload_expires_at).getTime() <= Date.now()
	) {
		return "Payload expired; create a new verification session or handle the event manually.";
	}

	return null;
}

export function getWebhookDeliveryPayloadLabel(
	delivery: Pick<
		WebhookDelivery,
		"payload_expires_at" | "payload_retention_reason" | "payload_scrubbed_at"
	>,
): string {
	if (delivery.payload_retention_reason === "delivered") {
		return "Delivered - payload no longer retained.";
	}

	if (delivery.payload_retention_reason === "privacy_request") {
		return "Payload scrubbed after privacy request.";
	}

	if (delivery.payload_scrubbed_at) {
		return "Payload scrubbed.";
	}

	if (delivery.payload_expires_at) {
		return "Retained for replay.";
	}

	return "Payload unavailable.";
}

const BADGE_PALETTE = {
	emerald:
		"border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
	blue: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
	amber:
		"border-amber-500/20 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
	red: "border-red-500/20 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400",
	muted: "border-border bg-muted/50 text-muted-foreground",
} as const;

type BadgeStatus = DeliveryStatus | "active" | "disabled" | "inactive";

const STATUS_BADGE_CLASS: Record<BadgeStatus, string> = {
	succeeded: BADGE_PALETTE.emerald,
	active: BADGE_PALETTE.emerald,
	pending: BADGE_PALETTE.blue,
	delivering: BADGE_PALETTE.blue,
	failed: BADGE_PALETTE.red,
	inactive: BADGE_PALETTE.red,
	disabled: BADGE_PALETTE.muted,
};

export function getStatusBadgeClass(status: BadgeStatus): string {
	return STATUS_BADGE_CLASS[status];
}

export function getResponseCodeClass(statusCode: number | null): string {
	if (statusCode === null) {
		return BADGE_PALETTE.muted;
	}

	if (statusCode < 300) {
		return BADGE_PALETTE.emerald;
	}

	if (statusCode < 500) {
		return BADGE_PALETTE.amber;
	}

	return BADGE_PALETTE.red;
}
