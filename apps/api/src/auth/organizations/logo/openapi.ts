import { createRoute, z } from "@hono/zod-openapi";
import {
	ALLOWED_LOGO_MIME,
	MAX_LOGO_BYTES,
} from "@/auth/organizations/create/logo";
import { ErrorResponse } from "@/openapi/base";

const MAX_LOGO_BASE64_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 4;

export const internalUploadOrganizationLogo = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/logo",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						logo: z.object({
							data: z.string().min(1).max(MAX_LOGO_BASE64_LENGTH),
							contentType: z.enum(ALLOWED_LOGO_MIME),
						}),
					}),
				},
			},
			required: true,
		},
	},
	tags: ["Organizations"],
	summary: "Upload an organization logo",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							logo: z.string(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "Logo uploaded successfully.",
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
		410: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Organization is scheduled for deletion.",
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
