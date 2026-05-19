import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { env } from "@kayle-id/config/env";
import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { createWebhookEndpoint } from "@/openapi/v1/webhooks/endpoints/create";
import { listWebhookEndpoints } from "@/openapi/v1/webhooks/endpoints/list";
import { encryptWebhookSigningSecret } from "@/v1/webhooks/signing-secret";
import {
	generateEndpointId,
	generateSigningSecret,
	mapEndpointRowToResponse,
} from "./utils";

const listAndCreateEndpoints = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		apiKeyId?: string;
		organizationId: string;
		type: "api" | "session";
		userId?: string;
	};
}>();

listAndCreateEndpoints.openapi(listWebhookEndpoints, async (c) => {
	const organizationId = c.get("organizationId");
	const query = c.req.valid("query");

	const limit = query.limit ?? 10;

	const where = and(
		eq(webhook_endpoints.organizationId, organizationId),
		...(typeof query.enabled === "boolean"
			? [eq(webhook_endpoints.enabled, query.enabled)]
			: []),
		...(query.starting_after
			? await getStartingAfterPredicate({
					cursorId: query.starting_after,
					organizationId,
				})
			: []),
	);

	const rows = await db
		.select()
		.from(webhook_endpoints)
		.where(where)
		.orderBy(desc(webhook_endpoints.createdAt), desc(webhook_endpoints.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

	const data = pageRows.map((row) =>
		mapEndpointRowToResponse(row, organizationId),
	);

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

listAndCreateEndpoints.openapi(createWebhookEndpoint, async (c) => {
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const body = c.req.valid("json");

	const enabled = body.enabled ?? true;
	const undeliveredPayloadRetentionHours =
		body.undelivered_payload_retention_hours;
	const subscribedEventTypes = body.subscribed_event_types ?? [
		...SUPPORTED_WEBHOOK_EVENT_TYPES,
	];

	const id = generateEndpointId();
	const signingSecret = generateSigningSecret();
	const authSecret = c.env?.AUTH_SECRET ?? env.AUTH_SECRET;
	const signingSecretCiphertext = await encryptWebhookSigningSecret({
		plaintext: signingSecret,
		secret: authSecret,
	});

	const [created] = await db
		.insert(webhook_endpoints)
		.values({
			id,
			organizationId,
			name: body.name?.trim() ?? null,
			labels: body.labels ?? [],
			url: body.url,
			enabled,
			subscribedEventTypes,
			undeliveredPayloadRetentionHours,
			signingSecretCiphertext,
			disabledAt: enabled ? null : new Date(),
		})
		.returning();

	// Webhook endpoints can be managed via a dashboard session or an API key
	// (`/v1/webhooks/*` accepts both). We attribute the row to the actual
	// actor — a session caller is `user`, an API-key caller is `api_key`
	// (NOT `system` — the system actor is reserved for cron/background work).
	await recordAuditLogSafe({
		...(userId
			? { actorType: "user" as const, actorUserId: userId }
			: apiKeyId
				? { actorType: "api_key" as const, actorApiKeyId: apiKeyId }
				: { actorType: "system" as const }),
		organizationId,
		event: "webhook_endpoint.created",
		targetId: id,
		targetType: "webhook_endpoint",
		metadata: { url: body.url, enabled },
	});

	const data = {
		endpoint: mapEndpointRowToResponse(created, organizationId),
		signing_secret: signingSecret,
	};

	return c.json(
		{
			data,
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
			createdAt: webhook_endpoints.createdAt,
			id: webhook_endpoints.id,
		})
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.id, cursorId),
				eq(webhook_endpoints.organizationId, organizationId),
			),
		)
		.limit(1);

	if (!cursor) {
		return [];
	}

	const cursorPredicate = or(
		lt(webhook_endpoints.createdAt, cursor.createdAt),
		and(
			eq(webhook_endpoints.createdAt, cursor.createdAt),
			lt(webhook_endpoints.id, cursor.id),
		),
	);

	return cursorPredicate ? [cursorPredicate] : [];
}

export { listAndCreateEndpoints };
