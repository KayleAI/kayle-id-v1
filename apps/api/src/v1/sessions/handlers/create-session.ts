import type { RouteHandler } from "@hono/zod-openapi";
import { logEvent } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import type { createSession } from "@/openapi/v1/sessions/create";
import { generateId } from "@/utils/generate-id";
import { normalizeShareFields } from "@/v1/sessions/domain/share-contract/normalize-share-fields";
import { mapSessionRowToResponse } from "@/v1/sessions/mappers/session-response";
import { createVerificationSessionWithUnverifiedOrgLimit } from "@/v1/sessions/repo/session-repo";
import type { SessionsAppEnv } from "@/v1/sessions/types";
import { isAgeOnlyShareFields } from "@/v1/sessions/unverified-org-limit";

const contractVersion = 1;
const docs = "https://kayle.id/docs/api/sessions#create";

export const createSessionHandler: RouteHandler<
	typeof createSession,
	SessionsAppEnv
> = async (c) => {
	const organizationId = c.get("organizationId");
	const log = getRequestLogger(c);
	const query = c.req.valid("query") ?? {};
	const body = c.req.valid("json");

	const redirectUrl = body?.redirect_url ?? null;

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

	const isAgeOnly = isAgeOnlyShareFields(normalized.shareFields);

	const id = generateId({ type: "vs" });
	const result = await createVerificationSessionWithUnverifiedOrgLimit({
		id,
		organizationId,
		redirectUrl,
		shareFields: normalized.shareFields,
		contractVersion,
		isAgeOnly,
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
	});

	const data = mapSessionRowToResponse({
		row: created,
		attempts: query.include_attempts ? [] : undefined,
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
