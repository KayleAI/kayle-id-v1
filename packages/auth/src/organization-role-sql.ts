import { auth_organization_members } from "@kayle-id/database/schema/auth";
import { sql } from "drizzle-orm";
import {
  ADMIN_ROLE_SEGMENT_PATTERN_SOURCE,
  ORG_ROLE_SET_PATTERN_SOURCE,
  OWNER_ROLE_SEGMENT_PATTERN_SOURCE,
} from "./permissions";

export function memberHasOwnerRoleSql() {
  return sql<boolean>`${auth_organization_members.role} ~ ${ORG_ROLE_SET_PATTERN_SOURCE} AND ${auth_organization_members.role} ~ ${OWNER_ROLE_SEGMENT_PATTERN_SOURCE}`;
}

export function memberHasAdminOrOwnerRoleSql() {
  return sql<boolean>`${auth_organization_members.role} ~ ${ORG_ROLE_SET_PATTERN_SOURCE} AND (${auth_organization_members.role} ~ ${ADMIN_ROLE_SEGMENT_PATTERN_SOURCE} OR ${auth_organization_members.role} ~ ${OWNER_ROLE_SEGMENT_PATTERN_SOURCE})`;
}
