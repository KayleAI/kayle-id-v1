import type { RouteHandler } from "@hono/zod-openapi";
import { listRedirectUris } from "@kayle-id/auth/domain-verification/service";
import { resolveActor } from "./context";
import type { listRedirectUrisRoute } from "./openapi";
import type { RedirectUrisEnv } from "./types";

export const listRedirectUrisHandler: RouteHandler<
	typeof listRedirectUrisRoute,
	RedirectUrisEnv
> = async (c) => {
	const actor = resolveActor(c);
	if (!actor.ok) {
		return actor.response;
	}
	const rows = await listRedirectUris({
		organizationId: actor.actor.organizationId,
	});
	return c.json(
		{
			data: rows.map((row) => ({
				id: row.id,
				verifiedDomainId: row.verifiedDomainId,
				apexDomain: row.apexDomain,
				pattern: row.pattern,
				createdAt: row.createdAt.toISOString(),
			})),
			error: null,
		},
		200,
	);
};
