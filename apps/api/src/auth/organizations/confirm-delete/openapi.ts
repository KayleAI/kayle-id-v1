import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

const CONFIRMATION_CODE_PATTERN = /^[A-Z0-9]{8}$/u;

export const confirmOrgDeletionRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/confirm-delete",
	tags: ["Organizations"],
	summary:
		"Confirm a previously requested organization deletion using the 8-character code emailed to the requester. Schedules hard delete 48 hours out.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().uuid(),
						code: z
							.string()
							.transform((v) => v.trim().toUpperCase())
							.pipe(z.string().regex(CONFIRMATION_CODE_PATTERN)),
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
						data: z.object({ pendingDeletionAt: z.string() }),
						error: z.null(),
					}),
				},
			},
			description: "Deletion scheduled.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Invalid or expired code.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an owner of this organization.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization not found.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is already scheduled for deletion.",
		},
		500: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Internal server error.",
		},
	},
});
