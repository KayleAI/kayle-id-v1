/**
 * DNS-over-HTTPS lookup for TXT records, used to verify org-supplied apex
 * domains. Workers can't make raw UDP queries, so we go through DoH.
 *
 * Primary resolver: Cloudflare 1.1.1.1 (`cloudflare-dns.com/dns-query`).
 * Fallback: Google Public DNS (`dns.google/resolve`). Both speak the same
 * `application/dns-json` shape so we use a single parser.
 *
 * The lookup is deliberately fail-soft for callers that distinguish "miss"
 * (record not present / value mismatch) from "infra error" (network blip,
 * DoH provider down). The interactive verify endpoint surfaces the former
 * as `DNS_NOT_PROPAGATED`; the cron treats the latter as a soft-fail and
 * does not increment the failure counter.
 */

const PRIMARY_DOH_URL = "https://cloudflare-dns.com/dns-query";
const FALLBACK_DOH_URL = "https://dns.google/resolve";
const DEFAULT_TIMEOUT_MS = 5000;

export type DohFetch = typeof fetch;

export type DohLookupOutcome =
  | { ok: true; values: string[] }
  | { ok: false; reason: "no_record" | "network_error" | "invalid_response" };

interface DohJsonResponse {
  Answer?: Array<{ name?: string; type?: number; data?: string }>;
  Status?: number;
}

/**
 * Resolve TXT values for `recordName`. Returns the unquoted, decoded values
 * (Cloudflare wraps each TXT chunk in `"`s; we strip them). Order is not
 * meaningful — callers compare for membership.
 *
 * `fetchImpl` is injectable for tests; defaults to global `fetch`.
 */
export async function lookupTxt({
  recordName,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  recordName: string;
  fetchImpl?: DohFetch;
  timeoutMs?: number;
}): Promise<DohLookupOutcome> {
  const primary = await queryDoh({
    recordName,
    url: PRIMARY_DOH_URL,
    fetchImpl,
    timeoutMs,
  });
  if (primary.outcome.ok || primary.outcome.reason !== "network_error") {
    return primary.outcome;
  }

  // Only retry on network/transport-level failure. A clean "no record" answer
  // from Cloudflare is the source of truth — don't double-shop for a different
  // (and possibly stale) cache view from Google.
  const fallback = await queryDoh({
    recordName,
    url: FALLBACK_DOH_URL,
    fetchImpl,
    timeoutMs,
  });
  return fallback.outcome;
}

interface DohQueryResult {
  outcome: DohLookupOutcome;
}

async function queryDoh({
  recordName,
  url,
  fetchImpl,
  timeoutMs,
}: {
  recordName: string;
  url: string;
  fetchImpl: DohFetch;
  timeoutMs: number;
}): Promise<DohQueryResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    const queryUrl = `${url}?name=${encodeURIComponent(recordName)}&type=TXT`;
    response = await fetchImpl(queryUrl, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
  } catch {
    return { outcome: { ok: false, reason: "network_error" } };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return { outcome: { ok: false, reason: "network_error" } };
  }

  let body: DohJsonResponse;
  try {
    body = (await response.json()) as DohJsonResponse;
  } catch {
    return { outcome: { ok: false, reason: "invalid_response" } };
  }

  if (typeof body.Status === "number" && body.Status !== 0) {
    // NXDOMAIN / NODATA / formerr — there's no record we can match. Treat
    // identically to "no record" so the caller can surface a clean message.
    return { outcome: { ok: false, reason: "no_record" } };
  }

  const answers = Array.isArray(body.Answer) ? body.Answer : [];
  const values = answers
    .filter((a) => a?.type === 16 && typeof a.data === "string")
    .map((a) => stripTxtQuoting(a.data as string));

  if (values.length === 0) {
    return { outcome: { ok: false, reason: "no_record" } };
  }

  return { outcome: { ok: true, values } };
}

/**
 * DoH responses encode each TXT chunk as a quoted string (e.g. `"v=spf1 ..."`)
 * and join multi-string TXT records with spaces. For our use we expect a
 * single short value (`kayle-id-verification=...`); strip wrapping quotes and
 * collapse adjacent quoted segments so callers can compare cleanly.
 */
function stripTxtQuoting(raw: string): string {
  let trimmed = raw.trim();
  // A multi-string TXT may look like: `"chunk-1" "chunk-2"`. Concatenate.
  if (trimmed.includes('" "')) {
    trimmed = trimmed.replace(/"\s+"/gu, "");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed;
}
