import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

export const OwnedOrganization = z
	.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
	})
	.openapi("OwnedOrganization");

export const internalListOwnedOrganizations = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "get",
	path: "/owned-organizations",
	tags: ["Account"],
	summary: "List organisations the caller is the sole owner of",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							organizations: z.array(OwnedOrganization),
						}),
						error: z.null(),
					}),
				},
			},
			description:
				"Organisations where the caller is the only `owner` member. These would be cascade-deleted alongside the user if they delete their account.",
		},
		401: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Unauthorized.",
		},
		500: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Internal server error.",
		},
	},
});
