import { hasOrgRole } from "@kayle-id/auth/permissions";
import { db } from "@kayle-id/database/drizzle";
import { auth_organization_members } from "@kayle-id/database/schema/auth";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";

const ROLE_OWNER = "owner";
const UNIQUE_VIOLATION_CODE = "23505";

interface ActiveMembershipRow {
	id: string;
	role: string;
	userId: string;
}

async function getActiveMembershipById(
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

async function getActiveMembershipByUser(
	executor: typeof db,
	organizationId: string,
	userId: string,
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
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
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

export async function canManageMembers({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}): Promise<boolean> {
	const membership = await getActiveMembershipByUser(
		db,
		organizationId,
		userId,
	);
	return membership ? hasOrgRole(membership.role, "admin") : false;
}

type SuspendMemberResult =
	| { kind: "not_found" }
	| { kind: "last_owner" }
	| { kind: "suspended"; role: string; targetUserId: string };

export async function suspendMember({
	memberId,
	organizationId,
	userId,
}: {
	memberId: string;
	organizationId: string;
	userId: string;
}): Promise<SuspendMemberResult> {
	return db.transaction(async (tx) => {
		const target = await getActiveMembershipById(
			tx as unknown as typeof db,
			organizationId,
			memberId,
		);
		if (!target) {
			return { kind: "not_found" as const };
		}

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
}

type LeaveOrganizationResult =
	| { kind: "not_member" }
	| { kind: "last_owner" }
	| { kind: "left"; memberId: string; role: string };

export async function leaveOrganization({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}): Promise<LeaveOrganizationResult> {
	return db.transaction(async (tx) => {
		const own = await getActiveMembershipByUser(
			tx as unknown as typeof db,
			organizationId,
			userId,
		);

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
}

type ReinstateMemberResult =
	| { kind: "not_found" }
	| { kind: "not_suspended" }
	| { kind: "active_conflict" }
	| { kind: "reinstated"; role: string; targetUserId: string };

export async function reinstateMember({
	memberId,
	organizationId,
}: {
	memberId: string;
	organizationId: string;
}): Promise<ReinstateMemberResult> {
	return db.transaction(async (tx) => {
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

		try {
			await tx
				.update(auth_organization_members)
				.set({ suspendedAt: null, suspendedBy: null })
				.where(eq(auth_organization_members.id, memberId));
		} catch (error) {
			if (
				error instanceof Error &&
				typeof (error as { code?: string }).code === "string" &&
				(error as { code?: string }).code === UNIQUE_VIOLATION_CODE
			) {
				return { kind: "active_conflict" as const };
			}
			throw error;
		}

		return {
			kind: "reinstated" as const,
			role: target.role,
			targetUserId: target.userId,
		};
	});
}
