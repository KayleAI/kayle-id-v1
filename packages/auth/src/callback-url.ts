const SCHEME_PATH_PATTERN = /^\/[a-z][a-z0-9+.-]*:/iu;

/**
 * Safe auth callbacks are same-site relative paths. Absolute URLs,
 * protocol-relative paths, backslash-prefixed paths, and scheme-prefixed paths
 * can become open redirects in browser URL handling.
 */
export function isSafeAuthCallbackPath(input: string): boolean {
  if (!input.startsWith("/")) {
    return false;
  }

  if (input.startsWith("//") || input.startsWith("/\\")) {
    return false;
  }

  if (SCHEME_PATH_PATTERN.test(input)) {
    return false;
  }

  return true;
}
