import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { updateWebhookEndpoint } from "@/openapi/v1/webhooks/endpoints/update";
import { mapEndpointRowToResponse } from "./utils";

const updateEndpoint = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		apiKeyId?: string;
		organizationId: string;
		type: "api" | "session";
		userId?: string;
	};
}>();

updateEndpoint.openapi(updateWebhookEndpoint, async (c) => {
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const params = c.req.valid("param");
	const body = c.req.valid("json");

	const [row] = await db
		.select()
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.id, params.endpoint_id),
				eq(webhook_endpoints.organizationId, organizationId),
			),
		)
		.limit(1);

	if (!row) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook endpoint not found.",
					hint: "The webhook endpoint with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/endpoints#update",
				},
			},
			404,
		);
	}

	const updates: Partial<typeof webhook_endpoints.$inferInsert> = {};

	if (body.name !== undefined) {
		updates.name = body.name?.trim() ?? null;
	}

	if (body.url !== undefined) {
		updates.url = body.url;
	}

	if (typeof body.enabled === "boolean") {
		updates.enabled = body.enabled;
		updates.disabledAt = body.enabled ? null : new Date();
	}

	if (body.subscribed_event_types !== undefined) {
		updates.subscribedEventTypes = body.subscribed_event_types;
	}

	if (Object.keys(updates).length === 0) {
		return c.json(
			{
				data: null,
				error: {
					code: "BAD_REQUEST",
					message: "Bad request.",
					hint: "At least one of `name`, `url`, `enabled` or `subscribed_event_types` must be provided.",
					docs: "https://kayle.id/docs/api/webhooks/endpoints#update",
				},
			},
			400,
		);
	}

	await db
		.update(webhook_endpoints)
		.set(updates)
		.where(eq(webhook_endpoints.id, row.id));

	const [updated] = await db
		.select()
		.from(webhook_endpoints)
		.where(eq(webhook_endpoints.id, row.id))
		.limit(1);

	// See list.ts for the actor-type policy across session vs API-key callers.
	await recordAuditLogSafe({
		...(userId
			? { actorType: "user" as const, actorUserId: userId }
			: apiKeyId
				? { actorType: "api_key" as const, actorApiKeyId: apiKeyId }
				: { actorType: "system" as const }),
		organizationId,
		event: "webhook_endpoint.updated",
		targetId: row.id,
		targetType: "webhook_endpoint",
		metadata: {
			updated_fields: Object.keys(updates),
			...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
		},
	});

	const data = mapEndpointRowToResponse(updated, organizationId);

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
});

export { updateEndpoint };
