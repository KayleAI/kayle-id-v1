import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	DomainVerificationError,
	startDnsChallenge,
} from "@kayle-id/auth/domain-verification/service";
import { logEvent } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { ensureDomainOrgNotFrozen, resolveDomainActor } from "./context";
import { jsonFromDomainError, jsonFromUnexpectedDomainError } from "./errors";
import type { startDnsChallengeRoute } from "./openapi";
import type { DomainsAppEnv } from "./types";

export const startDnsChallengeHandler: RouteHandler<
	typeof startDnsChallengeRoute,
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

	const { apex_domain } = c.req.valid("json");

	try {
		const result = await startDnsChallenge({
			organizationId,
			userId,
			rawApex: apex_domain,
		});
		logEvent(log, {
			details: {
				organization_id: organizationId,
				apex_domain: result.recordName,
				has_conflict: result.conflict !== null,
			},
			event: "organizations.domain_challenge.dns.started",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "domain.challenge.started",
			targetId: result.challengeId,
			targetType: "domain_challenge",
			metadata: {
				method: "dns_txt",
				apex_domain,
				has_conflict: result.conflict !== null,
			},
		});
		return c.json(
			{
				data: {
					challenge_id: result.challengeId,
					record_name: result.recordName,
					record_value: result.recordValue,
					expires_at: result.expiresAt.toISOString(),
					conflict: result.conflict
						? { organization_name: result.conflict.organizationName }
						: null,
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		if (error instanceof DomainVerificationError) {
			return jsonFromDomainError(c, error);
		}

		return jsonFromUnexpectedDomainError(c, log, {
			code: "domain_challenge_dns_start_failed",
			error,
			event: "organizations.domain_challenge.dns.start.failed",
			message: "Failed to start DNS challenge.",
		});
	}
};
