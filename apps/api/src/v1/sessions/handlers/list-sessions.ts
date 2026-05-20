import type { RouteHandler } from "@hono/zod-openapi";
import type { listSessions } from "@/openapi/v1/sessions/list";
import { mapSessionRowToResponse } from "@/v1/sessions/mappers/session-response";
import { listVerificationSessions } from "@/v1/sessions/repo/session-repo";
import type { SessionsAppEnv } from "@/v1/sessions/types";

export const listSessionsHandler: RouteHandler<
	typeof listSessions,
	SessionsAppEnv
> = async (c) => {
	const organizationId = c.get("organizationId");
	const query = c.req.valid("query");
	const limit = query.limit ?? 10;

	const rows = await listVerificationSessions({
		organizationId,
		status: query.status,
		createdFrom: query.created_from,
		createdTo: query.created_to,
		startingAfter: query.starting_after,
		limit,
	});

	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

	const data = pageRows.map((row) => mapSessionRowToResponse({ row }));

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
};
