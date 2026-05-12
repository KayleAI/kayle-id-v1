import { createRoute } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";
import { ApiKeyCreatedResponse, ApiKeyCreateRequest } from "../openapi-schemas";

export const internalCreateApiKey = createRoute({
	// Hide this route in production as it's not needed for the public API.
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: ApiKeyCreateRequest,
				},
			},
			required: true,
		},
	},
	tags: ["API Keys"],
	summary: "Create an API key",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: ApiKeyCreatedResponse,
				},
			},
			description: "API key created successfully.",
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
