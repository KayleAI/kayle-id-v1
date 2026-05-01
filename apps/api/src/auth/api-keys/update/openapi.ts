import { createRoute } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";
import {
	ApiKeyIdParam,
	ApiKeyMutationResponse,
	ApiKeyUpdateRequest,
} from "../openapi-schemas";

export const internalUpdateApiKey = createRoute({
	// Hide this route in production as it's not needed for the public API.
	hide: process.env.NODE_ENV === "production",
	method: "patch",
	path: "/{id}",
	request: {
		params: ApiKeyIdParam,
		body: {
			content: {
				"application/json": {
					schema: ApiKeyUpdateRequest,
				},
			},
			required: true,
		},
	},
	tags: ["API Keys"],
	summary: "Update an API key",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: ApiKeyMutationResponse,
				},
			},
			description: "API key updated successfully.",
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
