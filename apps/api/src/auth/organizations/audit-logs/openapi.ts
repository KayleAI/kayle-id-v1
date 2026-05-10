import { createRoute, z } from "@hono/zod-openapi";
import { AUDIT_LOG_EVENTS } from "@kayle-id/auth/audit-logs";
import { ErrorResponse, Pagination } from "@/openapi/base";

const AuditLogActor = z
	.object({
		id: z.string().nullable(),
		type: z.enum(["user", "system"]),
		name: z.string().nullable(),
		email: z.string().nullable(),
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
			event: z.enum(AUDIT_LOG_EVENTS).optional(),
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
