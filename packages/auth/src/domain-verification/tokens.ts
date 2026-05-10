import { generateRandomString } from "better-auth/crypto";

/**
 * Shared token formatting + record name helpers. Kept separate from the DoH
 * module so the platform UI / API endpoint code can reuse them without
 * dragging in the network-bound helper.
 */

const DNS_TOKEN_LENGTH = 32;
const DNS_TOKEN_PREFIX = "kayle-id-verification=";
const RECORD_NAME_PREFIX = "_kayle-id-verification.";

/**
 * Generate a 32-char base32-style random DNS token. The character set is
 * intentionally restricted to letters so the value is safe to inline into a
 * TXT record without quoting concerns.
 */
export function generateDnsChallengeToken(): string {
  return generateRandomString(DNS_TOKEN_LENGTH, "a-z", "A-Z");
}

/**
 * Format the line that the DoH lookup expects to find on the `_kayle-id-
 * verification.<apex>` TXT record.
 */
export function formatDnsRecordValue(token: string): string {
  return `${DNS_TOKEN_PREFIX}${token}`;
}

export function dnsRecordNameForApex(apexDomain: string): string {
  return `${RECORD_NAME_PREFIX}${apexDomain}`;
}
