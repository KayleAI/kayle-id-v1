import { OpenAPIHono } from "@hono/zod-openapi";
import { ApiKeyManagementAuthorizationError } from "@/functions/auth/api-key-authorization";
import { updateApiKey } from "@/functions/auth/update-api-key";
import { organizationFrozen } from "@/v1/auth";
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
	const userId = c.get("userId");

	const { id } = c.req.valid("param");
	const { name, enabled, metadata, permissions } = c.req.valid("json");

	try {
		const { status, message } = await updateApiKey(id, organizationId, {
			actorUserId: userId,
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
	} catch (error) {
		if (error instanceof ApiKeyManagementAuthorizationError) {
			if (error.reason === "frozen") {
				return organizationFrozen(c);
			}

			return c.json(
				createApiKeyErrorPayload(createApiKeyForbiddenError("update")),
				403,
			);
		}

		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { updateApiKeyRoute };
