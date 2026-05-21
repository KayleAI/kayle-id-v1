import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import type { ResolvedActor, RpTermsContext } from "./types";

export function resolveActor(c: RpTermsContext) {
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
						message: "Sign in to manage Kayle ID Integration Terms.",
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
						message:
							"Select an organization to manage Kayle ID Integration Terms.",
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
	c: RpTermsContext,
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
						hint: "Cancel the pending deletion before accepting Kayle ID Integration Terms.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}
