import { createRoute, z } from "@hono/zod-openapi";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { ErrorResponse } from "@/openapi/base";

const CurrentRpTermsSchema = z.object({
	jurisdiction: z.literal(RP_INTEGRATION_TERMS_JURISDICTION),
	terms_hash: z.literal(RP_INTEGRATION_TERMS_HASH),
	terms_version: z.literal(RP_INTEGRATION_TERMS_VERSION),
});

const RpTermsAcceptanceSchema = z.object({
	accepted_at: z.string(),
	accepted_by: z.string().nullable(),
	jurisdiction: z.string(),
	terms_hash: z.string(),
	terms_version: z.string(),
});

const RpTermsStatusSchema = z.object({
	acceptance: RpTermsAcceptanceSchema.nullable(),
	current: CurrentRpTermsSchema,
	current_accepted: z.boolean(),
});

export const getRpTermsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "get",
	path: "/rp-terms",
	tags: ["Organizations"],
	summary:
		"Get the active organization's current relying-party integration terms status.",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: RpTermsStatusSchema,
						error: z.null(),
					}),
				},
			},
			description: "Current RP integration terms status.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "No active organization selected.",
		},
	},
});

export const acceptRpTermsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/rp-terms",
	tags: ["Organizations"],
	summary:
		"Record that an owner accepted the current relying-party integration terms.",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: RpTermsStatusSchema,
						error: z.null(),
					}),
				},
			},
			description: "Current RP integration terms accepted.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Unauthorized.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Caller is not an owner of the active organization.",
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
