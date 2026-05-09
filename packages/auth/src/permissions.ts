export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 2,
  admin: 1,
  member: 0,
};

export function isOrgRole(value: unknown): value is OrgRole {
  return (
    typeof value === "string" &&
    (ORG_ROLES as readonly string[]).includes(value)
  );
}

function parseOrgRoles(value: string): OrgRole[] {
  return value
    .split(",")
    .map((role) => role.trim())
    .filter(isOrgRole);
}

export function hasOrgRole(actual: string, required: OrgRole): boolean {
  return parseOrgRoles(actual).some(
    (role) => ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[required]
  );
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
