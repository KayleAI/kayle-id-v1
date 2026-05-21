import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	DomainVerificationError,
	removeVerifiedDomain,
} from "@kayle-id/auth/domain-verification/service";
import { logEvent } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { ensureDomainOrgNotFrozen, resolveDomainActor } from "./context";
import { jsonFromDomainError, jsonFromUnexpectedDomainError } from "./errors";
import type { removeDomainRoute } from "./openapi";
import type { DomainsAppEnv } from "./types";

export const removeDomainHandler: RouteHandler<
	typeof removeDomainRoute,
	DomainsAppEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const actor = resolveDomainActor(c);
	if (!actor.ok) {
		return actor.response;
	}

	const { organizationId, userId } = actor.actor;
	const frozen = await ensureDomainOrgNotFrozen(c, organizationId);
	if (frozen) {
		return frozen;
	}

	const { id } = c.req.valid("param");

	try {
		await removeVerifiedDomain({
			organizationId,
			userId,
			domainId: id,
		});
		logEvent(log, {
			details: {
				organization_id: organizationId,
				domain_id: id,
			},
			event: "organizations.domain_revoked",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "domain.removed",
			targetId: id,
			targetType: "verified_domain",
		});
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}

		return jsonFromUnexpectedDomainError(c, log, {
			code: "domain_remove_failed",
			error,
			event: "organizations.domain_remove.failed",
			message: "Failed to remove verified domain.",
		});
	}
};
