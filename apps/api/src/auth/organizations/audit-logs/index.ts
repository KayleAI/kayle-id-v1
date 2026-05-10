import { OpenAPIHono } from "@hono/zod-openapi";
import { AUDIT_LOG_EVENTS } from "@kayle-id/auth/audit-logs";
import { hasOrgRole } from "@kayle-id/auth/permissions";
import { logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import {
	auth_organization_members,
	auth_users,
} from "@kayle-id/database/schema/auth";
import { api_keys } from "@kayle-id/database/schema/core";
import {
	and,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNull,
	lt,
	lte,
	or,
} from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import { listAuditLogsRoute } from "./openapi";

const KNOWN_EVENTS: ReadonlySet<string> = new Set(AUDIT_LOG_EVENTS);

/**
 * Parse the `event` query param into a deduped, validated list of event
 * names. Accepts either a single name (`event=session.created`) or a
 * comma-separated list (`event=session.created,session.cancelled`). Unknown
 * names are silently dropped so a caller passing a forwards-compatible value
 * doesn't get a hard 400.
 */
function parseEventFilter(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && KNOWN_EVENTS.has(s));
	return Array.from(new Set(parts));
}

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
				isNull(auth_organization_members.suspendedAt),
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
		// Build the free-text search predicate. We escape `%` and `_` so a user
		// typing `100%` doesn't accidentally turn into a "match anything" prefix.
		// The search hits the most useful surfaces: event name, target id,
		// the (joined) human actor's display name and email, and the (joined)
		// API key's friendly name so a query like "deploy bot" still matches
		// a key called `deploy-bot`.
		const searchPredicate = query.q
			? or(
					ilike(audit_logs.event, `%${escapeIlikeWildcards(query.q)}%`),
					ilike(audit_logs.targetId, `%${escapeIlikeWildcards(query.q)}%`),
					ilike(auth_users.name, `%${escapeIlikeWildcards(query.q)}%`),
					ilike(auth_users.email, `%${escapeIlikeWildcards(query.q)}%`),
					ilike(api_keys.name, `%${escapeIlikeWildcards(query.q)}%`),
				)
			: undefined;

		const eventFilter = parseEventFilter(query.event);
		const where = and(
			eq(audit_logs.organizationId, organizationId),
			...(eventFilter.length === 1
				? [eq(audit_logs.event, eventFilter[0] as string)]
				: eventFilter.length > 1
					? [inArray(audit_logs.event, eventFilter)]
					: []),
			...(query.actor_user_id
				? [eq(audit_logs.actorUserId, query.actor_user_id)]
				: []),
			...(query.actor_api_key_id
				? [eq(audit_logs.actorApiKeyId, query.actor_api_key_id)]
				: []),
			...(query.actor_type ? [eq(audit_logs.actorType, query.actor_type)] : []),
			...(query.created_from
				? [gte(audit_logs.createdAt, new Date(query.created_from))]
				: []),
			...(query.created_to
				? [lte(audit_logs.createdAt, new Date(query.created_to))]
				: []),
			...(searchPredicate ? [searchPredicate] : []),
			// Cursor: callers pass the id of the last row from the previous
			// page. Audit IDs are random — they carry no time ordering — so we
			// cursor on `(created_at desc, id desc)` and the predicate must
			// match the orderBy exactly: a row sorts before the cursor when
			// `createdAt < cursor.createdAt`, OR `createdAt = cursor.createdAt`
			// AND `id < cursor.id`. Without the tied-`createdAt` arm,
			// rows inserted in the same millisecond as the cursor row are
			// silently skipped between pages.
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
				actorApiKeyId: audit_logs.actorApiKeyId,
				targetId: audit_logs.targetId,
				targetType: audit_logs.targetType,
				metadata: audit_logs.metadata,
				createdAt: audit_logs.createdAt,
				userName: auth_users.name,
				userEmail: auth_users.email,
				apiKeyName: api_keys.name,
			})
			.from(audit_logs)
			.leftJoin(auth_users, eq(audit_logs.actorUserId, auth_users.id))
			.leftJoin(api_keys, eq(audit_logs.actorApiKeyId, api_keys.id))
			.where(where)
			.orderBy(desc(audit_logs.createdAt), desc(audit_logs.id))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const pageRows = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;

		return c.json(
			{
				data: pageRows.map((row) => {
					const actorType = row.actorType as "user" | "system" | "api_key";
					return {
						id: row.id,
						event: row.event,
						actor: {
							// `id` is the user-friendly primary identifier for the
							// actor — the user id for user actors, the api-key id
							// for api_key actors, and null for system rows.
							id:
								actorType === "user"
									? row.actorUserId
									: actorType === "api_key"
										? row.actorApiKeyId
										: null,
							type: actorType,
							name: actorType === "api_key" ? row.apiKeyName : row.userName,
							email: actorType === "api_key" ? null : row.userEmail,
							apiKeyId: row.actorApiKeyId,
							apiKeyName: row.apiKeyName,
						},
						targetId: row.targetId,
						targetType: row.targetType,
						metadata: row.metadata as Record<string, unknown>,
						createdAt: row.createdAt.toISOString(),
					};
				}),
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

function escapeIlikeWildcards(input: string): string {
	// Postgres ILIKE treats `%` and `_` as wildcards. Escape both so the
	// caller's literal characters match literally. The default escape character
	// is `\`, so we also escape backslashes themselves.
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function getStartingAfterPredicate(cursorId: string) {
	const [cursor] = await db
		.select({ createdAt: audit_logs.createdAt, id: audit_logs.id })
		.from(audit_logs)
		.where(eq(audit_logs.id, cursorId))
		.limit(1);
	if (!cursor) {
		return [];
	}
	const tieBreaker = or(
		lt(audit_logs.createdAt, cursor.createdAt),
		and(
			eq(audit_logs.createdAt, cursor.createdAt),
			lt(audit_logs.id, cursor.id),
		),
	);
	return tieBreaker ? [tieBreaker] : [];
}

export { auditLogs };
