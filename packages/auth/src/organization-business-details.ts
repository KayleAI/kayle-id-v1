/**
 * Validators for the self-asserted business details an org owner can set on
 * the **Public details** page: legal name, registered jurisdiction, and
 * registration number. These render in the verify-flow "About" dialog
 * alongside the verified-domain badge — they're hidden entirely from end
 * users until the org has at least one verified domain, so the only trust
 * boundary they need to clear here is "fits in the column and doesn't
 * contain control characters that could mangle the dialog or hide content".
 */

import { hasOrganizationNameControlCharacter } from "./organization-name";

export const ORGANIZATION_BUSINESS_TYPES = ["sole", "business"] as const;
export type OrganizationBusinessType =
  (typeof ORGANIZATION_BUSINESS_TYPES)[number];

export function isOrganizationBusinessType(
  value: unknown
): value is OrganizationBusinessType {
  return (
    typeof value === "string" &&
    (ORGANIZATION_BUSINESS_TYPES as readonly string[]).includes(value)
  );
}

export const ORGANIZATION_BUSINESS_NAME_MAX_LENGTH = 200;
export const ORGANIZATION_BUSINESS_JURISDICTION_MAX_LENGTH = 120;
export const ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_MAX_LENGTH = 100;

export const ORGANIZATION_BUSINESS_NAME_ERROR_MESSAGE =
  "Legal name must be between 1 and 200 characters and cannot contain control characters.";
export const ORGANIZATION_BUSINESS_JURISDICTION_ERROR_MESSAGE =
  "Jurisdiction must be between 1 and 120 characters and cannot contain control characters.";
export const ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_ERROR_MESSAGE =
  "Registration number must be between 1 and 100 characters and cannot contain control characters.";

export class OrganizationBusinessDetailsError extends Error {
  field:
    | "businessType"
    | "businessName"
    | "businessJurisdiction"
    | "businessRegistrationNumber";
  constructor(
    field: OrganizationBusinessDetailsError["field"],
    message: string
  ) {
    super(message);
    this.field = field;
    this.name = "OrganizationBusinessDetailsError";
  }
}

/**
 * `null` clears the column (org type unspecified); `undefined` leaves it
 * untouched. Anything other than the canonical enum values throws.
 */
export function normalizeOrganizationBusinessType(
  value: unknown
): OrganizationBusinessType | null | undefined {
  if (value === undefined) {
    return;
  }
  if (value === null || value === "") {
    return null;
  }
  if (!isOrganizationBusinessType(value)) {
    throw new OrganizationBusinessDetailsError(
      "businessType",
      `Business type must be one of: ${ORGANIZATION_BUSINESS_TYPES.join(", ")}.`
    );
  }
  return value;
}

/**
 * Normalize an editable business-details field. `value` may be:
 * - `undefined`: the caller didn't include this field — return `undefined`
 *   so the SQL UPDATE leaves it untouched.
 * - `null` or empty string: the caller wants to clear it — return `null`.
 * - A non-empty string: trim, validate, return the trimmed value.
 *
 * Throws `OrganizationBusinessDetailsError` if the value violates the
 * length or control-character rules.
 */
function normalizeOptionalField(
  field: OrganizationBusinessDetailsError["field"],
  value: unknown,
  maxLength: number,
  errorMessage: string
): string | null | undefined {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new OrganizationBusinessDetailsError(field, errorMessage);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (
    trimmed.length > maxLength ||
    hasOrganizationNameControlCharacter(trimmed)
  ) {
    throw new OrganizationBusinessDetailsError(field, errorMessage);
  }
  return trimmed;
}

export function normalizeOrganizationBusinessName(
  value: unknown
): string | null | undefined {
  return normalizeOptionalField(
    "businessName",
    value,
    ORGANIZATION_BUSINESS_NAME_MAX_LENGTH,
    ORGANIZATION_BUSINESS_NAME_ERROR_MESSAGE
  );
}

export function normalizeOrganizationBusinessJurisdiction(
  value: unknown
): string | null | undefined {
  return normalizeOptionalField(
    "businessJurisdiction",
    value,
    ORGANIZATION_BUSINESS_JURISDICTION_MAX_LENGTH,
    ORGANIZATION_BUSINESS_JURISDICTION_ERROR_MESSAGE
  );
}

export function normalizeOrganizationBusinessRegistrationNumber(
  value: unknown
): string | null | undefined {
  return normalizeOptionalField(
    "businessRegistrationNumber",
    value,
    ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_MAX_LENGTH,
    ORGANIZATION_BUSINESS_REGISTRATION_NUMBER_ERROR_MESSAGE
  );
}
