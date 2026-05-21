import type { DomainVerificationError } from "@kayle-id/auth/domain-verification/service";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import type { RedirectUriContext, ResolvedActor } from "./types";

export function resolveActor(c: RedirectUriContext) {
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");
	if (!userId) {
		return {
			ok: false as const,
			response: c.json(
				{
					data: null,
					error: {
						code: "UNAUTHORIZED" as const,
						message: "Sign in to manage redirect URIs.",
						hint: "Send a session cookie or use a session-authenticated client.",
						docs: "https://kayle.id/docs/api/errors#unauthorized",
					},
				},
				401,
			),
		};
	}
	if (!organizationId) {
		return {
			ok: false as const,
			response: c.json(
				{
					data: null,
					error: {
						code: "FORBIDDEN" as const,
						message: "Select an organization to manage redirect URIs.",
						hint: "The active session must have an organization selected.",
						docs: "https://kayle.id/docs/api/errors#forbidden",
					},
				},
				403,
			),
		};
	}
	return {
		ok: true as const,
		actor: { organizationId, userId } satisfies ResolvedActor,
	};
}

export async function ensureOrgNotFrozen(
	c: RedirectUriContext,
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
						hint: "Cancel the pending deletion before managing redirect URIs.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}

export function jsonFromDomainError(
	c: RedirectUriContext,
	error: DomainVerificationError,
) {
	const allowed = [400, 403, 404, 422, 500] as const;
	const status = (allowed as readonly number[]).includes(error.status)
		? (error.status as (typeof allowed)[number])
		: 500;
	return c.json(
		{
			data: null,
			error: {
				code: error.code,
				message: error.message,
				hint:
					error.code === "DOMAIN_NOT_FOUND"
						? "Verify a domain that covers this URL's host first."
						: "Refresh the Domains page and try again.",
				docs: "https://kayle.id/docs/api/errors",
			},
		},
		status,
	);
}
