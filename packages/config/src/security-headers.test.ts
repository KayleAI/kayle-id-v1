import { describe, expect, test } from "bun:test";
import {
  applySecurityHeaders,
  getSecurityHeaderEntries,
  isHttpsRequest,
  withSecurityHeaders,
} from "./security-headers";

describe("getSecurityHeaderEntries", () => {
  test("returns the browser hardening headers", () => {
    expect(getSecurityHeaderEntries()).toEqual([
      [
        "Content-Security-Policy",
        "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
      ],
      [
        "Permissions-Policy",
        "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      ],
      ["Referrer-Policy", "strict-origin-when-cross-origin"],
      ["X-Content-Type-Options", "nosniff"],
      ["X-Frame-Options", "DENY"],
    ]);
  });

  test("adds HSTS only when requested", () => {
    expect(
      getSecurityHeaderEntries({ includeStrictTransportSecurity: true })[0]
    ).toEqual([
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    ]);
  });
});

describe("applySecurityHeaders", () => {
  test("sets the central header policy on a Headers object", () => {
    const headers = new Headers({
      "X-Frame-Options": "SAMEORIGIN",
    });

    applySecurityHeaders(headers, { includeStrictTransportSecurity: true });

    expect(headers.get("Content-Security-Policy")).toBe(
      "base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    );
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("withSecurityHeaders", () => {
  test("returns a response with the central header policy applied", async () => {
    const response = withSecurityHeaders(new Response("ok"), {
      includeStrictTransportSecurity: true,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("isHttpsRequest", () => {
  test("detects HTTPS request URLs", () => {
    expect(isHttpsRequest(new Request("https://kayle.id"))).toBe(true);
    expect(isHttpsRequest(new Request("http://127.0.0.1:3000"))).toBe(false);
  });
});
