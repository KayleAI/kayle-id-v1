import { db } from "@kayle-id/database/drizzle";
import {
  auth_organization_members,
  auth_organizations,
} from "@kayle-id/database/schema/auth";
import { and, eq, exists, ne, not, sql } from "drizzle-orm";

export interface SoleOwnedOrganization {
  id: string;
  name: string;
  slug: string;
}

function memberHasOwnerRole() {
  return sql<boolean>`(',' || ${auth_organization_members.role} || ',') LIKE ${"%,owner,%"}`;
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
                memberHasOwnerRole()
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
                  memberHasOwnerRole()
                )
              )
          )
        )
      )
    );
}
