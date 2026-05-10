import { db } from "@kayle-id/database/drizzle";
import {
  auth_organization_members,
  auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, exists, isNull, ne, not, sql } from "drizzle-orm";
import { memberHasOwnerRoleSql } from "./organization-role-sql";

export interface SoleOwnedOrganization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Returns the organisations where `userId` is the only `owner`-role member.
 *
 * Used both by the account-deletion `beforeDelete` hook (to cascade-delete
 * those orgs) and by the platform UI (to surface the impact in the delete
 * confirmation dialog). An org with co-owners is excluded — those orgs
 * survive the user's deletion because the remaining owners keep control.
 */
export async function findSoleOwnedOrganizations(
  userId: string
): Promise<SoleOwnedOrganization[]> {
  return await db
    .select({
      id: auth_organizations.id,
      name: auth_organizations.name,
      slug: auth_organizations.slug,
    })
    .from(auth_organizations)
    .where(
      and(
        // Active owners only — suspended members do not satisfy ownership.
        exists(
          db
            .select({ presence: sql`1` })
            .from(auth_organization_members)
            .where(
              and(
                eq(
                  auth_organization_members.organizationId,
                  auth_organizations.id
                ),
                eq(auth_organization_members.userId, userId),
                isNull(auth_organization_members.suspendedAt),
                memberHasOwnerRoleSql()
              )
            )
        ),
        not(
          exists(
            db
              .select({ presence: sql`1` })
              .from(auth_organization_members)
              .where(
                and(
                  eq(
                    auth_organization_members.organizationId,
                    auth_organizations.id
                  ),
                  ne(auth_organization_members.userId, userId),
                  isNull(auth_organization_members.suspendedAt),
                  memberHasOwnerRoleSql()
                )
              )
          )
        )
      )
    );
}
