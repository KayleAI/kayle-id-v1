import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import {
	isRequestBodyTooLarge,
	readRequestJsonWithLimit,
} from "@kayle-id/config/request-body";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { APP_ENVIRONMENT, APP_VERSION } from "@/config/version";
import { getPublicHost } from "@/utils/proxy-internal-api-utils";

const PLATFORM_WORKER_NAME = "kayle-id-platform";
const START_ORG_VERIFICATION_BODY_LIMIT_BYTES = 4 * 1024;
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const ORG_VERIFICATION_KV_PREFIX = "org-verify:";

interface CheckMembershipResponse {
	data: {
		user_id: string;
		role: "owner" | "admin" | "member" | null;
		is_owner: boolean;
		is_admin_or_owner: boolean;
		organization: {
			id: string;
			verified_at: string | null;
			pending_deletion_at: string | null;
			verification_terms_accepted_at: string | null;
		} | null;
	} | null;
	error: { code: string; message: string } | null;
}

interface ApiSession {
	id: string;
	verification_url: string;
}

interface CreateSessionResponse {
	data: ApiSession | null;
	error: { code: string; message: string } | null;
}

function jsonError(message: string, status: number): Response {
	return new Response(JSON.stringify({ data: null, error: { message } }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function readJson(request: Request): Promise<{
	organizationId: string | null;
}> {
	try {
		const body = await readRequestJsonWithLimit<{ organizationId?: unknown }>(
			request,
			START_ORG_VERIFICATION_BODY_LIMIT_BYTES,
		);
		const organizationId =
			typeof body.organizationId === "string" ? body.organizationId : null;
		return { organizationId };
	} catch (error) {
		if (isRequestBodyTooLarge(error)) {
			throw error;
		}

		return { organizationId: null };
	}
}

export const Route = createFileRoute("/_api/api/start-org-verification")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let organizationId: string | null;
				try {
					({ organizationId } = await readJson(request));
				} catch (error) {
					if (isRequestBodyTooLarge(error)) {
						return jsonError("Request body is too large.", 413);
					}

					throw error;
				}

				if (!organizationId) {
					return jsonError("organizationId is required.", 400);
				}

				const cookie = request.headers.get("Cookie") ?? "";

				// 1. Resolve the calling user's session and verify they're an owner of
				// the target org. The endpoint is gated by KAYLE_INTERNAL_TOKEN; the
				// session cookie is forwarded so the API can identify the actor.
				const checkResponse = await env.API.fetch(
					"http://api/internal/auth/check-session-membership",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.KAYLE_INTERNAL_TOKEN}`,
							"Content-Type": "application/json",
							Cookie: cookie,
						},
						body: JSON.stringify({ organization_id: organizationId }),
					},
				);

				if (checkResponse.status === 401) {
					return jsonError("Sign in to verify this organization.", 401);
				}

				if (!checkResponse.ok) {
					return jsonError("Failed to validate organization.", 502);
				}

				const checkBody =
					(await checkResponse.json()) as CheckMembershipResponse;
				if (!checkBody.data) {
					return jsonError("Failed to validate organization.", 502);
				}

				if (!checkBody.data.is_owner) {
					return jsonError(
						"Only an owner of this organization can start verification.",
						403,
					);
				}

				const { organization } = checkBody.data;
				if (!organization) {
					return jsonError("Organization not found.", 404);
				}

				if (organization.verified_at) {
					return jsonError("Organization is already verified.", 409);
				}

				if (organization.pending_deletion_at) {
					return jsonError(
						"Organization is scheduled for deletion. Cancel the deletion before verifying.",
						410,
					);
				}

				if (!organization.verification_terms_accepted_at) {
					return jsonError(
						"Verification terms must be accepted before starting the flow.",
						400,
					);
				}

				// 2. Create the verification session as the platform org. The session
				// is owned by the platform — the verify app surfaces "Kayle Inc." as
				// the relying party, and the unverified-org UI on the customer org is
				// untouched by this session because the customer is not the caller.
				//
				// Only the three claims that feed the dedup hash are requested, all
				// `required: true`. The owner can't decline them, and we don't ask
				// for identity fields we won't use (name, DOB, etc.).
				const redirectUrl = new URL(
					"/organizations",
					getPublicHost(),
				).toString();
				const sessionResponse = await env.API.fetch("http://api/v1/sessions", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.KAYLE_INTERNAL_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						redirect_url: redirectUrl,
						share_fields: {
							document_type_code: {
								required: true,
								reason: "Used for anti-abuse hash computation.",
							},
							document_number: {
								required: true,
								reason: "Used for anti-abuse hash computation.",
							},
							issuing_country_code: {
								required: true,
								reason: "Used for anti-abuse hash computation.",
							},
						},
					}),
				});

				if (!sessionResponse.ok) {
					return jsonError("Failed to create verification session.", 502);
				}

				const sessionBody =
					(await sessionResponse.json()) as CreateSessionResponse;
				if (!sessionBody.data) {
					return jsonError(
						sessionBody.error?.message ??
							"Failed to create verification session.",
						502,
					);
				}

				// 3. Stash the session_id → target_org_id mapping. The webhook handler
				// reads this on `verification.attempt.succeeded` to know which org's
				// `verified_at` to flip via the trust-token finalize endpoint. Store
				// the initiating owner too so finalization can re-check ownership at
				// webhook time instead of trusting a stale session start.
				await env.ORG_VERIFICATIONS_KV.put(
					`${ORG_VERIFICATION_KV_PREFIX}${sessionBody.data.id}`,
					JSON.stringify({
						organization_id: organization.id,
						owner_user_id: checkBody.data.user_id,
					}),
					{ expirationTtl: SEVEN_DAYS_SECONDS },
				);
				emitCostEvent({
					dataset: resolveAnalyticsDataset(env),
					organizationId: organization.id,
					feature: COST_FEATURES.PublicVerifySession,
					resource: "kv_write",
					quantity: 1,
					unit: "operation",
					workerName: PLATFORM_WORKER_NAME,
					environment: APP_ENVIRONMENT,
					version: APP_VERSION,
				});

				return new Response(
					JSON.stringify({
						data: {
							session_id: sessionBody.data.id,
							verification_url: sessionBody.data.verification_url,
						},
						error: null,
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			},
		},
	},
});
