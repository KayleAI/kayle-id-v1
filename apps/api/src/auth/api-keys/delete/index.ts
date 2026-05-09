import { OpenAPIHono } from "@hono/zod-openapi";
import { ApiKeyManagementAuthorizationError } from "@/functions/auth/api-key-authorization";
import { deleteApiKey } from "@/functions/auth/delete-api-key";
import { organizationFrozen } from "@/v1/auth";
import {
	createApiKeyErrorPayload,
	createApiKeyForbiddenError,
	createApiKeyInternalServerError,
} from "../responses";
import { internalDeleteApiKey } from "./openapi";

const deleteApiKeyRoute = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId: string; userId: string };
}>();

deleteApiKeyRoute.openapi(internalDeleteApiKey, async (c) => {
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");

	const { id } = c.req.valid("param");

	try {
		const { status, message } = await deleteApiKey(id, organizationId, userId);

		if (status === "error") {
			return c.json(
				createApiKeyErrorPayload({
					code: "API_KEY_NOT_DELETED",
					message: message ?? "API key not deleted",
					hint: "Confirm the API key ID belongs to this organization.",
					docs: "https://kayle.id/docs/api/errors#api_key_not_deleted",
				}),
				400,
			);
		}

		return c.json(
			{
				data: {
					status,
					message: "API key deleted successfully",
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
				createApiKeyErrorPayload(createApiKeyForbiddenError("delete")),
				403,
			);
		}

		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { deleteApiKeyRoute };
