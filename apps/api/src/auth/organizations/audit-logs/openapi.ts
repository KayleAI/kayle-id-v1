import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse, Pagination } from "@/openapi/base";

const AuditLogActor = z
	.object({
		id: z.string().nullable(),
		type: z.enum(["user", "system", "api_key"]),
		name: z.string().nullable(),
		email: z.string().nullable(),
		/**
		 * For api_key actors, the underlying key id (so the dashboard can
		 * link to the API key page). Null for user/system actors.
		 */
		apiKeyId: z.string().nullable(),
		/**
		 * Friendly name of the API key, joined from `api_keys.name` for
		 * api_key actors. Null when no key is associated or when the key has
		 * since been deleted (the audit row outlives the key).
		 */
		apiKeyName: z.string().nullable(),
	})
	.openapi("AuditLogActor");

const AuditLog = z
	.object({
		id: z.string(),
		event: z.string(),
		actor: AuditLogActor,
		targetId: z.string().nullable(),
		targetType: z.string().nullable(),
		metadata: z.record(z.string(), z.unknown()),
		createdAt: z.string(),
	})
	.openapi("AuditLog");

export const listAuditLogsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "get",
	path: "/audit-logs",
	tags: ["Organizations"],
	summary:
		"List audit-log entries for the active organization. Owner/admin only.",
	request: {
		query: z.object({
			limit: z.coerce.number().int().min(1).max(100).optional(),
			starting_after: z.string().optional(),
			event: z
				.string()
				.optional()
				.describe(
					"Single event name or comma-separated list of event names to include. Unknown names are ignored; pass none to include every event type.",
				),
			actor_user_id: z
				.string()
				.uuid()
				.optional()
				.describe("Restrict to entries whose actor is this user."),
			actor_api_key_id: z
				.string()
				.uuid()
				.optional()
				.describe(
					"Restrict to entries whose actor is this API key. Useful when investigating what a single key did.",
				),
			actor_type: z
				.enum(["user", "system", "api_key"])
				.optional()
				.describe(
					"Restrict to entries whose actor type matches. `system` covers cron/background work; `api_key` covers programmatic calls; `user` covers dashboard sessions.",
				),
			created_from: z
				.string()
				.datetime()
				.optional()
				.describe(
					"Return entries created at or after this ISO 8601 timestamp.",
				),
			created_to: z
				.string()
				.datetime()
				.optional()
				.describe(
					"Return entries created at or before this ISO 8601 timestamp.",
				),
			q: z
				.string()
				.trim()
				.min(1)
				.max(200)
				.optional()
				.describe(
					"Free-text search across event name, target id, and actor name/email.",
				),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(AuditLog),
						error: z.null(),
						pagination: Pagination,
					}),
				},
			},
			description: "Paginated list of audit-log entries.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an admin or owner of this organization.",
		},
		500: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Internal server error.",
		},
	},
});
