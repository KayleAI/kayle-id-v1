import { OpenAPIHono } from "@hono/zod-openapi";
import { checkPermission } from "@/functions/auth/check-permission";
import { deleteApiKey } from "@/functions/auth/delete-api-key";
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

	const { id } = c.req.valid("param");

	try {
		// ensure the user has permission to delete API keys
		const hasPermission = await checkPermission(
			c.get("userId"),
			organizationId,
		);

		if (!hasPermission) {
			return c.json(
				createApiKeyErrorPayload(createApiKeyForbiddenError("delete")),
				403,
			);
		}

		const { status, message } = await deleteApiKey(id, organizationId);

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
	} catch {
		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { deleteApiKeyRoute };
