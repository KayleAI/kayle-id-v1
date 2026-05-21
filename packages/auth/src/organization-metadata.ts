export interface OrganizationMetadata {
  appealUrl?: null | string;
  article6Basis?: null | string;
  article9Condition?: null | string;
  complaintsUrl?: null | string;
  controllerJurisdiction?: null | string;
  description?: null | string;
  fallbackIdvUrl?: null | string;
  legalControllerName?: null | string;
  privacyPolicyUrl?: null | string;
  supportEmail?: null | string;
  termsOfServiceUrl?: null | string;
  usesKayleForConsequentialDecisions?: boolean | null;
  website?: null | string;
}

export const ORGANIZATION_METADATA_ERROR_MESSAGE =
  "Organization metadata may only include supported public profile and RP compliance fields.";

const ALLOWED_METADATA_KEYS = new Set([
  "article6Basis",
  "article9Condition",
  "appealUrl",
  "complaintsUrl",
  "controllerJurisdiction",
  "description",
  "fallbackIdvUrl",
  "legalControllerName",
  "privacyPolicyUrl",
  "supportEmail",
  "termsOfServiceUrl",
  "usesKayleForConsequentialDecisions",
  "website",
]);

const URL_VALIDATION_FIELDS: Array<{
  key:
    | "appealUrl"
    | "complaintsUrl"
    | "fallbackIdvUrl"
    | "privacyPolicyUrl"
    | "termsOfServiceUrl"
    | "website";
  errorMessage: string;
}> = [
  {
    key: "website",
    errorMessage:
      "Organization website must be a valid http:// or https:// URL without embedded credentials.",
  },
  {
    key: "privacyPolicyUrl",
    errorMessage:
      "Privacy policy link must be a valid http:// or https:// URL without embedded credentials.",
  },
  {
    key: "termsOfServiceUrl",
    errorMessage:
      "Terms of service link must be a valid http:// or https:// URL without embedded credentials.",
  },
  {
    key: "fallbackIdvUrl",
    errorMessage:
      "Fallback IDV link must be a valid http:// or https:// URL without embedded credentials.",
  },
  {
    key: "appealUrl",
    errorMessage:
      "Appeal or human review link must be a valid http:// or https:// URL without embedded credentials.",
  },
  {
    key: "complaintsUrl",
    errorMessage:
      "Complaints link must be a valid http:// or https:// URL without embedded credentials.",
  },
];

const SUPPORT_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

const STRING_METADATA_KEYS: Array<
  keyof Pick<
    OrganizationMetadata,
    | "article6Basis"
    | "article9Condition"
    | "controllerJurisdiction"
    | "description"
    | "legalControllerName"
  >
> = [
  "article6Basis",
  "article9Condition",
  "controllerJurisdiction",
  "description",
  "legalControllerName",
];

export class OrganizationMetadataError extends Error {
  constructor(message = ORGANIZATION_METADATA_ERROR_MESSAGE) {
    super(message);
    this.name = "OrganizationMetadataError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeNullableString(value: unknown): null | string | undefined {
  if (value === undefined) {
    return;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new OrganizationMetadataError();
  }

  return value;
}

function normalizeNullableBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new OrganizationMetadataError();
  }

  return value;
}

function normalizeHttpUrl(
  value: unknown,
  errorMessage: string
): null | string | undefined {
  const raw = normalizeNullableString(value);
  if (raw === undefined || raw === null) {
    return raw;
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OrganizationMetadataError(errorMessage);
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    throw new OrganizationMetadataError(errorMessage);
  }

  return url.toString();
}

function normalizeSupportEmail(value: unknown): null | string | undefined {
  const raw = normalizeNullableString(value);
  if (raw === undefined || raw === null) {
    return raw;
  }

  const email = raw.trim().toLowerCase();
  if (
    email.length > 254 ||
    email.includes(" ") ||
    !SUPPORT_EMAIL_PATTERN.test(email)
  ) {
    throw new OrganizationMetadataError(
      "Support email must be a valid email address."
    );
  }

  return email;
}

export function normalizeOrganizationWebsiteUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Organization website must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationPrivacyPolicyUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Privacy policy link must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationTermsOfServiceUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Terms of service link must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationFallbackIdvUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Fallback IDV link must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationAppealUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Appeal or human review link must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationComplaintsUrl(
  value: unknown
): null | string | undefined {
  return normalizeHttpUrl(
    value,
    "Complaints link must be a valid http:// or https:// URL without embedded credentials."
  );
}

