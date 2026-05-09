export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ORG_ROLE_SET_PATTERN_SOURCE = `^(${ORG_ROLES.join(
  "|"
)})(,(${ORG_ROLES.join("|")}))*$`;
export const OWNER_ROLE_SEGMENT_PATTERN_SOURCE = "(^|,)owner(,|$)";
export const ADMIN_ROLE_SEGMENT_PATTERN_SOURCE = "(^|,)admin(,|$)";
export const ORGANIZATION_ROLE_ERROR_MESSAGE =
  "Organization roles must be canonical comma-separated role names: owner, admin, or member.";

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 2,
  admin: 1,
  member: 0,
};

export class OrganizationRoleError extends Error {
  constructor(message = ORGANIZATION_ROLE_ERROR_MESSAGE) {
    super(message);
    this.name = "OrganizationRoleError";
  }
}

export function isOrgRole(value: unknown): value is OrgRole {
  return (
    typeof value === "string" &&
    (ORG_ROLES as readonly string[]).includes(value)
  );
}

function parseOrgRoles(value: string): OrgRole[] {
  const roles = value.split(",");
  if (roles.length === 0) {
    return [];
  }

  const parsed: OrgRole[] = [];
  const seen = new Set<OrgRole>();

  for (const role of roles) {
    if (role.length === 0 || role !== role.trim() || !isOrgRole(role)) {
      return [];
    }
    if (seen.has(role)) {
      return [];
    }
    seen.add(role);
    parsed.push(role);
  }

  return parsed;
}

export function hasOrgRole(actual: string, required: OrgRole): boolean {
  return parseOrgRoles(actual).some(
    (role) => ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[required]
  );
}

export function normalizeOrgRoleSet(value: unknown): string {
  if (typeof value !== "string") {
    throw new OrganizationRoleError();
  }

  const roles = parseOrgRoles(value);
  if (roles.length === 0 || roles.join(",") !== value) {
    throw new OrganizationRoleError();
  }

  return value;
}

/**
 * Scopes that may appear on a customer-facing API key. The platform UI seeds
 * new keys from this list, and any caller-provided scope list is validated
 * against it before a key is issued.
 */
export const CUSTOMER_API_KEY_SCOPES = [
  "webhooks:read",
  "webhooks:write",
  "sessions:read",
  "sessions:write",
  "analytics:read",
] as const;

export const API_KEY_SCOPES = [...CUSTOMER_API_KEY_SCOPES] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export type CustomerApiKeyScope = (typeof CUSTOMER_API_KEY_SCOPES)[number];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return (
    typeof value === "string" &&
    (API_KEY_SCOPES as readonly string[]).includes(value)
  );
}

export function isCustomerApiKeyScope(
  value: unknown
): value is CustomerApiKeyScope {
  return (
    typeof value === "string" &&
    (CUSTOMER_API_KEY_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * Minimum org role a session caller must hold to exercise each scope.
 * Reads require any org member; writes require admin or owner. Used by the
 * v1 scope middleware to mirror the API-key scope check for session callers
 * so dashboard requests are also gated by org role.
 */
export const SCOPE_REQUIRED_ROLE: Record<ApiKeyScope, OrgRole> = {
  "webhooks:read": "member",
  "webhooks:write": "admin",
  "sessions:read": "member",
  "sessions:write": "admin",
  "analytics:read": "member",
};
