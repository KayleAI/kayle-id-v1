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

export function hasOrgRole(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_RANK[actual] >= ORG_ROLE_RANK[required];
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

/**
 * Scopes reserved for the platform's own internal API key. The platform uses
 * `org_verifications:write` to create verification sessions tagged with
 * `owner_verification_org_id` so the share-completion path can flip another
 * org's `verified_at`. Customer-facing keys must never carry these.
 */
export const PLATFORM_ONLY_SCOPES = ["org_verifications:write"] as const;

export const API_KEY_SCOPES = [
  ...CUSTOMER_API_KEY_SCOPES,
  ...PLATFORM_ONLY_SCOPES,
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export type CustomerApiKeyScope = (typeof CUSTOMER_API_KEY_SCOPES)[number];
export type PlatformOnlyScope = (typeof PLATFORM_ONLY_SCOPES)[number];

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

export function isPlatformOnlyScope(
  value: unknown
): value is PlatformOnlyScope {
  return (
    typeof value === "string" &&
    (PLATFORM_ONLY_SCOPES as readonly string[]).includes(value)
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
  // Owner-only on the dashboard side; the scope itself only makes sense for
  // the platform's internal API key, but if a session caller ever exercises
  // it, require the strongest org role.
  "org_verifications:write": "owner",
};
