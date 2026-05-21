import {
	createSafeRequestLogger,
	logEvent,
	logSafeError,
} from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { HOUR_MS, WEBHOOK_PAYLOAD_RETENTION_SWEEP_BATCH_SIZE } from "./time";

export type WebhookPayloadRetentionSweepResult = {
	failed: boolean;
	orgCount: number;
	scrubbedCount: number;
};

function getWebhookPayloadSweepAgeBucket({
	expiresAt,
	now,
}: {
	expiresAt: Date;
	now: Date;
}): "lt_1h" | "lt_24h" | "gte_24h" {
	const overdueMs = Math.max(now.getTime() - expiresAt.getTime(), 0);

	if (overdueMs < HOUR_MS) {
		return "lt_1h";
	}

	if (overdueMs < 24 * HOUR_MS) {
		return "lt_24h";
	}

	return "gte_24h";
}

export async function runWebhookPayloadRetentionSweep({
	batchSize = WEBHOOK_PAYLOAD_RETENTION_SWEEP_BATCH_SIZE,
	now,
}: {
	batchSize?: number;
	now: Date;
}): Promise<WebhookPayloadRetentionSweepResult> {
	const logger = createSafeRequestLogger({
		headers: new Headers(),
		method: "SCHEDULED",
		path: "/internal/webhook-payload-retention-sweep",
	});

	try {
		const expiredRows = await db
			.select({
				deliveryId: webhook_deliveries.id,
				expiresAt: webhook_deliveries.payloadExpiresAt,
				organizationId: events.organizationId,
			})
			.from(webhook_deliveries)
			.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
			.where(andExpiredPayload(now))
			.orderBy(asc(webhook_deliveries.payloadExpiresAt))
			.limit(batchSize);

		if (expiredRows.length === 0) {
			logSweepCompletion(logger, {
				ageBuckets: {
					gte_24h: 0,
					lt_1h: 0,
					lt_24h: 0,
				},
				forceKeep: false,
				orgCount: 0,
				scrubbedCount: 0,
			});
			return { failed: false, orgCount: 0, scrubbedCount: 0 };
		}

		const ageBuckets = {
			lt_1h: 0,
			lt_24h: 0,
			gte_24h: 0,
		};
		const organizationIds = new Set<string>();
		const deliveryIds: string[] = [];

		for (const row of expiredRows) {
			if (!row.expiresAt) {
				continue;
			}

			deliveryIds.push(row.deliveryId);
			organizationIds.add(row.organizationId);
			ageBuckets[
				getWebhookPayloadSweepAgeBucket({ expiresAt: row.expiresAt, now })
			] += 1;
		}

		if (deliveryIds.length > 0) {
			await db
				.update(webhook_deliveries)
				.set({
					payload: null,
					payloadExpiresAt: null,
					payloadRetentionReason: "expired",
					payloadScrubbedAt: now,
				})
				.where(inArray(webhook_deliveries.id, deliveryIds));
		}

		logSweepCompletion(logger, {
			ageBuckets,
			forceKeep: deliveryIds.length > 0,
			orgCount: organizationIds.size,
			scrubbedCount: deliveryIds.length,
		});

		return {
			failed: false,
			orgCount: organizationIds.size,
			scrubbedCount: deliveryIds.length,
		};
	} catch (error) {
		logSafeError(logger, {
			code: "webhook_payload_retention_sweep_failed",
			error,
			event: "webhooks.payload_retention_sweep.failed",
			message: "Webhook payload retention sweep failed.",
		});
		logger.emit({ _forceKeep: true });

		return { failed: true, orgCount: 0, scrubbedCount: 0 };
	}
}

function andExpiredPayload(now: Date) {
	return and(
		isNotNull(webhook_deliveries.payload),
		isNotNull(webhook_deliveries.payloadExpiresAt),
		lte(webhook_deliveries.payloadExpiresAt, now),
	);
}

function logSweepCompletion(
	logger: ReturnType<typeof createSafeRequestLogger>,
	{
		ageBuckets,
		forceKeep,
		orgCount,
		scrubbedCount,
	}: {
		ageBuckets: Record<"gte_24h" | "lt_1h" | "lt_24h", number>;
		forceKeep: boolean;
		orgCount: number;
		scrubbedCount: number;
	},
): void {
	logEvent(logger, {
		details: {
			age_bucket_gte_24h: ageBuckets.gte_24h,
			age_bucket_lt_1h: ageBuckets.lt_1h,
			age_bucket_lt_24h: ageBuckets.lt_24h,
			org_count: orgCount,
			scrubbed_count: scrubbedCount,
		},
		event: "webhooks.payload_retention_sweep.completed",
	});
	logger.emit({ _forceKeep: forceKeep });
}
