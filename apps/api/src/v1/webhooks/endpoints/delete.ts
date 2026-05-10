import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { deleteWebhookEndpoint } from "@/openapi/v1/webhooks/endpoints/delete";

const deleteEndpoint = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		apiKeyId?: string;
		organizationId: string;
		type: "api" | "session";
		userId?: string;
	};
}>();

deleteEndpoint.openapi(deleteWebhookEndpoint, async (c) => {
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const params = c.req.valid("param");

	const [deleted] = await db
		.delete(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.id, params.endpoint_id),
				eq(webhook_endpoints.organizationId, organizationId),
			),
		)
		.returning({
			id: webhook_endpoints.id,
		});

	if (!deleted) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook endpoint not found.",
					hint: "The webhook endpoint with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/endpoints#delete",
				},
			},
			404,
		);
	}

	// See list.ts for the actor-type policy across session vs API-key callers.
	await recordAuditLogSafe({
		...(userId
			? { actorType: "user" as const, actorUserId: userId }
			: apiKeyId
				? { actorType: "api_key" as const, actorApiKeyId: apiKeyId }
				: { actorType: "system" as const }),
		organizationId,
		event: "webhook_endpoint.deleted",
		targetId: deleted.id,
		targetType: "webhook_endpoint",
	});

	return c.json(
		{
			data: {
				message: "Webhook endpoint deleted.",
				status: "success" as const,
			},
			error: null,
		},
		200,
	);
});

export { deleteEndpoint };
