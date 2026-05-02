export const FORWARDED_CLIENT_IP_HEADER = "x-forwarded-client-ip";

export const CLIENT_IP_SOURCE_HEADERS = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

export const TRUSTED_CLIENT_IP_HEADERS = [
  FORWARDED_CLIENT_IP_HEADER,
  ...CLIENT_IP_SOURCE_HEADERS,
] as const;

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
