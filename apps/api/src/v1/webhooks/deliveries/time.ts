import { MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS } from "@kayle-id/config/webhook-events";
import { WEBHOOK_AUTOMATIC_RETRY_WINDOW_MS } from "./types";

export const HOUR_MS = 60 * 60_000;
export const WEBHOOK_PAYLOAD_RETENTION_SWEEP_BATCH_SIZE = 500;

export function addHours(date: Date, hours: number): Date {
	return new Date(date.getTime() + hours * HOUR_MS);
}

export function getPendingPayloadExpiry({
	retentionHours,
	now,
}: {
	retentionHours: number;
	now: Date;
}): Date {
	const boundedRetentionHours = Math.min(
		Math.max(retentionHours, 0),
		MAX_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	);

	return new Date(
		now.getTime() +
			WEBHOOK_AUTOMATIC_RETRY_WINDOW_MS +
			boundedRetentionHours * HOUR_MS,
	);
}
