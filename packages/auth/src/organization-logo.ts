const LOCAL_LOGO_ORIGIN = "http://127.0.0.1:8787";
const PRODUCTION_LOGO_ORIGIN = "https://cdn.kayle.id";
const LOGO_KEY_UUID_PATTERN =
  /^logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LOCAL_R2_PATH_PREFIX_PATTERN = /^\/r2\//u;

export const ORGANIZATION_LOGO_KEY_PREFIX = "logos/";

export class OrganizationLogoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationLogoUrlError";
  }
}

export function createOrganizationLogoUrl(key: string): string {
  if (!LOGO_KEY_UUID_PATTERN.test(key)) {
    throw new OrganizationLogoUrlError(
      "Organization logo key must be a generated logo key."
    );
  }

  return process.env.NODE_ENV === "production"
    ? `${PRODUCTION_LOGO_ORIGIN}/${key}`
    : `${LOCAL_LOGO_ORIGIN}/r2/${key}`;
}

export function isStoredOrganizationLogoUrl(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.search || url.hash) {
    return false;
  }

  if (url.origin === PRODUCTION_LOGO_ORIGIN) {
    return LOGO_KEY_UUID_PATTERN.test(url.pathname.slice(1));
  }

  if (
    process.env.NODE_ENV !== "production" &&
    url.origin === LOCAL_LOGO_ORIGIN
  ) {
    const key = url.pathname.replace(LOCAL_R2_PATH_PREFIX_PATTERN, "");
    return LOGO_KEY_UUID_PATTERN.test(key);
  }

  return false;
}

export function normalizeStoredOrganizationLogoUrl(
  value: unknown
): null | string | undefined {
  if (value === undefined) {
    return;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !isStoredOrganizationLogoUrl(value)) {
    throw new OrganizationLogoUrlError(
      "Organization logo must be uploaded through the logo endpoint."
    );
  }

  return value;
}
