import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import {
	ensureMemberOrgCanManageMembers,
	requireMemberAdmin,
	resolveMemberActor,
} from "./context";
import type { reinstateMemberRoute } from "./openapi";
import { reinstateMember } from "./service";
import type { MembersAppEnv } from "./types";

export const reinstateMemberHandler: RouteHandler<
	typeof reinstateMemberRoute,
	MembersAppEnv
> = async (c) => {
	const log = getRequestLogger(c);
	const resolved = resolveMemberActor(c);
	if (!resolved.ok) {
		return resolved.response;
	}

	const { organizationId, userId } = resolved.actor;
	const frozen = await ensureMemberOrgCanManageMembers(
		c,
		organizationId,
		"Cancel the pending deletion before reinstating members.",
	);
	if (frozen) {
		return frozen;
	}

	const forbidden = await requireMemberAdmin(c, resolved.actor, "reinstate");
	if (forbidden) {
		return forbidden;
	}

	const { id: memberId } = c.req.valid("param");

	try {
		const result = await reinstateMember({
			memberId,
			organizationId,
		});

		if (result.kind === "not_found" || result.kind === "not_suspended") {
			return c.json(
				{
					data: null,
					error: {
						code: "MEMBER_NOT_FOUND" as const,
						message:
							result.kind === "not_suspended"
								? "Member is not currently suspended."
								: "Member not found in this organization.",
						hint: "Confirm the member id and that the row is suspended.",
						docs: "https://kayle.id/docs/api/errors#not_found",
					},
				},
				404,
			);
		}
		if (result.kind === "active_conflict") {
			return c.json(
				{
					data: null,
					error: {
						code: "ACTIVE_MEMBERSHIP_CONFLICT" as const,
						message:
							"This user already has another active membership in this organization.",
						hint: "Suspend or remove the conflicting active membership before reinstating this one.",
						docs: "https://kayle.id/docs/api/errors#conflict",
					},
				},
				409,
			);
		}

		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: "member.reinstated",
			targetId: memberId,
			targetType: "member",
			metadata: {
				user_id: result.targetUserId,
				role: result.role,
			},
		});

		return c.json(
			{
				data: { message: "Member reinstated.", status: "success" as const },
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "member_reinstate_failed",
			error,
			event: "organizations.members.reinstate.failed",
			message: "Failed to reinstate member.",
			status: 500,
		});
		throw error;
	}
};
