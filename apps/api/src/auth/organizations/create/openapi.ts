import { createRoute, z } from "@hono/zod-openapi";
import {
	ORGANIZATION_SLUG_ERROR_MESSAGE,
	ORGANIZATION_SLUG_PATTERN,
} from "@kayle-id/auth/organization-slug";
import {
	ALLOWED_LOGO_MIME,
	MAX_LOGO_BYTES,
} from "@/auth/organizations/create/logo";
import { ErrorResponse } from "@/openapi/base";

// Base64 encodes 3 input bytes as 4 output chars (rounded up to multiples of 4
// with `=` padding). Cap at the encoded size of MAX_LOGO_BYTES + a small
// margin so oversized payloads are rejected by Zod before the route handler
// has to decode them.
const MAX_LOGO_BASE64_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 4;

export const internalCreateOrganization = createRoute({
	// Hide this route in production as it's not needed for the public API.
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(1),
						slug: z
							.string()
							.min(1)
							.regex(
								ORGANIZATION_SLUG_PATTERN,
								ORGANIZATION_SLUG_ERROR_MESSAGE,
							),
						logo: z
							.object({
								data: z.string().min(1).max(MAX_LOGO_BASE64_LENGTH),
								contentType: z.enum(ALLOWED_LOGO_MIME),
							})
							.optional(),
					}),
				},
			},
			required: true,
		},
	},
	tags: ["Organizations"],
	summary: "Create an organization",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							id: z.string(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "Organization created successfully.",
		},
		400: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Bad request.",
		},
		403: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Forbidden.",
		},
		500: {
			content: {
				"application/json": {
					schema: ErrorResponse,
					example: {
						data: null,
						error: {
							code: "INTERNAL_SERVER_ERROR",
							message: "An unexpected error occurred",
						},
					},
				},
			},
			description: "Internal server error.",
		},
	},
});
