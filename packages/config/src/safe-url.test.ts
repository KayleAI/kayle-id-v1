import { describe, expect, test } from "bun:test";
import { parseSafeUrl } from "./safe-url";

describe("parseSafeUrl redirect mode", () => {
  const redirectStrict = { allowLoopback: false, mode: "redirect" } as const;
  const redirectDev = { allowLoopback: true, mode: "redirect" } as const;

  test("accepts https URLs", () => {
    expect(parseSafeUrl("https://example.com/return", redirectStrict).ok).toBe(
      true
    );
  });

  test("rejects http URLs in production mode", () => {
    expect(
      parseSafeUrl("http://example.com/return", redirectStrict)
    ).toMatchObject({ ok: false, reason: "invalid_scheme" });
  });

  test("accepts http://localhost only when loopback is allowed", () => {
    expect(parseSafeUrl("http://localhost:3000/", redirectDev).ok).toBe(true);
    expect(parseSafeUrl("http://127.0.0.1:3000/", redirectDev).ok).toBe(true);
  });

  test("rejects http to non-loopback hosts even when loopback is allowed", () => {
    expect(
      parseSafeUrl("http://example.com/return", redirectDev)
    ).toMatchObject({ ok: false, reason: "loopback_not_allowed" });
  });

  test("rejects javascript: scheme", () => {
    expect(parseSafeUrl("javascript:alert(1)", redirectStrict)).toMatchObject({
      ok: false,
      reason: "invalid_scheme",
    });
  });

  test("rejects data: scheme", () => {
    expect(
      parseSafeUrl("data:text/html,<script>alert(1)</script>", redirectStrict)
    ).toMatchObject({ ok: false, reason: "invalid_scheme" });
  });

  test("rejects file: scheme", () => {
    expect(parseSafeUrl("file:///etc/passwd", redirectStrict)).toMatchObject({
      ok: false,
      reason: "invalid_scheme",
    });
  });

  test("rejects ftp: scheme", () => {
    expect(
      parseSafeUrl("ftp://example.com/file", redirectStrict)
    ).toMatchObject({ ok: false, reason: "invalid_scheme" });
  });

  test("rejects URLs with embedded credentials", () => {
    expect(
      parseSafeUrl("https://user:pw@example.com/", redirectStrict)
    ).toMatchObject({ ok: false, reason: "credentials_in_url" });
  });

  test("rejects malformed URLs", () => {
    expect(parseSafeUrl("not a url", redirectStrict)).toMatchObject({
      ok: false,
      reason: "invalid_url",
    });
    expect(parseSafeUrl("", redirectStrict)).toMatchObject({
      ok: false,
      reason: "invalid_url",
    });
  });
});

describe("parseSafeUrl webhook mode", () => {
  const webhookStrict = { allowLoopback: false, mode: "webhook" } as const;
  const webhookDev = { allowLoopback: true, mode: "webhook" } as const;

  test("accepts https URLs to public hosts", () => {
    expect(
      parseSafeUrl("https://hooks.example.com/v1/kayle", webhookStrict).ok
    ).toBe(true);
  });

  test("rejects bare IPv4 literals other than loopback", () => {
    expect(parseSafeUrl("https://10.0.0.1/", webhookStrict)).toMatchObject({
      ok: false,
      reason: "ipv4_literal_disallowed",
    });
    expect(parseSafeUrl("https://192.168.1.1/", webhookStrict)).toMatchObject({
      ok: false,
      reason: "ipv4_literal_disallowed",
    });
    expect(
      parseSafeUrl("https://169.254.169.254/", webhookStrict)
    ).toMatchObject({
      ok: false,
      reason: "ipv4_literal_disallowed",
    });
  });

  test("rejects IPv6 literals", () => {
    expect(parseSafeUrl("https://[::1]/", webhookStrict)).toMatchObject({
      ok: false,
      reason: "ipv6_literal_disallowed",
    });
    expect(parseSafeUrl("https://[fe80::1]/", webhookStrict)).toMatchObject({
      ok: false,
      reason: "ipv6_literal_disallowed",
    });
  });

  test("accepts http://127.0.0.1 demo loopback when allowed", () => {
    expect(parseSafeUrl("http://127.0.0.1:3001/hooks", webhookDev).ok).toBe(
      true
    );
  });

  test("rejects http://127.0.0.1 in strict (production) mode", () => {
    expect(
      parseSafeUrl("http://127.0.0.1:3001/hooks", webhookStrict)
    ).toMatchObject({ ok: false, reason: "invalid_scheme" });
  });

  test("rejects https://127.0.0.1 in strict (production) mode", () => {
    expect(
      parseSafeUrl("https://127.0.0.1/hooks", webhookStrict)
    ).toMatchObject({
      ok: false,
      reason: "loopback_not_allowed",
    });
  });

  test("rejects https://localhost in strict (production) mode", () => {
    expect(
      parseSafeUrl("https://localhost:3001/hooks", webhookStrict)
    ).toMatchObject({ ok: false, reason: "loopback_not_allowed" });
  });

  test("accepts https://localhost when loopback is allowed", () => {
    expect(parseSafeUrl("https://localhost:3001/hooks", webhookDev).ok).toBe(
      true
    );
  });
});
