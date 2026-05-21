import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	DomainVerificationError,
	removeRedirectUri,
} from "@kayle-id/auth/domain-verification/service";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import {
	ensureOrgNotFrozen,
	jsonFromDomainError,
	resolveActor,
} from "./context";
import type { removeRedirectUriRoute } from "./openapi";
import type { RedirectUrisEnv } from "./types";

export const removeRedirectUriHandler: RouteHandler<
	typeof removeRedirectUriRoute,
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

	const { id } = c.req.valid("param");

	try {
		await removeRedirectUri({
			organizationId: actor.actor.organizationId,
			userId: actor.actor.userId,
			redirectUriId: id,
		});
		logEvent(log, {
			details: {
				organization_id: actor.actor.organizationId,
				redirect_uri_id: id,
			},
			event: "organizations.redirect_uri.removed",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: actor.actor.userId,
			organizationId: actor.actor.organizationId,
			event: "redirect_uri.removed",
			targetId: id,
			targetType: "redirect_uri",
		});
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}
		logSafeError(log, {
			code: "redirect_uri_remove_failed",
			error,
			event: "organizations.redirect_uri.remove.failed",
			message: "Failed to remove redirect URI.",
			status: 500,
		});
		return c.json(
			{
				data: null,
				error: {
					code: "INTERNAL_SERVER_ERROR" as const,
					message: "Failed to remove redirect URI.",
					hint: "Please try again in a few moments.",
					docs: "https://kayle.id/docs/api/errors#internal_server_error",
				},
			},
			500,
		);
	}
};
