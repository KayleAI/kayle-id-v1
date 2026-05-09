export interface OrganizationMetadata {
  description?: null | string;
  website?: null | string;
}

export const ORGANIZATION_METADATA_ERROR_MESSAGE =
  "Organization metadata may only include string website and description fields.";

const ALLOWED_METADATA_KEYS = new Set(["description", "website"]);

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

export function normalizeOrganizationWebsiteUrl(
  value: unknown
): null | string | undefined {
  const website = normalizeNullableString(value);
  if (website === undefined || website === null) {
    return website;
  }

  let url: URL;
  try {
    url = new URL(website.trim());
  } catch {
    throw new OrganizationMetadataError(
      "Organization website must be a valid http:// or https:// URL without embedded credentials."
    );
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    throw new OrganizationMetadataError(
      "Organization website must be a valid http:// or https:// URL without embedded credentials."
    );
  }

  return url.toString();
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

  const website = normalizeOrganizationWebsiteUrl(value.website);
  if (website !== undefined) {
    metadata.website = website;
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

  if (parsedValue.website === null || typeof parsedValue.website === "string") {
    metadata.website = parsedValue.website;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}
