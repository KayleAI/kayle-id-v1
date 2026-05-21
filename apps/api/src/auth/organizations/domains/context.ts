import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import type { Context } from "hono";
import type { DomainActor, DomainsAppEnv } from "./types";

type DomainCtx = Context<DomainsAppEnv>;

const UNAUTHORIZED_PAYLOAD = {
	data: null,
	error: {
		code: "UNAUTHORIZED" as const,
		message: "Sign in to manage verified domains.",
		hint: "Send a session cookie or use a session-authenticated client.",
		docs: "https://kayle.id/docs/api/errors#unauthorized",
	},
} as const;

const NO_ACTIVE_ORG_PAYLOAD = {
	data: null,
	error: {
		code: "FORBIDDEN" as const,
		message: "Select an organization to manage verified domains.",
		hint: "The active session must have an organization selected.",
		docs: "https://kayle.id/docs/api/errors#forbidden",
	},
} as const;

export function resolveDomainActor(c: DomainCtx) {
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return {
			ok: false as const,
			response: c.json(UNAUTHORIZED_PAYLOAD, 401),
		};
	}

	if (!organizationId) {
		return {
			ok: false as const,
			response: c.json(NO_ACTIVE_ORG_PAYLOAD, 403),
		};
	}

	return {
		ok: true as const,
		actor: { organizationId, userId } satisfies DomainActor,
	};
}

export async function ensureDomainOrgNotFrozen(
	c: DomainCtx,
	organizationId: string,
) {
	try {
		await assertOrgNotFrozen(organizationId);
		return null;
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before managing verified domains.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}
