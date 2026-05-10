import { createRoute, z } from "@hono/zod-openapi";
import {
	ORGANIZATION_BUSINESS_JURISDICTION_MAX_LENGTH,
	ORGANIZATION_BUSINESS_NAME_MAX_LENGTH,
	ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_MAX_LENGTH,
	ORGANIZATION_BUSINESS_TYPES,
} from "@kayle-id/auth/organization-business-details";
import { ErrorResponse } from "@/openapi/base";

/**
 * `null` clears the field; `undefined` (omitted) leaves it unchanged. Strings
 * are trimmed server-side; whitespace-only values are treated as `null`. The
 * length caps below are the wire-level upper bound — the deeper validator
 * also strips control characters and rejects pathological inputs.
 */
const optionalNullableString = (max: number) =>
	z.string().max(max).nullable().optional();

export const updateOrganizationBusinessDetailsRoute = createRoute({
	hide: process.env.NODE_ENV === "production",
	method: "post",
	path: "/business-details",
	tags: ["Organizations"],
	summary:
		"Update the self-asserted business details (legal name, jurisdiction, registration number) for the active organization.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						business_type: z
							.enum(ORGANIZATION_BUSINESS_TYPES)
							.nullable()
							.optional(),
						business_name: optionalNullableString(
							ORGANIZATION_BUSINESS_NAME_MAX_LENGTH,
						),
						business_jurisdiction: optionalNullableString(
							ORGANIZATION_BUSINESS_JURISDICTION_MAX_LENGTH,
						),
						business_registration_number: optionalNullableString(
							ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_MAX_LENGTH,
						),
					}),
				},
			},
			required: true,
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							businessType: z.enum(ORGANIZATION_BUSINESS_TYPES).nullable(),
							businessName: z.string().nullable(),
							businessJurisdiction: z.string().nullable(),
							businessRegistrationNumber: z.string().nullable(),
						}),
						error: z.null(),
					}),
				},
			},
			description: "Business details updated.",
		},
		400: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Validation error.",
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
