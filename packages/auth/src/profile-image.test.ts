import { describe, expect, test } from "bun:test";
import {
  isAllowedProfileImageMime,
  MAX_PROFILE_IMAGE_BYTES,
  normalizeProfileImage,
  ProfileImageError,
} from "./profile-image";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("profile image policy", () => {
  test("accepts bounded local image data URLs", () => {
    expect(isAllowedProfileImageMime("image/png")).toBe(true);
    expect(isAllowedProfileImageMime("IMAGE/PNG")).toBe(true);
    expect(normalizeProfileImage(PNG_DATA_URL)).toBe(PNG_DATA_URL);
  });

  test("normalizes empty image values to null", () => {
    expect(normalizeProfileImage("")).toBeNull();
    expect(normalizeProfileImage(null)).toBeNull();
    expect(normalizeProfileImage(undefined)).toBeUndefined();
  });

  test("rejects external URLs and unsupported image types", () => {
    expect(() =>
      normalizeProfileImage("https://example.com/avatar.png")
    ).toThrow(ProfileImageError);
    expect(() =>
      normalizeProfileImage("data:image/svg+xml;base64,PHN2Zy8+")
    ).toThrow(ProfileImageError);
  });

  test("rejects images over the profile byte limit", () => {
    const oversizedBase64 = "A".repeat(
      Math.ceil((MAX_PROFILE_IMAGE_BYTES + 1) / 3) * 4
    );

    expect(() =>
      normalizeProfileImage(`data:image/png;base64,${oversizedBase64}`)
    ).toThrow(ProfileImageError);
  });
});
