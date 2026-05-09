import { OpenAPIHono } from "@hono/zod-openapi";
import { ApiKeyManagementAuthorizationError } from "@/functions/auth/api-key-authorization";
import { createApiKey } from "@/functions/auth/create-api-key";
import { organizationFrozen } from "@/v1/auth";
import {
	createApiKeyErrorPayload,
	createApiKeyForbiddenError,
	createApiKeyInternalServerError,
} from "../responses";
import { internalCreateApiKey } from "./openapi";

const createApiKeyRoute = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId: string; userId: string };
}>();

createApiKeyRoute.openapi(internalCreateApiKey, async (c) => {
	const organizationId = c.get("organizationId");
	const userId = c.get("userId");

	const { name, metadata, permissions } = c.req.valid("json");

	try {
		const { id, apiKey } = await createApiKey({
			actorUserId: userId,
			name,
			organizationId,
			metadata,
			permissions,
		});

		return c.json(
			{
				data: {
					id,
					key: apiKey,
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
				createApiKeyErrorPayload(createApiKeyForbiddenError("create")),
				403,
			);
		}

		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { createApiKeyRoute };
