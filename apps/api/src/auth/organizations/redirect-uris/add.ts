import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	ApexExtractionError,
	hostnameToApex,
} from "@kayle-id/auth/domain-verification/apex";
import {
	addRedirectUri,
	DomainVerificationError,
} from "@kayle-id/auth/domain-verification/service";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import {
	ensureOrgNotFrozen,
	jsonFromDomainError,
	resolveActor,
} from "./context";
import type { addRedirectUriRoute } from "./openapi";
import type { RedirectUrisEnv } from "./types";

export const addRedirectUriHandler: RouteHandler<
	typeof addRedirectUriRoute,
	RedirectUrisEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const frozen = await ensureOrgNotFrozen(c, actor.actor.organizationId);
	if (frozen) {
		return frozen;
	}

	const { pattern } = c.req.valid("json");

	let apex: string;
	try {
		const host = new URL(pattern).hostname.toLowerCase();
		apex = hostnameToApex(host);
	} catch (error) {
		const message =
			error instanceof ApexExtractionError
				? error.message
				: "Pattern URL is malformed.";
		return c.json(
			{
				data: null,
				error: {
					code: "INVALID_PATTERN" as const,
					message,
					hint: "Provide a fully-qualified https:// URL whose host is one of your verified domains or a subdomain of one.",
					docs: "https://kayle.id/docs/api/errors#bad_request",
				},
			},
			400,
		);
	}

	try {
		const result = await addRedirectUri({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			pattern,
			matchingApexDomain: apex,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				verified_domain_id: result.verifiedDomainId,
			},
			event: "organizations.redirect_uri.added",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: actor.actor.userId,
			organizationId: actor.actor.organizationId,
			event: "redirect_uri.added",
			targetId: result.id,
			targetType: "redirect_uri",
			metadata: {
				pattern,
				apex_domain: apex,
				verified_domain_id: result.verifiedDomainId,
			},
		});
		return c.json(
			{
				data: {
					id: result.id,
					verifiedDomainId: result.verifiedDomainId,
					apexDomain: apex,
					pattern,
					createdAt: new Date().toISOString(),
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "redirect_uri_add_failed",
			error,
			event: "organizations.redirect_uri.add.failed",
			message: "Failed to add redirect URI.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to add redirect URI.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
};
