import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

export const cancelOrgDeletionRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/cancel-delete",
	tags: ["Organizations"],
	summary:
		"Cancel a scheduled organization deletion. Owners or admins of the organization may cancel.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().uuid(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({ ok: z.literal(true) }),
						error: z.null(),
					}),
				},
			},
			description: "Deletion canceled.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Bad request.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an owner or admin of this organization.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is not scheduled for deletion.",
		},
		500: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Internal server error.",
		},
	},
});
