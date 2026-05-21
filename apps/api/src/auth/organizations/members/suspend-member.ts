import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import {
	ensureMemberOrgCanManageMembers,
	requireMemberAdmin,
	resolveMemberActor,
} from "./context";
import type { suspendMemberRoute } from "./openapi";
import { suspendMember } from "./service";
import type { MembersAppEnv } from "./types";

export const suspendMemberHandler: RouteHandler<
	typeof suspendMemberRoute,
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
		"Cancel the pending deletion before suspending members.",
	);
	if (frozen) {
		return frozen;
	}

	const forbidden = await requireMemberAdmin(c, resolved.actor, "suspend");
	if (forbidden) {
		return forbidden;
	}

	const { id: memberId } = c.req.valid("param");

	try {
		const result = await suspendMember({
			memberId,
			organizationId,
			userId,
		});

		if (result.kind === "not_found") {
			return c.json(
				{
					data: null,
					error: {
						code: "MEMBER_NOT_FOUND" as const,
						message: "Member not found in this organization.",
						hint: "The member may already be suspended or no longer belong to this organization.",
						docs: "https://kayle.id/docs/api/errors#not_found",
					},
				},
				404,
			);
		}
		if (result.kind === "last_owner") {
			return c.json(
				{
					data: null,
					error: {
						code: "LAST_OWNER" as const,
						message:
							"This member is the only active owner. Promote another member to owner before suspending them.",
						hint: "Assign owner role to another active member, then retry.",
						docs: "https://kayle.id/docs/api/errors#conflict",
					},
				},
				409,
			);
		}

		const isSelf = result.targetUserId === userId;
		await recordAuditLogSafe({
			actorType: "user",
			actorUserId: userId,
			organizationId,
			event: isSelf ? "member.left" : "member.suspended",
			targetId: memberId,
			targetType: "member",
			metadata: {
				user_id: result.targetUserId,
				role: result.role,
			},
		});

		return c.json(
			{
				data: { message: "Member suspended.", status: "success" as const },
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "member_suspend_failed",
			error,
			event: "organizations.members.suspend.failed",
			message: "Failed to suspend member.",
			status: 500,
		});
		throw error;
	}
};
