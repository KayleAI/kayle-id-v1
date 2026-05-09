import type { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import { hasOrgRole } from "@/auth/permissions";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ApiKeyAuthorizationFailureReason = "forbidden" | "frozen";

export class ApiKeyManagementAuthorizationError extends Error {
	reason: ApiKeyAuthorizationFailureReason;

	constructor(reason: ApiKeyAuthorizationFailureReason) {
		super(`api_key_management_${reason}`);
		this.name = "ApiKeyManagementAuthorizationError";
		this.reason = reason;
	}
}

export async function assertCanManageApiKeys(
	tx: Tx,
	{
		organizationId,
		userId,
	}: {
		organizationId: string;
		userId: string;
	},
): Promise<void> {
	const [membership] = await tx
		.select({
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			role: auth_organization_members.role,
		})
		.from(auth_organization_members)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, auth_organization_members.organizationId),
		)
		.where(
			and(
				eq(auth_organization_members.organizationId, organizationId),
				eq(auth_organization_members.userId, userId),
			),
		)
		.limit(1)
		.for("update");

	if (!membership || !hasOrgRole(membership.role, "admin")) {
		throw new ApiKeyManagementAuthorizationError("forbidden");
	}

	if (membership.pendingDeletionAt) {
		throw new ApiKeyManagementAuthorizationError("frozen");
	}
}
