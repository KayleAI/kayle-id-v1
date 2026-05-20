import { z } from "@hono/zod-openapi";
import { verificationSessionFailureCodes } from "@kayle-id/database/schema/core";

export const RequestedShareField = z.object({
	required: z.boolean().describe("Whether this field is required by the RC."),
	reason: z
		.string()
		.max(200)
		.describe(
			"Human-readable reason for requesting this field. Required for most claims; may be empty for an `age_over_X` claim when `date_of_birth` is also requested in the same session.",
		),
});

export const RequestedShareFields = z
	.record(z.string(), RequestedShareField)
	.describe("Requested share fields keyed by claim key.");

export const SessionShareField = z.object({
	required: z.boolean().describe("Whether this field must always be shared."),
	reason: z.string().describe("Reason shown to the user for this field."),
	source: z
		.enum(["default", "rc"])
		.describe("Whether the field came from defaults or RC request."),
});

export const SessionShareFields = z
	.record(z.string(), SessionShareField)
	.describe("Effective normalized share fields for this session.");

export const Session = z
	.object({
		id: z.string().describe("The ID of the verification session"),
		status: z
			.enum([
				"created",
				"in_progress",
				"succeeded",
				"failed",
				"expired",
				"cancelled",
			])
			.describe("The status of the verification session"),
		failure_code: z
			.enum(verificationSessionFailureCodes)
			.nullable()
			.describe(
				"Terminal failure code when status='failed'. Null in any other state.",
			),
		nfc_tries_used: z
			.number()
			.int()
			.min(0)
			.max(3)
			.describe(
				"Number of NFC chip-read failures the session has consumed. The session terminalizes on the 3rd failure.",
			),
		liveness_tries_used: z
			.number()
			.int()
			.min(0)
			.max(3)
			.describe(
				"Number of liveness check failures the session has consumed. The session terminalizes on the 3rd failure.",
			),
		contract_version: z
			.number()
			.int()
			.describe("Version of the session share contract."),
		share_fields: SessionShareFields.describe(
			"Effective normalized share fields used by this session.",
		),
		redirect_url: z
			.string()
			.nullable()
			.describe(
				"The URL to redirect to after the verification session is completed, if provided by the integrator.",
			),
		webhook_endpoint_id: z
			.union([z.string(), z.array(z.string())])
			.nullable()
			.describe(
				"The webhook endpoint or endpoint list selected for this session, or null when events fan out to all enabled subscribed endpoints.",
			),
		verification_url: z
			.string()
			.url()
			.describe(
				"The URL that the platform should send the user to in order to complete the verification. Includes the one-shot `cancel_token` as a query parameter so the verify browser / native app can pass it back when cancelling.",
			),
		cancel_token: z
			.string()
			.optional()
			.describe(
				"One-shot token required by `POST /v1/verify/session/:id/cancel`. Returned only on session creation.",
			),
		expires_at: z
			.string()
			.describe("The expiration time of the verification session"),
		completed_at: z
			.string()
			.nullable()
			.describe(
				"The time the verification session reached a terminal state (i.e., succeeded, failed, expired or cancelled), or null if not yet terminal.",
			),
		created_at: z
			.string()
			.describe("The time the verification session was created"),
		updated_at: z
			.string()
			.describe("The time the verification session was last updated"),
	})
	.openapi({
		examples: [
			{
				id: "vs_mza7vecksrtyfw193ekcvl5vnws3bt1lz96buu3iw7zidckf8dga2zx2echb3t16",
				status: "created",
				failure_code: null,
				nfc_tries_used: 0,
				liveness_tries_used: 0,
				contract_version: 1,
				share_fields: {
					document_type_code: {
						required: false,
						reason: "Needed to know the document type code",
						source: "rc",
					},
					date_of_birth: {
						required: true,
						reason: "Needed to verify age eligibility",
						source: "rc",
					},
					kayle_document_id: {
						required: true,
						reason: 'Sharing "Kayle Document ID"',
						source: "default",
					},
				},
				redirect_url: "https://example.com/redirect",
				webhook_endpoint_id: null,
				verification_url:
					"https://verify.kayle.id/vs_mza7vecksrtyfw193ekcvl5vnws3bt1lz96buu3iw7zidckf8dga2zx2echb3t16",
				expires_at: "2025-01-01T00:00:00Z",
				completed_at: null,
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			},
		],
	});
