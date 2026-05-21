import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import type { Context } from "hono";
import { canManageMembers } from "./service";
import type { MemberActor, MembersAppEnv } from "./types";

type MemberCtx = Context<MembersAppEnv>;

const UNAUTHORIZED_PAYLOAD = {
	data: null,
	error: {
		code: "UNAUTHORIZED" as const,
		message: "Sign in to manage organization members.",
		hint: "Send a session cookie or use a session-authenticated client.",
		docs: "https://kayle.id/docs/api/errors#unauthorized",
	},
} as const;

const NO_ACTIVE_ORG_PAYLOAD = {
	data: null,
	error: {
		code: "FORBIDDEN" as const,
		message: "Select an organization to manage members.",
		hint: "The active session must have an organization selected.",
		docs: "https://kayle.id/docs/api/errors#forbidden",
	},
} as const;

export function resolveMemberActor(c: MemberCtx) {
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
		actor: { organizationId, userId } satisfies MemberActor,
	};
}

export async function ensureMemberOrgCanManageMembers(
	c: MemberCtx,
	organizationId: string,
	hint: string,
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
						hint,
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}
}

export async function requireMemberAdmin(
	c: MemberCtx,
	actor: MemberActor,
	action: "suspend" | "reinstate",
) {
	if (await canManageMembers(actor)) {
		return null;
	}

	return c.json(
		{
			data: null,
			error: {
				code: "FORBIDDEN" as const,
				message: `Only an owner or admin can ${action} members.`,
				hint: `Ask an owner or admin of this organization to ${action} the member.`,
				docs: "https://kayle.id/docs/api/errors#forbidden",
			},
		},
		403,
	);
}
