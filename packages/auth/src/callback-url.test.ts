import { describe, expect, test } from "bun:test";
import { isSafeAuthCallbackPath } from "./callback-url";

describe("auth callback URL policy", () => {
  test("accepts same-site paths", () => {
    expect(isSafeAuthCallbackPath("/account")).toBe(true);
    expect(isSafeAuthCallbackPath("/dashboard?next=/settings")).toBe(true);
  });

  test("rejects absolute, protocol-relative, and scheme-like paths", () => {
    expect(isSafeAuthCallbackPath("https://evil.example")).toBe(false);
    expect(isSafeAuthCallbackPath("//evil.example/path")).toBe(false);
    expect(isSafeAuthCallbackPath("/\\evil.example/path")).toBe(false);
    expect(isSafeAuthCallbackPath("/javascript:alert(1)")).toBe(false);
  });
});
