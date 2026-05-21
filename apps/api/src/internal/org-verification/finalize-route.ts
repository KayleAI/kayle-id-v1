import { createRoute, z } from "@hono/zod-openapi";
import { orgVerificationDocumentTypes } from "@kayle-id/database/schema/core";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { ISSUING_COUNTRY_CODE_PATTERN } from "./dedup";

export const ORG_VERIFICATION_DOCS =
	"https://kayle.id/docs/api/internal/org-verification";

const MAX_DOCUMENT_NUMBER_LENGTH = 128;
const issuingCountrySchema = z
	.string()
	.trim()
	.transform((value) => value.toUpperCase())
	.pipe(z.string().regex(ISSUING_COUNTRY_CODE_PATTERN));

export const finalizeOrgVerificationRoute = createRoute({
	hide: true,
	method: "post",
	path: "/finalize",
	tags: ["Internal"],
	summary:
		"Finalize an organization verification: write the dedup hash row and record the org owner's ID check.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organization_id: z.string().uuid(),
						document_type: z.enum(orgVerificationDocumentTypes),
						document_number: z.string().min(1).max(MAX_DOCUMENT_NUMBER_LENGTH),
						issuing_country: issuingCountrySchema,
						owner_user_id: z.string().uuid(),
					}),
				},
			},
			required: true,
		},
	},
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							verified_at: z.string(),
							record_id: z.string().nullable(),
							dedup_hash: z.string().nullable(),
							pepper_version: z.number().nullable(),
							already_verified: z.boolean(),
						}),
						error: z.null(),
					}),
				},
			},
			description:
				"Finalization recorded. `already_verified=true` if the org was already verified before this call.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Bad request.",
		},
		401: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Trust token missing or invalid.",
		},
		403: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"The user who started verification is no longer an organization owner.",
		},
		404: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Target organization does not exist.",
		},
		410: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Target organization is scheduled for deletion.",
		},
		409: {
			content: { "application/json": { schema: ErrorResponse } },
			description:
				"The verified document is already bound to another organization.",
		},
		500: {
			content: { "application/json": { schema: InternalServerErrorResponse } },
			description: "Internal server error.",
		},
	},
});
