import { describe, expect, test } from "bun:test";
import {
  createMagicVerifyLinkUrl,
  parseMagicLinkTokenValue,
  shouldRateLimitMagicPath,
} from "./index";

describe("parseMagicLinkTokenValue", () => {
  test("returns a typed magic-link payload", () => {
    expect(
      parseMagicLinkTokenValue(
        JSON.stringify({
          email: "test@kayle.id",
          type: "sign-in",
        })
      )
    ).toEqual({
      email: "test@kayle.id",
      type: "sign-in",
    });
  });

  test("rejects malformed token JSON", () => {
    expect(() => parseMagicLinkTokenValue("not-json")).toThrow(
      "Your link is invalid or has expired. Please try again."
    );
  });

  test("rejects invalid token shapes", () => {
    expect(() =>
      parseMagicLinkTokenValue(
        JSON.stringify({
          email: "not-an-email",
          type: "sign-in",
        })
      )
    ).toThrow("Your link is invalid or has expired. Please try again.");
  });
});

describe("shouldRateLimitMagicPath", () => {
  test("matches sign-in and verify-link endpoints", () => {
    expect(shouldRateLimitMagicPath("/magic/sign-in")).toBe(true);
    expect(shouldRateLimitMagicPath("/magic/verify-link")).toBe(true);
  });

  test("ignores unrelated auth endpoints", () => {
    expect(shouldRateLimitMagicPath("/magic/verify-otp")).toBe(false);
    expect(shouldRateLimitMagicPath("/session")).toBe(false);
  });
});

describe("createMagicVerifyLinkUrl", () => {
  test("preserves the auth base path and encodes query values", () => {
    expect(
      createMagicVerifyLinkUrl({
        baseURL: "https://kayle.id/api/auth",
        callbackURL: "/dashboard?next=/settings&from=email",
        token: "token+with/symbols",
      })
    ).toBe(
      "https://kayle.id/api/auth/magic/verify-link?token=token%2Bwith%2Fsymbols&callbackURL=%2Fdashboard%3Fnext%3D%2Fsettings%26from%3Demail"
    );
  });
});
