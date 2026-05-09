const STRICT_TRANSPORT_SECURITY_HEADER = "max-age=31536000; includeSubDomains";

const SECURITY_HEADER_ENTRIES = [
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
] as const;

export interface SecurityHeaderOptions {
  includeStrictTransportSecurity?: boolean;
}

export function getSecurityHeaderEntries({
  includeStrictTransportSecurity = false,
}: SecurityHeaderOptions = {}): ReadonlyArray<readonly [string, string]> {
  if (!includeStrictTransportSecurity) {
    return SECURITY_HEADER_ENTRIES;
  }

  return [
    ["Strict-Transport-Security", STRICT_TRANSPORT_SECURITY_HEADER],
    ...SECURITY_HEADER_ENTRIES,
  ];
}

export function applySecurityHeaders(
  headers: Headers,
  options: SecurityHeaderOptions = {}
): void {
  for (const [name, value] of getSecurityHeaderEntries(options)) {
    headers.set(name, value);
  }
}

export function withSecurityHeaders(
  response: Response,
  options: SecurityHeaderOptions = {}
): Response {
  try {
    applySecurityHeaders(response.headers, options);
    return response;
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    const headers = new Headers(response.headers);
    applySecurityHeaders(headers, options);

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

export function isHttpsRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
