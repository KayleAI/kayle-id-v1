export const ALLOWED_PROFILE_IMAGE_MIME = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_PROFILE_IMAGE_BYTES = 1024 * 1024;

export const PROFILE_IMAGE_ERROR_MESSAGE =
  "Profile image must be an uploaded PNG, JPEG, GIF, or WebP image under 1 MiB.";

const PROFILE_IMAGE_DATA_URL_PATTERN =
  /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u;

export class ProfileImageError extends Error {
  constructor(message = PROFILE_IMAGE_ERROR_MESSAGE) {
    super(message);
    this.name = "ProfileImageError";
  }
}

export function isAllowedProfileImageMime(value: string): boolean {
  return ALLOWED_PROFILE_IMAGE_MIME.includes(
    value.toLowerCase() as (typeof ALLOWED_PROFILE_IMAGE_MIME)[number]
  );
}

function getBase64DecodedLength(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw new ProfileImageError();
  }

  let padding = 0;
  if (value.endsWith("==")) {
    padding = 2;
  } else if (value.endsWith("=")) {
    padding = 1;
  }

  return (value.length / 4) * 3 - padding;
}

export function normalizeProfileImage(
  value: unknown
): null | string | undefined {
  if (value === undefined) {
    return;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ProfileImageError();
  }

  const match = PROFILE_IMAGE_DATA_URL_PATTERN.exec(value);
  const mimeType = match?.[1]?.toLowerCase();
  const base64 = match?.[2];
  if (!(mimeType && base64 && isAllowedProfileImageMime(mimeType))) {
    throw new ProfileImageError();
  }

  if (getBase64DecodedLength(base64) > MAX_PROFILE_IMAGE_BYTES) {
    throw new ProfileImageError();
  }

  return value;
}
