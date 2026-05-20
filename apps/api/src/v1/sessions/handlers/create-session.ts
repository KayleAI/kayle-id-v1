import type { RouteHandler } from "@hono/zod-openapi";
import { logEvent } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { and, eq, inArray } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import type { createSession } from "@/openapi/v1/sessions/create";
import { generateId } from "@/utils/generate-id";
import { denyIfOrgFrozen } from "@/v1/auth";
import { normalizeShareFields } from "@/v1/sessions/domain/share-contract/normalize-share-fields";
import { mapSessionRowToResponse } from "@/v1/sessions/mappers/session-response";
import { validateRedirectUrlForOrg } from "@/v1/sessions/redirect-uri-validator";
import { createVerificationSessionWithUnverifiedOrgLimit } from "@/v1/sessions/repo/session-repo";
import { checkOrganizationOnboardingGate } from "@/v1/sessions/rp-compliance-profile";
import type { SessionsAppEnv } from "@/v1/sessions/types";
import { isAgeOnlyShareFields } from "@/v1/sessions/unverified-org-limit";

const contractVersion = 1;
const docs = "https://kayle.id/docs/api/sessions#create";

function normalizeWebhookEndpointTargetIds(
	input: string | string[] | undefined,
): string[] | null {
	if (input === undefined) {
		return null;
	}

	const ids = Array.isArray(input) ? input : [input];
	return Array.from(new Set(ids));
}

async function validateWebhookEndpointTargets({
	endpointIds,
	organizationId,
}: {
	endpointIds: string[] | null;
	organizationId: string;
}): Promise<
	| { ok: true; endpointIds: string[] | null }
	| { ok: false; missingOrDisabledIds: string[] }
> {
	if (!endpointIds) {
		return { ok: true, endpointIds: null };
	}
	if (endpointIds.length === 0) {
		return { ok: true, endpointIds: null };
	}

	const rows = await db
		.select({ id: webhook_endpoints.id })
		.from(webhook_endpoints)
		.where(
			and(
				eq(webhook_endpoints.organizationId, organizationId),
				eq(webhook_endpoints.enabled, true),
				inArray(webhook_endpoints.id, endpointIds),
			),
		);
	const availableIds = new Set(rows.map((row) => row.id));
	const missingOrDisabledIds = endpointIds.filter(
		(id) => !availableIds.has(id),
	);

	if (missingOrDisabledIds.length > 0) {
		return { ok: false, missingOrDisabledIds };
	}

	return { ok: true, endpointIds };
}

export const createSessionHandler: RouteHandler<
	typeof createSession,
	SessionsAppEnv
