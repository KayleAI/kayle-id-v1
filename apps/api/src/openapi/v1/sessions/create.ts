import { createRoute, z } from "@hono/zod-openapi";
import { safeRedirectUrl } from "@kayle-id/config/safe-url";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import { RequestedShareField, Session } from "@/openapi/models/sessions";

const ALLOW_LOOPBACK_URLS = process.env.NODE_ENV !== "production";

export const createSession = createRoute({
	method: "post",
	path: "/",
	request: {
		query: z.object({
			include_attempts: z.coerce
				.boolean()
				.optional()
				.describe(
					"When true, includes the `attempts` array on the created session. Attempts will be empty on creation.",
				),
		}),
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							redirect_url: safeRedirectUrl({
								allowLoopback: ALLOW_LOOPBACK_URLS,
							})
								.optional()
								.describe(
									"Optional URL to redirect the user to after the verification session is completed. Must use https:// (http:// is only accepted for localhost in development).",
								),
							share_fields: z
								.record(z.string(), RequestedShareField)
								.optional()
								.describe(
									"Optional map of requested share fields keyed by claim key. Each entry must include `required` (boolean) and `reason` (non-empty string, max 200).",
								),
						})
						.openapi("CreateSessionRequest"),
				},
			},
			required: false,
		},
	},
	tags: ["Sessions"],
	summary: "Create a new verification session",
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: Session,
						error: z.null(),
					}),
				},
			},
			description:
				"Successful operation. Returns the newly created verification session.",
		},
		400: {
			content: {
				"application/json": {
					schema: ErrorResponse.openapi({
						example: {
							data: null,
							error: {
								code: "UNKNOWN_CLAIM_KEY",
								message: "Unknown claim key.",
								hint: "Use a supported claim key from the share contract allowlist.",
								docs: "https://kayle.id/docs/api/sessions#create",
							},
						},
					}),
				},
			},
			description: "Bad request.",
		},
		410: {
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
			description: "Organization is scheduled for deletion.",
		},
		429: {
			content: {
				"application/json": {
					schema: ErrorResponse.openapi({
						example: {
							data: null,
							error: {
								code: "ORG_NOT_VERIFIED_LIMIT_EXCEEDED",
								message:
									"Unverified organizations are limited to 5 identity-revealing sessions per 24 hours.",
								hint: "Verify the organization in the platform settings, or wait until the rolling window resets. Age-gate-only sessions remain available.",
								docs: "https://kayle.id/docs/api/sessions#create",
							},
						},
					}),
				},
			},
			description:
				"Unverified organization has exceeded the rolling 24h session limit.",
		},
		500: {
			content: {
				"application/json": {
					schema: InternalServerErrorResponse,
				},
			},
			description: "Internal server error.",
		},
	},
});