export function normalizeOrganizationSupportEmail(
  value: unknown
): null | string | undefined {
  return normalizeSupportEmail(value);
}

export function normalizeOrganizationMetadata(
  value: unknown
): OrganizationMetadata | undefined {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    throw new OrganizationMetadataError();
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      throw new OrganizationMetadataError();
    }
  }

  const metadata: OrganizationMetadata = {};
  for (const key of STRING_METADATA_KEYS) {
    const fieldValue = normalizeNullableString(value[key]);
    if (fieldValue !== undefined) {
      metadata[key] = fieldValue;
    }
  }

  for (const { key, errorMessage } of URL_VALIDATION_FIELDS) {
    const url = normalizeHttpUrl(value[key], errorMessage);
    if (url !== undefined) {
      metadata[key] = url;
    }
  }

  const supportEmail = normalizeSupportEmail(value.supportEmail);
  if (supportEmail !== undefined) {
    metadata.supportEmail = supportEmail;
  }

  const usesKayleForConsequentialDecisions = normalizeNullableBoolean(
    value.usesKayleForConsequentialDecisions
  );
  if (usesKayleForConsequentialDecisions !== undefined) {
    metadata.usesKayleForConsequentialDecisions =
      usesKayleForConsequentialDecisions;
  }

  return metadata;
}

export function parseStoredOrganizationMetadata(
  value: unknown
): OrganizationMetadata | null {
  const parsedValue =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;

  if (!isRecord(parsedValue)) {
    return null;
  }

  const metadata: OrganizationMetadata = {};

  for (const key of STRING_METADATA_KEYS) {
    const stored = parsedValue[key];
    if (stored === null || typeof stored === "string") {
      metadata[key] = stored;
    }
  }

  for (const { key } of URL_VALIDATION_FIELDS) {
    const stored = parsedValue[key];
    if (stored === null || typeof stored === "string") {
      metadata[key] = stored;
    }
  }

  const storedSupportEmail = parsedValue.supportEmail;
  if (storedSupportEmail === null || typeof storedSupportEmail === "string") {
    metadata.supportEmail = storedSupportEmail;
  }

  const storedConsequentialUse = parsedValue.usesKayleForConsequentialDecisions;
  if (
    storedConsequentialUse === null ||
    typeof storedConsequentialUse === "boolean"
  ) {
    metadata.usesKayleForConsequentialDecisions = storedConsequentialUse;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

export interface OrganizationComplianceProfileStatus {
  complete: boolean;
  hasFallbackPath: boolean;
  hasNonConsequentialUseDeclaration: boolean;
  missingFields: string[];
}

export function getOrganizationComplianceProfileStatus(
  metadata: OrganizationMetadata | null | undefined
): OrganizationComplianceProfileStatus {
  const missingFields: string[] = [];

  const requireString = (key: keyof OrganizationMetadata): void => {
    const value = metadata?.[key];
    if (!(typeof value === "string" && value.trim().length > 0)) {
      missingFields.push(key);
    }
  };

  requireString("legalControllerName");
  requireString("controllerJurisdiction");
  requireString("privacyPolicyUrl");
  requireString("supportEmail");
  requireString("article6Basis");
  requireString("article9Condition");

  const hasFallbackPath = Boolean(metadata?.fallbackIdvUrl);
  const hasReviewPath = Boolean(metadata?.appealUrl);
  const hasNonConsequentialUseDeclaration =
    metadata?.usesKayleForConsequentialDecisions === false;
  const hasConsequentialUseDeclaration =
    metadata?.usesKayleForConsequentialDecisions === true;

  if (!(hasNonConsequentialUseDeclaration || hasConsequentialUseDeclaration)) {
    missingFields.push("usesKayleForConsequentialDecisions");
  }

  if (hasConsequentialUseDeclaration) {
    if (!hasFallbackPath) {
      missingFields.push("fallbackIdvUrl");
    }
    if (!hasReviewPath) {
      missingFields.push("appealUrl");
    }
  }

  return {
    complete: missingFields.length === 0,
    hasFallbackPath,
    hasNonConsequentialUseDeclaration,
    missingFields,
  };
}
