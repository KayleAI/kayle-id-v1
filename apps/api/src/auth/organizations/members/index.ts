import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import {
	assertOrgNotFrozen,
	OrgDeletionError,
} from "@kayle-id/auth/organization-deletion";
import { hasOrgRole } from "@kayle-id/auth/permissions";
import { logSafeError } from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import { auth_organization_members } from "@kayle-id/database/schema/auth";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { getRequestLogger } from "@/logging";
import {
	leaveOrganizationRoute,
	reinstateMemberRoute,
	suspendMemberRoute,
} from "./openapi";

const members = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
}>();

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

const ROLE_OWNER = "owner";

interface ActiveMembershipRow {
	id: string;
	role: string;
	userId: string;
}

async function getActiveMembership(
	executor: typeof db,
	organizationId: string,
	memberId: string,
): Promise<ActiveMembershipRow | null> {
	const [row] = await executor
		.select({
			id: auth_organization_members.id,
			role: auth_organization_members.role,
			userId: auth_organization_members.userId,
		})
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.id, memberId),
				eq(auth_organization_members.organizationId, organizationId),
				isNull(auth_organization_members.suspendedAt),
			),
		)
		.limit(1);
	return row ?? null;
}

async function countOtherActiveOwners(
	executor: typeof db,
	organizationId: string,
	excludingMemberId: string,
): Promise<number> {
	// Owners can hold a comma-separated role string (e.g. "admin,owner"), so
	// we match the same way `memberHasOwnerRoleSql` does.
	const [row] = await executor
		.select({ count: count() })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				ne(auth_organization_members.id, excludingMemberId),
				isNull(auth_organization_members.suspendedAt),
				sql`${auth_organization_members.role} ~ '(^|,)owner(,|$)'`,
			),
		);
	return row?.count ?? 0;
}

members.openapi(suspendMemberRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return c.json(UNAUTHORIZED_PAYLOAD, 401);
	}
	if (!organizationId) {
		return c.json(NO_ACTIVE_ORG_PAYLOAD, 403);
	}

	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before suspending members.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}

	const callerMembership = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
				isNull(auth_organization_members.suspendedAt),
			),
		)
		.limit(1);

	if (
		callerMembership.length === 0 ||
		!hasOrgRole(callerMembership[0]?.role ?? "", "admin")
	) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner or admin can suspend members.",
					hint: "Ask an owner or admin of this organization to suspend the member.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	const { id: memberId } = c.req.valid("param");

	try {
		const result = await db.transaction(async (tx) => {
			const target = await getActiveMembership(
				tx as unknown as typeof db,
				organizationId,
				memberId,
			);
			if (!target) {
				return { kind: "not_found" as const };
			}

			// Only block hardship: the very last *active* owner cannot be suspended,
			// otherwise the org becomes unmanageable. A non-owner suspension is
			// always fine; an owner suspension is fine as long as another active
			// owner remains.
			if (hasOrgRole(target.role, ROLE_OWNER)) {
				const remaining = await countOtherActiveOwners(
					tx as unknown as typeof db,
					organizationId,
					memberId,
				);
				if (remaining === 0) {
					return { kind: "last_owner" as const };
				}
			}

			const now = new Date();
			await tx
				.update(auth_organization_members)
				.set({ suspendedAt: now, suspendedBy: userId })
				.where(eq(auth_organization_members.id, memberId));

			return {
				kind: "suspended" as const,
				role: target.role,
				targetUserId: target.userId,
			};
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
});

members.openapi(leaveOrganizationRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return c.json(UNAUTHORIZED_PAYLOAD, 401);
	}
	if (!organizationId) {
		return c.json(NO_ACTIVE_ORG_PAYLOAD, 403);
	}

	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before leaving.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}

	try {
		const result = await db.transaction(async (tx) => {
			const [own] = await tx
				.select({
					id: auth_organization_members.id,
					role: auth_organization_members.role,
				})
				.from(auth_organization_members)
				.where(
					and(
						eq(auth_organization_members.organizationId, organizationId),
						eq(auth_organization_members.userId, userId),
						isNull(auth_organization_members.suspendedAt),
					),
				)
				.limit(1);

			if (!own) {
				return { kind: "not_member" as const };
			}

			if (hasOrgRole(own.role, ROLE_OWNER)) {
				const remaining = await countOtherActiveOwners(
					tx as unknown as typeof db,
					organizationId,
					own.id,
				);
				if (remaining === 0) {
					return { kind: "last_owner" as const };
				}
			}

			const now = new Date();
			await tx
				.update(auth_organization_members)
				.set({ suspendedAt: now, suspendedBy: userId })
				.where(eq(auth_organization_members.id, own.id));

			return { kind: "left" as const, memberId: own.id, role: own.role };
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
});

members.openapi(reinstateMemberRoute, async (c) => {
	const log = getRequestLogger(c);
	const userId = c.get("userId");
	const organizationId = c.get("organizationId");

	if (!userId) {
		return c.json(UNAUTHORIZED_PAYLOAD, 401);
	}
	if (!organizationId) {
		return c.json(NO_ACTIVE_ORG_PAYLOAD, 403);
	}

	try {
		await assertOrgNotFrozen(organizationId);
	} catch (error) {
		if (error instanceof OrgDeletionError && error.status === 410) {
			return c.json(
				{
					data: null,
					error: {
						code: "ORGANIZATION_FROZEN" as const,
						message: error.message,
						hint: "Cancel the pending deletion before reinstating members.",
						docs: "https://kayle.id/docs/api/errors#organization_frozen",
					},
				},
				410,
			);
		}
		throw error;
	}

	const callerMembership = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
				isNull(auth_organization_members.suspendedAt),
			),
		)
		.limit(1);

	if (
		callerMembership.length === 0 ||
		!hasOrgRole(callerMembership[0]?.role ?? "", "admin")
	) {
		return c.json(
			{
				data: null,
				error: {
					code: "FORBIDDEN" as const,
					message: "Only an owner or admin can reinstate members.",
					hint: "Ask an owner or admin of this organization to reinstate the member.",
					docs: "https://kayle.id/docs/api/errors#forbidden",
				},
			},
			403,
		);
	}

	const { id: memberId } = c.req.valid("param");

	try {
		const result = await db.transaction(async (tx) => {
			const [target] = await tx
				.select({
					id: auth_organization_members.id,
					role: auth_organization_members.role,
					suspendedAt: auth_organization_members.suspendedAt,
					userId: auth_organization_members.userId,
				})
				.from(auth_organization_members)
				.where(
					and(
						eq(auth_organization_members.id, memberId),
						eq(auth_organization_members.organizationId, organizationId),
					),
				)
				.limit(1);

			if (!target) {
				return { kind: "not_found" as const };
			}
			if (!target.suspendedAt) {
				return { kind: "not_suspended" as const };
			}

			// The (organization_id, user_id) partial unique index on active rows
			// guards against bringing back a row that conflicts with another
			// already-active membership for the same user. Catch the unique
			// violation and surface it as 409 instead of letting it 500.
			try {
				await tx
					.update(auth_organization_members)
					.set({ suspendedAt: null, suspendedBy: null })
					.where(eq(auth_organization_members.id, memberId));
			} catch (err) {
				if (
					err instanceof Error &&
					typeof (err as { code?: string }).code === "string" &&
					(err as { code?: string }).code === "23505"
				) {
					return { kind: "active_conflict" as const };
				}
				throw err;
			}

			return {
				kind: "reinstated" as const,
				role: target.role,
				targetUserId: target.userId,
			};
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
});

export { members };
