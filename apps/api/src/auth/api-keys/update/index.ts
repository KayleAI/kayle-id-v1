import { OpenAPIHono } from "@hono/zod-openapi";
import { checkPermission } from "@/functions/auth/check-permission";
import { updateApiKey } from "@/functions/auth/update-api-key";
import {
	createApiKeyErrorPayload,
	createApiKeyForbiddenError,
	createApiKeyInternalServerError,
} from "../responses";
import { internalUpdateApiKey } from "./openapi";

const updateApiKeyRoute = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId: string; userId: string };
}>();

updateApiKeyRoute.openapi(internalUpdateApiKey, async (c) => {
	const organizationId = c.get("organizationId");

	const { id } = c.req.valid("param");
	const { name, enabled, metadata, permissions } = c.req.valid("json");

	try {
		// ensure the user has permission to update API keys
		const hasPermission = await checkPermission(
			c.get("userId"),
			organizationId,
			"admin",
		);

		if (!hasPermission) {
			return c.json(
				createApiKeyErrorPayload(createApiKeyForbiddenError("update")),
				403,
			);
		}

		const { status, message } = await updateApiKey(id, organizationId, {
			name,
			enabled,
			metadata,
			permissions,
		});

		if (status === "error") {
			return c.json(
				createApiKeyErrorPayload({
					code: "API_KEY_NOT_FOUND",
					message: message ?? "API key not found",
					hint: "Confirm the API key ID belongs to this organization.",
					docs: "https://kayle.id/docs/api/errors#api_key_not_found",
				}),
				400,
			);
		}

		return c.json(
			{
				data: {
					status,
					message: "API key updated successfully",
				} as const,
				error: null,
			},
			200,
		);
	} catch {
		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { updateApiKeyRoute };
