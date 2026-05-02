import { describe, expect, test } from "bun:test";
import {
  constantTimeStringEqual,
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
  test("matches every magic-link entry point so OTP brute-force is bounded", () => {
    expect(shouldRateLimitMagicPath("/magic/sign-in")).toBe(true);
    expect(shouldRateLimitMagicPath("/magic/verify-link")).toBe(true);
    expect(shouldRateLimitMagicPath("/magic/verify-otp")).toBe(true);
  });

  test("ignores unrelated auth endpoints", () => {
    expect(shouldRateLimitMagicPath("/session")).toBe(false);
  });
});

describe("constantTimeStringEqual", () => {
  test("matches identical strings", () => {
    expect(constantTimeStringEqual("123456", "123456")).toBe(true);
  });

  test("rejects mismatched strings of equal length", () => {
    expect(constantTimeStringEqual("123456", "654321")).toBe(false);
  });

  test("rejects strings of different length", () => {
    // Length mismatch is allowed to short-circuit because the OTP length is
    // configured publicly via `magic({ otpLength })`, not secret. The
    // constant-time guarantee only covers per-byte content comparison once
    // the lengths agree.
    expect(constantTimeStringEqual("123", "1234")).toBe(false);
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
