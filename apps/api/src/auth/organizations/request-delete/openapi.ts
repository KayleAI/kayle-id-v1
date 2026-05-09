import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

export const requestOrgDeletionRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/request-delete",
	tags: ["Organizations"],
	summary:
		"Request deletion of an organization. Sends an 8-character confirmation code to the requesting owner.",
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
						data: z.object({ sentToEmail: z.string() }),
						error: z.null(),
					}),
				},
			},
			description: "Confirmation code sent.",
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
			description: "Caller is not an owner of this organization.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization or user not found.",
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
