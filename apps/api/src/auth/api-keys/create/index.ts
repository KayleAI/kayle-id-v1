import { OpenAPIHono } from "@hono/zod-openapi";
import { checkPermission } from "@/functions/auth/check-permission";
import { createApiKey } from "@/functions/auth/create-api-key";
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

	const { name, metadata, permissions } = c.req.valid("json");

	try {
		// ensure the user has permission to create API keys
		const hasPermission = await checkPermission(
			c.get("userId"),
			organizationId,
			"admin",
		);

		if (!hasPermission) {
			return c.json(
				createApiKeyErrorPayload(createApiKeyForbiddenError("create")),
				403,
			);
		}

		const { id, apiKey } = await createApiKey({
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
	} catch {
		return c.json(
			createApiKeyErrorPayload(createApiKeyInternalServerError()),
			500,
		);
	}
});

export { createApiKeyRoute };
