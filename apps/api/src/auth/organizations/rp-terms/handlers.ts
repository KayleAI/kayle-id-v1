import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	RP_INTEGRATION_TERMS_HASH,
	RP_INTEGRATION_TERMS_JURISDICTION,
	RP_INTEGRATION_TERMS_VERSION,
} from "@kayle-id/auth/rp-integration-terms";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { ensureOrgNotFrozen, resolveActor } from "./context";
import type { acceptRpTermsRoute, getRpTermsRoute } from "./openapi";
import {
	acceptCurrentRpTerms,
	getCurrentAcceptance,
	toStatusResponse,
} from "./service";
import type { RpTermsEnv } from "./types";

export const getRpTermsHandler: RouteHandler<
	typeof getRpTermsRoute,
	RpTermsEnv
> = async (c) => {
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}

	const acceptance = await getCurrentAcceptance(actor.actor.organizationId);

	return c.json(
		{
			data: toStatusResponse(acceptance),
			error: null,
		},
		200,
	);
};

export const acceptRpTermsHandler: RouteHandler<
	typeof acceptRpTermsRoute,
	RpTermsEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const { organizationId, userId } = actor.actor;

	const frozenResponse = await ensureOrgNotFrozen(c, organizationId);
	if (frozenResponse) {
		return frozenResponse;
	}

	const result = await acceptCurrentRpTerms({
		organizationId,
		userId,
	});

	if (result.kind === "forbidden") {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner can accept Kayle ID Integration Terms.",
					hint: "Ask an owner of this organization to accept the current Kayle ID Integration Terms.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	if (result.kind === "record_failed") {
		logSafeError(log, {
			code: "rp_terms_accept_failed",
			details: { organization_id: organizationId },
			error: result.error,
			event: "organizations.rp_terms.accept.failed",
			message: "Failed to record Kayle ID Integration Terms acceptance.",
			status: 500,
		});

		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to record Kayle ID Integration Terms acceptance.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}

	logEvent(log, {
		details: {
			organization_id: organizationId,
			terms_hash: RP_INTEGRATION_TERMS_HASH,
			terms_version: RP_INTEGRATION_TERMS_VERSION,
		},
		event: "organizations.rp_terms.accepted",
	});
	await recordAuditLogSafe({
		actorType: "user",
		actorUserId: userId,
		organizationId,
		event: "organization.rp_terms.accepted",
		targetId: organizationId,
		targetType: "organization",
		metadata: {
			jurisdiction: RP_INTEGRATION_TERMS_JURISDICTION,
			terms_hash: RP_INTEGRATION_TERMS_HASH,
			terms_version: RP_INTEGRATION_TERMS_VERSION,
		},
	});

	return c.json(
		{
			data: toStatusResponse(result.acceptance),
			error: null,
		},
		200,
	);
};
