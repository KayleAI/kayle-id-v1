import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	DomainVerificationError,
	verifyDnsChallenge,
} from "@kayle-id/auth/domain-verification/service";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { ensureDomainOrgNotFrozen, resolveDomainActor } from "./context";
import { jsonFromDomainError, jsonFromUnexpectedDomainError } from "./errors";
import type { verifyDnsChallengeRoute } from "./openapi";
import { notifyDomainTakeover } from "./takeover-notice";
import type { DomainsAppEnv } from "./types";

function scheduleBackgroundTask(
	c: Parameters<RouteHandler<typeof verifyDnsChallengeRoute, DomainsAppEnv>>[0],
	task: Promise<unknown>,
): void {
	try {
		c.executionCtx.waitUntil(task);
	} catch {
		void task;
	}
}

export const verifyDnsChallengeHandler: RouteHandler<
	typeof verifyDnsChallengeRoute,
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

	const { challenge_id, acknowledge_takeover } = c.req.valid("json");

	try {
		const result = await verifyDnsChallenge({
			organizationId,
			userId,
			challengeId: challenge_id,
			acknowledgeTakeover: acknowledge_takeover ?? false,
		});
		logEvent(log, {
			details: {
				organization_id: organizationId,
				domain_id: result.domainId,
				took_over_from_organization_id:
					result.takeoverFrom?.organizationId ?? null,
			},
			event: result.takeoverFrom
				? "organizations.domain_verified.dns.takeover"
				: "organizations.domain_verified.dns",
		});
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "domain.verified",
			targetId: result.domainId,
			targetType: "verified_domain",
			metadata: {
				apex_domain: result.apexDomain,
				method: "dns_txt",
				takeover_from_organization_id:
					result.takeoverFrom?.organizationId ?? null,
			},
		});

		if (result.takeoverFrom) {
			const takeoverTask = notifyDomainTakeover({
				apexDomain: result.apexDomain,
				previousOrganizationId: result.takeoverFrom.organizationId,
				takingOverOrganizationId: organizationId,
			}).catch((err) =>
				logSafeError(log, {
					code: "domain_takeover_notify_failed",
					error: err,
					event: "organizations.domain_verified.dns.takeover.notify_failed",
					message: "Failed to email previous owner after takeover.",
					status: 500,
				}),
			);
			scheduleBackgroundTask(c, takeoverTask);
		}

		return c.json(
			{
				data: {
					domain_id: result.domainId,
					apex_domain: result.apexDomain,
					takeover_from: result.takeoverFrom
						? {
								organization_id: result.takeoverFrom.organizationId,
								organization_name: result.takeoverFrom.organizationName,
							}
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
			code: "domain_challenge_dns_verify_failed",
			error,
			event: "organizations.domain_challenge.dns.verify.failed",
			message: "Failed to verify DNS challenge.",
		});
	}
};
