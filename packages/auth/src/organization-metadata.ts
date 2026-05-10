export interface OrganizationMetadata {
  description?: null | string;
  privacyPolicyUrl?: null | string;
  termsOfServiceUrl?: null | string;
  website?: null | string;
}

export const ORGANIZATION_METADATA_ERROR_MESSAGE =
  "Organization metadata may only include string website, description, privacyPolicyUrl, and termsOfServiceUrl fields.";

const ALLOWED_METADATA_KEYS = new Set([
  "description",
  "privacyPolicyUrl",
  "termsOfServiceUrl",
  "website",
]);

const URL_VALIDATION_FIELDS: Array<{
  key: "website" | "privacyPolicyUrl" | "termsOfServiceUrl";
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
  const description = normalizeNullableString(value.description);
  if (description !== undefined) {
    metadata.description = description;
  }

  for (const { key, errorMessage } of URL_VALIDATION_FIELDS) {
    const url = normalizeHttpUrl(value[key], errorMessage);
    if (url !== undefined) {
      metadata[key] = url;
    }
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

  if (
    parsedValue.description === null ||
    typeof parsedValue.description === "string"
  ) {
    metadata.description = parsedValue.description;
  }

  for (const { key } of URL_VALIDATION_FIELDS) {
    const stored = parsedValue[key];
    if (stored === null || typeof stored === "string") {
      metadata[key] = stored;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}
