import { z } from "zod";

export type SafeUrlMode = "redirect" | "webhook";

export type SafeUrlReason =
  | "credentials_in_url"
  | "invalid_scheme"
  | "invalid_url"
  | "ipv4_literal_disallowed"
  | "ipv6_literal_disallowed"
  | "loopback_not_allowed";

export type SafeUrlOutcome =
  | { ok: true; url: URL }
  | { ok: false; reason: SafeUrlReason };

export interface ParseSafeUrlOptions {
  allowLoopback: boolean;
  mode: SafeUrlMode;
}

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
]);
const IPV4_LITERAL_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;

function hostnameLooksLikeIpv6(hostname: string): boolean {
  // WHATWG URL exposes IPv6 literals in `[bracketed]` form on the hostname.
  // Defensively also reject anything containing ':' since hostnames cannot
  // otherwise contain that character.
  return hostname.startsWith("[") || hostname.includes(":");
}

/**
 * Parses an externally-supplied URL and validates it against the allow-list
 * for either a session redirect target (`mode: "redirect"`) or an outbound
 * webhook URL (`mode: "webhook"`). Used as the single trust-boundary primitive
 * for any URL the API stores or hands to a browser sink.
 */
export function parseSafeUrl(
  input: string,
  opts: ParseSafeUrlOptions
): SafeUrlOutcome {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }

  const protocol = url.protocol;

  if (protocol === "https:") {
    // Allowed everywhere — fall through to mode-specific checks below.
  } else if (protocol === "http:") {
    if (!opts.allowLoopback) {
      return { ok: false, reason: "invalid_scheme" };
    }

    if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
      return { ok: false, reason: "loopback_not_allowed" };
    }
  } else {
    return { ok: false, reason: "invalid_scheme" };
  }

  if (opts.mode === "webhook") {
    // Webhooks must point at a public host. Loopback is only acceptable in
    // dev (the demo runner) — in strict mode we reject loopback regardless of
    // scheme, otherwise `https://localhost/` and `https://127.0.0.1/` slip
    // past the http-only loopback gate above.
    if (LOOPBACK_HOSTNAMES.has(url.hostname) && !opts.allowLoopback) {
      return { ok: false, reason: "loopback_not_allowed" };
    }

    if (IPV4_LITERAL_REGEX.test(url.hostname) && url.hostname !== "127.0.0.1") {
      return { ok: false, reason: "ipv4_literal_disallowed" };
    }

    if (hostnameLooksLikeIpv6(url.hostname)) {
      return { ok: false, reason: "ipv6_literal_disallowed" };
    }
  }

  return { ok: true, url };
}

const REDIRECT_URL_MESSAGE =
  "Must be an https:// URL with no embedded credentials.";
const WEBHOOK_URL_MESSAGE =
  "Must be an https:// URL pointing to a public host with no embedded credentials.";

/**
 * Zod schema for a session redirect URL. Accepts only `https://` (and
 * `http://localhost` / `http://127.0.0.1` when `allowLoopback`) and rejects
 * `javascript:`, `data:`, `file:`, `ftp:`, etc.
 */
export function safeRedirectUrl(opts: { allowLoopback: boolean }) {
  return z.string().refine(
    (input) =>
      parseSafeUrl(input, {
        allowLoopback: opts.allowLoopback,
        mode: "redirect",
      }).ok,
    { message: REDIRECT_URL_MESSAGE }
  );
}

/**
 * Zod schema for an outbound webhook URL. Same as `safeRedirectUrl` plus
 * rejects bare IPv4 literals (other than 127.0.0.1 in dev) and IPv6 literals
 * to avoid SSRF-style outbound abuse against link-local / private hosts.
 */
export function safeWebhookUrl(opts: { allowLoopback: boolean }) {
  return z.string().refine(
    (input) =>
      parseSafeUrl(input, {
        allowLoopback: opts.allowLoopback,
        mode: "webhook",
      }).ok,
    { message: WEBHOOK_URL_MESSAGE }
  );
}
