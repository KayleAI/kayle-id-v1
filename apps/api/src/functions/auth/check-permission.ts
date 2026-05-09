import { db } from "@kayle-id/database/drizzle";
import { auth_organization_members } from "@kayle-id/database/schema/auth";
import { and, eq } from "drizzle-orm";
import { hasOrgRole, type OrgRole } from "@/auth/permissions";

/**
 * Returns true when `userId` is a member of `organizationId` whose stored role
 * meets or exceeds `requiredRole` per the owner > admin > member ordering.
 *
 * An unrecognized stored role is treated as below all known roles (deny).
 */
export async function checkPermission(
	userId: string,
	organizationId: string,
	requiredRole: OrgRole = "member",
): Promise<boolean> {
	const [member] = await db
		.select({ role: auth_organization_members.role })
		.from(auth_organization_members)
		.where(
			and(
				eq(auth_organization_members.userId, userId),
				eq(auth_organization_members.organizationId, organizationId),
			),
		)
		.limit(1);

	if (!member) {
		return false;
	}

	return hasOrgRole(member.role, requiredRole);
}
