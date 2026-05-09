import { describe, expect, test } from "bun:test";
import {
  CLIENT_IP_SOURCE_HEADERS,
  FORWARDED_CLIENT_IP_HEADER,
  getForwardedClientIp,
  TRUSTED_CLIENT_IP_HEADERS,
} from "./client-ip";

describe("getForwardedClientIp", () => {
  test("uses Cloudflare connecting IP before other forwarded headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20",
      "x-real-ip": "198.51.100.30",
    });

    expect(getForwardedClientIp(headers)).toBe("203.0.113.10");
  });

  test("ignores x-real-ip when Cloudflare metadata is missing", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.20",
      "x-real-ip": "198.51.100.30",
    });

    expect(getForwardedClientIp(headers)).toBeUndefined();
  });

  test("ignores x-forwarded-for when Cloudflare metadata is missing", () => {
    const headers = new Headers({
      "x-forwarded-for": " , 198.51.100.20, 198.51.100.21",
    });

    expect(getForwardedClientIp(headers)).toBeUndefined();
  });

  test("returns undefined when no usable client IP header exists", () => {
    const headers = new Headers({
      "x-forwarded-for": " , ",
    });

    expect(getForwardedClientIp(headers)).toBeUndefined();
  });
});

describe("client IP header constants", () => {
  test("internal API only trusts the proxy-derived header, not raw upstream sources", () => {
    expect(TRUSTED_CLIENT_IP_HEADERS).toEqual([FORWARDED_CLIENT_IP_HEADER]);

    for (const sourceHeader of CLIENT_IP_SOURCE_HEADERS) {
      expect(TRUSTED_CLIENT_IP_HEADERS).not.toContain(sourceHeader);
    }
  });
});
