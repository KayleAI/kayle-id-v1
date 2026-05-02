export const FORWARDED_CLIENT_IP_HEADER = "x-forwarded-client-ip";

export const CLIENT_IP_SOURCE_HEADERS = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

// The only client-IP header the internal API is allowed to trust. The proxy
// workers resolve CLIENT_IP_SOURCE_HEADERS into this single canonical header
// and strip the source headers from the outgoing request, so that a client-
// supplied x-real-ip or x-forwarded-for never reaches better-auth's
// ipAddressHeaders fallback (where it would be honoured for rate-limit / audit
// keying).
export const TRUSTED_CLIENT_IP_HEADERS = [FORWARDED_CLIENT_IP_HEADER] as const;

function normalizeHeaderValue(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function getFirstForwardedForIp(value: string | null): string | undefined {
  if (!value) {
    return;
  }

  for (const candidate of value.split(",")) {
    const clientIp = normalizeHeaderValue(candidate);

    if (clientIp) {
      return clientIp;
    }
  }
}

export function getForwardedClientIp(headers: Headers): string | undefined {
  for (const header of CLIENT_IP_SOURCE_HEADERS) {
    const clientIp =
      header === "x-forwarded-for"
        ? getFirstForwardedForIp(headers.get(header))
        : normalizeHeaderValue(headers.get(header));

    if (clientIp) {
      return clientIp;
    }
  }
}