> = async (c) => {
	const organizationId = c.get("organizationId");
	const log = getRequestLogger(c);
	const body = c.req.valid("json");

	const frozenResponse = await denyIfOrgFrozen(c);
	if (frozenResponse) {
		return frozenResponse;
	}

	const redirectValidation = await validateRedirectUrlForOrg({
		organizationId,
		raw: body?.redirect_url ?? null,
	});
	if (!redirectValidation.ok) {
		logEvent(log, {
			details: {
				organization_id: organizationId,
				error_code: redirectValidation.code,
			},
			event: "sessions.create.redirect_url_rejected",
			level: "warn",
		});
		return c.json(
			{
				data: null,
				error: {
					code: redirectValidation.code,
					message: redirectValidation.message,
					hint: "Verify a domain on the Domains page that covers this redirect host. Any subdomain of a verified apex is accepted by default; add explicit redirect URI patterns to narrow further.",
					docs,
				},
			},
			400,
		);
	}
	const redirectUrl = redirectValidation.normalized;

	const normalized = normalizeShareFields(body?.share_fields);
	if (!normalized.ok) {
		logEvent(log, {
			details: {
				organization_id: organizationId,
				error_code: normalized.error.code,
				status: normalized.error.status,
			},
			event: "sessions.create.validation_failed",
			level: "warn",
		});

		return c.json(
			{
				data: null,
				error: {
					code: normalized.error.code,
					message: normalized.error.message,
					hint: normalized.error.hint,
					docs: normalized.error.docs,
				},
			},
			normalized.error.status,
		);
	}

	const targetValidation = await validateWebhookEndpointTargets({
		endpointIds: normalizeWebhookEndpointTargetIds(body?.webhook_endpoint_id),
		organizationId,
	});
	if (!targetValidation.ok) {
		logEvent(log, {
			details: {
				organization_id: organizationId,
				webhook_endpoint_count: targetValidation.missingOrDisabledIds.length,
			},
			event: "sessions.create.webhook_endpoint_rejected",
			level: "warn",
		});

		return c.json(
			{
				data: null,
				error: {
					code: "WEBHOOK_ENDPOINT_UNAVAILABLE",
					message: "Webhook endpoint is unavailable.",
					hint: "Provide enabled webhook endpoint IDs that belong to this organization, or omit `webhook_endpoint_id` to fan out to all enabled subscribed endpoints.",
					docs,
				},
			},
			400,
		);
	}

	const isAgeOnly = isAgeOnlyShareFields(normalized.shareFields);
	const onboardingGate = await checkOrganizationOnboardingGate({
		organizationId,
	});
	if (!onboardingGate.ok) {
		const termsAcceptanceRequired =
			onboardingGate.reason === "terms_not_accepted";
		logEvent(log, {
			details: {
				organization_id: organizationId,
				missing_steps: onboardingGate.missingSteps,
				missing_fields: onboardingGate.missingFields,
				reason: onboardingGate.reason,
			},
			event: "sessions.create.onboarding_incomplete",
			level: "warn",
		});

		return c.json(
			{
				data: null,
				error: {
					code: termsAcceptanceRequired
						? "RP_TERMS_ACCEPTANCE_REQUIRED"
						: "ONBOARDING_INCOMPLETE",
					message: termsAcceptanceRequired
						? "Accept the current relying-party integration terms before creating production verification sessions."
						: "Finish onboarding the organization before creating verification sessions.",
					hint: termsAcceptanceRequired
						? "An owner must accept the current Kayle ID Integration Terms in the organization settings."
						: `Missing onboarding steps: ${onboardingGate.missingSteps.join(", ")}. Finish the organization onboarding flow at /onboarding (missing fields: ${onboardingGate.missingFields.join(", ")}).`,
					docs,
				},
			},
			400,
		);
	}

	const id = generateId({ type: "vs" });
	const result = await createVerificationSessionWithUnverifiedOrgLimit({
		id,
		organizationId,
		redirectUrl,
		shareFields: normalized.shareFields,
		contractVersion,
		isAgeOnly,
		webhookEndpointIds: targetValidation.endpointIds,
	});

	if (!result.ok) {
		logEvent(log, {
			details: {
				organization_id: organizationId,
				current: result.rejected.current,
				limit: result.rejected.limit,
				reset_at: result.rejected.resetAt.toISOString(),
			},
			event: "sessions.create.unverified_org_limit_exceeded",
			level: "warn",
		});

		return c.json(
			{
				data: null,
				error: {
					code: "ORG_NOT_VERIFIED_LIMIT_EXCEEDED",
					message:
						"Unverified organizations are limited to 5 identity-revealing sessions per 24 hours.",
					hint: "Verify the organization in the platform settings, or wait until the rolling window resets. Age-gate-only sessions remain available.",
					docs,
				},
			},
			429,
		);
	}

	const { row: created, cancelToken } = result;

	log.set({
		event: "sessions.create.created",
		organization_id: organizationId,
		session_id: created.id,
		share_field_count: Object.keys(normalized.shareFields).length,
		webhook_endpoint_count: created.webhookEndpointIds?.length ?? 0,
	});

	const data = mapSessionRowToResponse({
		row: created,
		cancelToken,
	});

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
};
