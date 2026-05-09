export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9-]+$/u;

export const ORGANIZATION_SLUG_ERROR_MESSAGE =
  "Organization slug must contain only lowercase letters, numbers, and hyphens.";

export class OrganizationSlugError extends Error {
  constructor(message = ORGANIZATION_SLUG_ERROR_MESSAGE) {
    super(message);
    this.name = "OrganizationSlugError";
  }
}

export function isOrganizationSlug(value: string): boolean {
  return value.length > 0 && ORGANIZATION_SLUG_PATTERN.test(value);
}

export function assertOrganizationSlug(
  value: unknown
): asserts value is string {
  if (typeof value !== "string" || !isOrganizationSlug(value)) {
    throw new OrganizationSlugError();
  }
}
