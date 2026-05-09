import { z } from "zod";

export type SafeUrlMode = "redirect" | "webhook";

export type SafeUrlReason =
  | "credentials_in_url"
  | "invalid_scheme"
  | "invalid_url"
  | "ipv4_literal_disallowed"
  | "ipv6_literal_disallowed"
  | "loopback_not_allowed"
  | "reserved_hostname_disallowed"
  | "url_too_long";

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
const RESERVED_WEBHOOK_HOSTNAME_SUFFIXES = [
  ".home.arpa",
  ".internal",
  ".lan",
  ".local",
  ".localdomain",
  ".localhost",
] as const;
const IPV4_LITERAL_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;
export const SAFE_URL_MAX_LENGTH = 2048;

function normalizeHostname(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function hostnameLooksLikeIpv6(hostname: string): boolean {
  // WHATWG URL exposes IPv6 literals in `[bracketed]` form on the hostname.
  // Defensively also reject anything containing ':' since hostnames cannot
  // otherwise contain that character.
  return hostname.startsWith("[") || hostname.includes(":");
}

function isReservedWebhookHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname).toLowerCase();

  if (!normalizedHostname.includes(".")) {
    return true;
  }

  return RESERVED_WEBHOOK_HOSTNAME_SUFFIXES.some((suffix) =>
    normalizedHostname.endsWith(suffix)
  );
}

function validateSafeUrlProtocol(
  url: URL,
  opts: { allowLoopback: boolean }
): SafeUrlReason | null {
  if (url.protocol === "https:") {
    return null;
  }

  if (url.protocol !== "http:") {
    return "invalid_scheme";
  }

  if (!opts.allowLoopback) {
    return "invalid_scheme";
  }

  if (!isLoopbackHostname(url.hostname)) {
    return "loopback_not_allowed";
  }

  return null;
}

function validateWebhookHostname(
  url: URL,
  opts: { allowLoopback: boolean }
): SafeUrlReason | null {
  if (isLoopbackHostname(url.hostname) && !opts.allowLoopback) {
    return "loopback_not_allowed";
  }

  const normalizedHostname = normalizeHostname(url.hostname);
  if (
    IPV4_LITERAL_REGEX.test(normalizedHostname) &&
    normalizedHostname !== "127.0.0.1"
  ) {
    return "ipv4_literal_disallowed";
  }

  if (hostnameLooksLikeIpv6(url.hostname)) {
    return "ipv6_literal_disallowed";
  }

  if (
    !(opts.allowLoopback && isLoopbackHostname(url.hostname)) &&
    isReservedWebhookHostname(url.hostname)
  ) {
    return "reserved_hostname_disallowed";
  }

  return null;
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

  if (input.length > SAFE_URL_MAX_LENGTH) {
    return { ok: false, reason: "url_too_long" };
  }

  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }

  const protocolReason = validateSafeUrlProtocol(url, opts);
  if (protocolReason) {
    return { ok: false, reason: protocolReason };
  }

  if (opts.mode === "webhook") {
    const webhookReason = validateWebhookHostname(url, opts);
    if (webhookReason) {
      return { ok: false, reason: webhookReason };
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
  return z
    .string()
    .max(SAFE_URL_MAX_LENGTH)
    .refine(
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
  return z
    .string()
    .max(SAFE_URL_MAX_LENGTH)
    .refine(
      (input) =>
        parseSafeUrl(input, {
          allowLoopback: opts.allowLoopback,
          mode: "webhook",
        }).ok,
      { message: WEBHOOK_URL_MESSAGE }
    );
}
