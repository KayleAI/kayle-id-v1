import type { RouteHandler } from "@hono/zod-openapi";
import { listOrganizationDomains } from "@kayle-id/auth/domain-verification/service";
import { resolveDomainActor } from "./context";
import type { listDomainsRoute } from "./openapi";
import type { DomainsAppEnv } from "./types";

export const listDomainsHandler: RouteHandler<
	typeof listDomainsRoute,
	DomainsAppEnv
> = async (c) => {
	const actor = resolveDomainActor(c);
	if (!actor.ok) {
		return actor.response;
	}

	const { domains: verified, challenges } = await listOrganizationDomains({
		organizationId: actor.actor.organizationId,
	});

	return c.json(
		{
			data: {
				domains: verified.map((domain) => ({
					id: domain.id,
					apexDomain: domain.apexDomain,
					verifiedAt: domain.verifiedAt.toISOString(),
					verifiedVia: domain.verifiedVia,
					lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
					downgradedAt: domain.downgradedAt?.toISOString() ?? null,
				})),
				challenges: challenges.map((challenge) => ({
					id: challenge.id,
					apexDomain: challenge.apexDomain,
					method: challenge.method,
					expiresAt: challenge.expiresAt.toISOString(),
					createdAt: challenge.createdAt.toISOString(),
				})),
			},
			error: null,
		},
		200,
	);
};
