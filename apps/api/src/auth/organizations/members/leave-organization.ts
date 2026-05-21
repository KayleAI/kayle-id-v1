import type { RouteHandler } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { logSafeError } from "@kayle-id/config/logging";
import { getRequestLogger } from "@/logging";
import { ensureMemberOrgCanManageMembers, resolveMemberActor } from "./context";
import type { leaveOrganizationRoute } from "./openapi";
import { leaveOrganization } from "./service";
import type { MembersAppEnv } from "./types";

export const leaveOrganizationHandler: RouteHandler<
	typeof leaveOrganizationRoute,
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
		"Cancel the pending deletion before leaving.",
	);
	if (frozen) {
		return frozen;
	}

	try {
		const result = await leaveOrganization({
			organizationId,
			userId,
		});

		if (result.kind === "not_member") {
			return c.json(
				{
					data: null,
					error: {
						code: "FORBIDDEN" as const,
						message: "You are not a member of this organization.",
						hint: "Switch to an organization where you have an active membership.",
						docs: "https://kayle.id/docs/api/errors#forbidden",
					},
				},
				403,
			);
		}
		if (result.kind === "last_owner") {
			return c.json(
				{
					data: null,
					error: {
						code: "LAST_OWNER" as const,
						message:
							"You are the only active owner of this organization. Promote another member to owner before leaving.",
						hint: "Assign owner role to another active member, then retry.",
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
			event: "member.left",
			targetId: result.memberId,
			targetType: "member",
			metadata: {
				user_id: userId,
				role: result.role,
			},
		});

		return c.json(
			{
				data: {
					message: "You left the organization.",
					status: "success" as const,
				},
				error: null,
			},
			200,
		);
	} catch (error) {
		logSafeError(log, {
			code: "member_leave_failed",
			error,
			event: "organizations.members.leave.failed",
			message: "Failed to leave organization.",
			status: 500,
		});
		throw error;
	}
};
