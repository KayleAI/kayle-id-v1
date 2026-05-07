import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";

export const acceptVerificationTermsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/accept-verification-terms",
	tags: ["Organizations"],
	summary:
		"Record that an owner has accepted the organization verification terms.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().min(1),
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
						data: z.object({
							verificationTermsAcceptedAt: z.string(),
							verificationTermsAcceptedBy: z.string(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "Terms acceptance recorded (or already on file).",
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
			description: "Organization not found.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is already verified.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Organization is frozen pending deletion.",
		},
		500: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Internal server error.",
		},
	},
});
