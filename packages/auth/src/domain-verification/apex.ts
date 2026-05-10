/**
 * Apex / eTLD+1 extraction without an external public-suffix library.
 *
 * The full Mozilla PSL is ~60KB minified and pulls in a runtime dep, which
 * we'd rather not bundle into a Cloudflare Worker for a Tier-1 ship. Instead
 * we hand-curate the multi-label suffixes our customer base actually hits
 * (the common ccTLDs: `.co.uk`, `.com.au`, `.gov.uk`, etc.). Anything not on
 * the list falls through to "rightmost two labels" which is correct for
 * `.com`, `.org`, `.net`, `.io`, and the bulk of new gTLDs.
 *
 * This is documented in the Tier-1 plan as a known residual gap; if we ever
 * onboard customers on exotic suffixes we'll need to swap in `tldts` (or
 * inline a fuller PSL slice).
 */

const MULTI_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "ltd.uk",
  "plc.uk",
  "me.uk",
  "net.uk",
  "sch.uk",
  // Australia
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "id.au",
  // New Zealand
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  // Brazil
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  // South Africa
  "co.za",
  "org.za",
  "gov.za",
  // Japan
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "ed.jp",
  // India
  "co.in",
  "net.in",
  "org.in",
  "gov.in",
  "ac.in",
  "edu.in",
  // Mexico
  "com.mx",
  "gob.mx",
  // Singapore
  "com.sg",
  "edu.sg",
  "gov.sg",
  // Hong Kong
  "com.hk",
  "edu.hk",
  "gov.hk",
  "org.hk",
  // Israel
  "co.il",
  "ac.il",
  "gov.il",
  "org.il",
  // Korea
  "co.kr",
  "or.kr",
  "go.kr",
  // Taiwan
  "com.tw",
  "org.tw",
  "gov.tw",
  // Argentina
  "com.ar",
  "gov.ar",
  "edu.ar",
  // Turkey
  "com.tr",
  "edu.tr",
  "gov.tr",
  "org.tr",
]);

const ASCII_HOSTNAME_PATTERN = /^[a-z0-9.-]+$/u;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class ApexExtractionError extends Error {
  code:
    | "INVALID_HOSTNAME"
    | "MIXED_SCRIPT_LABEL"
    | "TOO_FEW_LABELS"
    | "PUBLIC_SUFFIX_ONLY";
  constructor(code: ApexExtractionError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ApexExtractionError";
  }
}

/**
 * Convert a Unicode hostname to lowercase ASCII Punycode, rejecting any
 * label that mixes scripts (a cheap defense against IDN homograph attacks
 * where e.g. `аcme.co` uses Cyrillic а).
 *
 * The WHATWG URL parser already produces Punycode for IDN hosts, so passing
 * a host straight off `new URL(...).hostname` is the expected input.
 */
export function normalizeHostname(rawHost: string): string {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) {
    throw new ApexExtractionError("INVALID_HOSTNAME", "Hostname is empty.");
  }

  const stripped = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;

  if (!ASCII_HOSTNAME_PATTERN.test(stripped)) {
    throw new ApexExtractionError(
      "INVALID_HOSTNAME",
      "Hostname must be ASCII (Punycode) lowercase."
    );
  }

  const labels = stripped.split(".");
  if (labels.length < 2) {
    throw new ApexExtractionError(
      "TOO_FEW_LABELS",
      "Hostname must have at least two labels."
    );
  }

  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      throw new ApexExtractionError(
        "INVALID_HOSTNAME",
        `Label "${label}" is not a valid DNS label.`
      );
    }
    // Reject Punycode labels that decode to mixed-script text. We intentionally
    // do NOT do full Unicode-aware checking here (that needs `tr46`); anything
    // beginning with `xn--` (other than the common SMP-emoji domains we don't
    // serve) is rare enough to gate manually if it ever shows up.
    if (label.startsWith("xn--")) {
      throw new ApexExtractionError(
        "MIXED_SCRIPT_LABEL",
        "IDN (xn--) hostnames are not supported for domain verification."
      );
    }
  }

  return stripped;
}

/**
 * Extract the eTLD+1 ("apex") for the given hostname. The hostname must
 * already be normalized via `normalizeHostname`.
 *
 * Examples:
 *   "acme.co"            -> "acme.co"
 *   "app.acme.co"        -> "acme.co"
 *   "id.app.acme.co"     -> "acme.co"
 *   "acme.co.uk"         -> "acme.co.uk"
 *   "id.acme.co.uk"      -> "acme.co.uk"
 *   "app.id.acme.co.uk"  -> "acme.co.uk"
 */
export function extractApexDomain(normalizedHost: string): string {
  const labels = normalizedHost.split(".");

  // Try matching the longest known multi-label public suffix first.
  if (labels.length >= 3) {
    const lastTwo = labels.slice(-2).join(".");
    if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
      return labels.slice(-3).join(".");
    }
  }

  // Default: the public suffix is the rightmost label and the apex is the
  // rightmost two labels. Covers `.com`, `.io`, `.co`, `.net`, etc.
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(normalizedHost)) {
    throw new ApexExtractionError(
      "PUBLIC_SUFFIX_ONLY",
      "Hostname is itself a public suffix; an organization cannot own it."
    );
  }

  return labels.slice(-2).join(".");
}

/**
 * Convenience: normalize then extract. Throws ApexExtractionError on either
 * step. Callers that want fine-grained error messaging can call the two
 * functions individually.
 */
export function hostnameToApex(rawHost: string): string {
  return extractApexDomain(normalizeHostname(rawHost));
}

/**
 * True when `host` is the apex itself or any subdomain of it. Both arguments
 * must already be normalized (lowercase ASCII Punycode, no trailing dot).
 */
export function isHostUnderApex(host: string, apex: string): boolean {
  if (host === apex) {
    return true;
  }
  return host.endsWith(`.${apex}`);
}
