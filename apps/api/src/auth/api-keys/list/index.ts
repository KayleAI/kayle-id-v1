import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@kayle-id/database/drizzle";
import { api_keys } from "@kayle-id/database/schema/core";
import { and, eq, gt } from "drizzle-orm";
import { checkPermission } from "@/functions/auth/check-permission";
import {
	createApiKeyErrorPagePayload,
	createApiKeyForbiddenError,
	createApiKeyInternalServerError,
} from "../responses";
import { internalListApiKeys } from "./openapi";

const listApiKeys = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId: string; userId: string };
}>();

listApiKeys.openapi(internalListApiKeys, async (c) => {
	const organizationId = c.get("organizationId");

	const query = c.req.valid("query");
	const limit = query.limit ?? 10;

	// ensure the user has permission to list API keys
	const hasPermission = await checkPermission(c.get("userId"), organizationId);

	if (!hasPermission) {
		return c.json(
			createApiKeyErrorPagePayload({
				error: createApiKeyForbiddenError("list"),
				limit,
			}),
			403,
		);
	}

	try {
		const where = and(
			eq(api_keys.organizationId, organizationId),
			eq(api_keys.environment, "live"),
			...(query.starting_after ? [gt(api_keys.id, query.starting_after)] : []),
		);

		const rows = await db
			.select({
				id: api_keys.id,
				name: api_keys.name,
				enabled: api_keys.enabled,
				permissions: api_keys.permissions,
				metadata: api_keys.metadata,
				createdAt: api_keys.createdAt,
				updatedAt: api_keys.updatedAt,
				requestCount: api_keys.requestCount,
			})
			.from(api_keys)
			.where(where)
			.orderBy(api_keys.id)
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const pageRows = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

		const data = pageRows.map((row) => ({
			...row,
			permissions: Array.isArray(row.permissions) ? row.permissions : [],
			metadata:
				row.metadata &&
				typeof row.metadata === "object" &&
				!Array.isArray(row.metadata)
					? row.metadata
					: {},
		}));

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
	} catch {
		return c.json(
			createApiKeyErrorPagePayload({
				error: createApiKeyInternalServerError("Please try again later."),
				limit,
			}),
			500,
		);
	}
});

export { listApiKeys };
