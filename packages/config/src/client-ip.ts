export const FORWARDED_CLIENT_IP_HEADER = "x-forwarded-client-ip";

export const CLIENT_IP_SOURCE_HEADERS = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

const TRUSTED_CLIENT_IP_SOURCE_HEADER = "cf-connecting-ip";

// The only client-IP header the internal API is allowed to trust. The proxy
// workers resolve Cloudflare's edge-provided client IP into this single
// canonical header and strip every raw source header from the outgoing request,
// so that a client-supplied x-real-ip or x-forwarded-for never reaches
// better-auth's ipAddressHeaders fallback (where it would be honoured for
// rate-limit / audit keying).
export const TRUSTED_CLIENT_IP_HEADERS = [FORWARDED_CLIENT_IP_HEADER] as const;

function normalizeHeaderValue(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export function getForwardedClientIp(headers: Headers): string | undefined {
  return normalizeHeaderValue(headers.get(TRUSTED_CLIENT_IP_SOURCE_HEADER));
}
