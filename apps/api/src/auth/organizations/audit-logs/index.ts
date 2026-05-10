import { OpenAPIHono } from "@hono/zod-openapi";
import { hasOrgRole } from "@kayle-id/auth/permissions";
import { logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import {
	auth_organization_members,
	auth_users,
} from "@kayle-id/database/schema/auth";
import { and, desc, eq, lt } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { listAuditLogsRoute } from "./openapi";

const auditLogs = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

auditLogs.openapi(listAuditLogsRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return c.json(
			{
				data: null,
				error: {
					code: "UNAUTHORIZED" as const,
					message: "Sign in to view audit logs.",
					hint: "Send a session cookie or use a session-authenticated client.",
					docs: "https://kayle.id/docs/api/errors#unauthorized",
				},
			},
			401,
		);
	}
	if (!organizationId) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Select an organization to view audit logs.",
					hint: "The active session must have an organization selected.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	const [membership] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
			),
		)
		.limit(1);

	if (!membership || !hasOrgRole(membership.role, "admin")) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner or admin can view audit logs.",
					hint: "Ask an owner or admin of this organization to share the log.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	const query = c.req.valid("query");
	const limit = query.limit ?? 50;

	try {
		const where = and(
			eq(audit_logs.organizationId, organizationId),
			...(query.event ? [eq(audit_logs.event, query.event)] : []),
			// Cursor: callers pass the id of the last row from the previous
			// page. Audit IDs are time-ordered prefixes (`aud_<random>`) but
			// random tails don't sort by time across rows, so we can't cursor
			// on id alone. Instead we re-issue the query and skip past the
			// caller's `starting_after` row via its createdAt.
			...(query.starting_after
				? await getStartingAfterPredicate(query.starting_after)
				: []),
		);

		const rows = await db
			.select({
				id: audit_logs.id,
				event: audit_logs.event,
				actorType: audit_logs.actorType,
				actorUserId: audit_logs.actorUserId,
				targetId: audit_logs.targetId,
				targetType: audit_logs.targetType,
				metadata: audit_logs.metadata,
				createdAt: audit_logs.createdAt,
				userName: auth_users.name,
				userEmail: auth_users.email,
			})
			.from(audit_logs)
			.leftJoin(auth_users, eq(audit_logs.actorUserId, auth_users.id))
			.where(where)
			.orderBy(desc(audit_logs.createdAt), desc(audit_logs.id))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const pageRows = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

		return c.json(
			{
				data: pageRows.map((row) => ({
					id: row.id,
					event: row.event,
					actor: {
						id: row.actorUserId,
						type: row.actorType as "user" | "system",
						name: row.userName,
						email: row.userEmail,
					},
					targetId: row.targetId,
					targetType: row.targetType,
					metadata: row.metadata as Record<string, unknown>,
					createdAt: row.createdAt.toISOString(),
				})),
				error: null,
				pagination: {
					limit,
					has_more: hasMore,
					next_cursor: nextCursor,
				},
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "audit_logs_list_failed",
			error,
			event: "organizations.audit_logs.list.failed",
			message: "Failed to list audit logs.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to list audit logs.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
});

async function getStartingAfterPredicate(cursorId: string) {
	const [cursor] = await db
		.select({ createdAt: audit_logs.createdAt })
		.from(audit_logs)
		.where(eq(audit_logs.id, cursorId))
		.limit(1);
	if (!cursor) {
		return [];
	}
	return [lt(audit_logs.createdAt, cursor.createdAt)];
}

export { auditLogs };
