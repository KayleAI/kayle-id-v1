import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import type { WebhookEvent } from "@/openapi/models/webhook";
import { listWebhookEvents } from "@/openapi/v1/webhooks/events/list";

type WebhookEventResponse = (typeof WebhookEvent)["_output"];

const listEvents = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId: string };
}>();

listEvents.openapi(listWebhookEvents, async (c) => {
	const organizationId = c.get("organizationId");
	const query = c.req.valid("query");

	const limit = query.limit ?? 10;

	const where = and(
		eq(events.organizationId, organizationId),
		...(query.type ? [eq(events.type, query.type)] : []),
		...(query.created_from
			? [gte(events.createdAt, new Date(query.created_from))]
			: []),
		...(query.created_to
			? [lte(events.createdAt, new Date(query.created_to))]
			: []),
		...(query.starting_after
			? await getStartingAfterPredicate({
					cursorId: query.starting_after,
					organizationId,
				})
			: []),
	);

	const rows = await db
		.select({
			id: events.id,
			type: events.type,
			trigger_type: events.triggerType,
			trigger_id: events.triggerId,
			created_at: events.createdAt,
		})
		.from(events)
		.where(where)
		.orderBy(desc(events.createdAt), desc(events.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

	// Fetch deliveries summary for each event in the current page.
	const eventIds = pageRows.map((row) => row.id);

	const deliveries =
		eventIds.length === 0
			? []
			: await db
					.select({
						event_id: webhook_deliveries.eventId,
						id: webhook_deliveries.id,
						webhook_endpoint_id: webhook_deliveries.webhookEndpointId,
						status: webhook_deliveries.status,
						last_status_code: webhook_deliveries.lastStatusCode,
						attempt_count: webhook_deliveries.attemptCount,
						last_attempt_at: webhook_deliveries.lastAttemptAt,
						payload_expires_at: webhook_deliveries.payloadExpiresAt,
						payload_retention_reason: webhook_deliveries.payloadRetentionReason,
						payload_scrubbed_at: webhook_deliveries.payloadScrubbedAt,
					})
					.from(webhook_deliveries)
					.where(inArray(webhook_deliveries.eventId, eventIds));

	const deliveriesByEvent = new Map<
		string,
		WebhookEventResponse["deliveries"]
	>();
	for (const delivery of deliveries) {
		const mappedDelivery = {
			id: delivery.id,
			webhook_endpoint_id: delivery.webhook_endpoint_id,
			status: delivery.status,
			last_status_code: delivery.last_status_code,
			attempt_count: delivery.attempt_count,
			last_attempt_at: delivery.last_attempt_at?.toISOString() ?? null,
			payload_expires_at: delivery.payload_expires_at?.toISOString() ?? null,
			payload_retention_reason: delivery.payload_retention_reason,
			payload_scrubbed_at: delivery.payload_scrubbed_at?.toISOString() ?? null,
		};
		const existing = deliveriesByEvent.get(delivery.event_id);
		if (existing) {
			existing.push(mappedDelivery);
		} else {
			deliveriesByEvent.set(delivery.event_id, [mappedDelivery]);
		}
	}

	const data: WebhookEventResponse[] = pageRows.map((row) => ({
		id: row.id,
		type: row.type,
		trigger_type: row.trigger_type as WebhookEventResponse["trigger_type"],
		trigger_id: row.trigger_id,
		created_at: row.created_at.toISOString(),
		deliveries: deliveriesByEvent.get(row.id) ?? [],
	}));

	return c.json(
		{
			data,
			error: null,
			pagination: {
				limit,
				has_more: hasMore,
				next_cursor: nextCursor,
			},
		},
		200,
	);
});

async function getStartingAfterPredicate({
	cursorId,
	organizationId,
}: {
	cursorId: string;
	organizationId: string;
}) {
	const [cursor] = await db
		.select({
			createdAt: events.createdAt,
			id: events.id,
		})
		.from(events)
		.where(
			and(eq(events.id, cursorId), eq(events.organizationId, organizationId)),
		)
		.limit(1);

	if (!cursor) {
		return [];
	}

	const cursorPredicate = or(
		lt(events.createdAt, cursor.createdAt),
		and(eq(events.createdAt, cursor.createdAt), lt(events.id, cursor.id)),
	);

	return cursorPredicate ? [cursorPredicate] : [];
}

export { listEvents };
