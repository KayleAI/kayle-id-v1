import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { listWebhookDeliveries } from "@/openapi/v1/webhooks/deliveries/list";
import { retryWebhookDelivery } from "@/openapi/v1/webhooks/deliveries/retry";
import { waitUntilIfAvailable } from "@/utils/wait-until";
import {
	getWebhookDeliveryForOrganization,
	getWebhookDeliveryRetryBlockReason,
	getWebhookPayloadExpiredErrorResponse,
	mapWebhookDeliveryRowToResponse,
	requeueWebhookDelivery,
	triggerWebhookDeliveryWorkflows,
} from "./service";

const webhookDeliveries = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		organizationId: string;
		type: "api" | "session";
	};
}>();

webhookDeliveries.openapi(listWebhookDeliveries, async (c) => {
	const organizationId = c.get("organizationId");
	const query = c.req.valid("query");
	const limit = query.limit ?? 10;

	const rows = await db
		.select({
			delivery: webhook_deliveries,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.where(
			and(
				eq(events.organizationId, organizationId),
				...(query.status ? [eq(webhook_deliveries.status, query.status)] : []),
				...(query.endpoint_id
					? [eq(webhook_deliveries.webhookEndpointId, query.endpoint_id)]
					: []),
				...(query.event_id
					? [eq(webhook_deliveries.eventId, query.event_id)]
					: []),
				...(query.starting_after
					? await getStartingAfterPredicate({
							cursorId: query.starting_after,
							organizationId,
						})
					: []),
			),
		)
		.orderBy(desc(webhook_deliveries.createdAt), desc(webhook_deliveries.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? (pageRows.at(-1)?.delivery.id ?? null) : null;

	return c.json(
		{
			data: pageRows.map((row) =>
				mapWebhookDeliveryRowToResponse(row.delivery),
			),
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

webhookDeliveries.openapi(retryWebhookDelivery, async (c) => {
	const organizationId = c.get("organizationId");
	const params = c.req.valid("param");

	const delivery = await getWebhookDeliveryForOrganization({
		deliveryId: params.delivery_id,
		organizationId,
	});

	if (!delivery) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook delivery not found.",
					hint: "The webhook delivery with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/deliveries#retry",
				},
			},
			404,
		);
	}

	const retryBlockReason = getWebhookDeliveryRetryBlockReason(delivery);
	if (retryBlockReason === "delivering") {
		return c.json(
			{
				data: null,
				error: {
					code: "CONFLICT",
					message: "Webhook delivery cannot be retried.",
					hint: "The webhook delivery is already in progress.",
					docs: "https://kayle.id/docs/api/webhooks/deliveries#retry",
				},
			},
			409,
		);
	}

	if (
		retryBlockReason === "payload_expired" ||
		retryBlockReason === "payload_scrubbed"
	) {
		return c.json(
			{
				data: null,
				error: getWebhookPayloadExpiredErrorResponse(),
			},
			409,
		);
	}

	const requeued = await requeueWebhookDelivery({
		deliveryId: delivery.id,
	});

	if (!requeued) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook delivery not found.",
					hint: "The webhook delivery with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/deliveries#retry",
				},
			},
			404,
		);
	}

	waitUntilIfAvailable({
		createTask: () =>
			triggerWebhookDeliveryWorkflows({
				env: c.env,
				deliveryIds: [requeued.id],
			}),
		getExecutionCtx: () => c.executionCtx,
	});

	return c.json(
		{
			data: mapWebhookDeliveryRowToResponse(requeued),
			error: null,
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
			createdAt: webhook_deliveries.createdAt,
			id: webhook_deliveries.id,
		})
		.from(webhook_deliveries)
		.innerJoin(events, eq(events.id, webhook_deliveries.eventId))
		.where(
			and(
				eq(webhook_deliveries.id, cursorId),
				eq(events.organizationId, organizationId),
			),
		)
		.limit(1);

	if (!cursor) {
		return [];
	}

	const cursorPredicate = or(
		lt(webhook_deliveries.createdAt, cursor.createdAt),
		and(
			eq(webhook_deliveries.createdAt, cursor.createdAt),
			lt(webhook_deliveries.id, cursor.id),
		),
	);

	return cursorPredicate ? [cursorPredicate] : [];
}

export default webhookDeliveries;
