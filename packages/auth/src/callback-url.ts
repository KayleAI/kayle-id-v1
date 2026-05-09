const SCHEME_PATH_PATTERN = /^\/[a-z][a-z0-9+.-]*:/iu;
export const AUTH_CALLBACK_URL_MAX_LENGTH = 2048;

function hasControlCharacter(input: string): boolean {
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

/**
 * Safe auth callbacks are same-site relative paths. Absolute URLs,
 * protocol-relative paths, backslash-prefixed paths, and scheme-prefixed paths
 * can become open redirects in browser URL handling.
 */
export function isSafeAuthCallbackPath(input: string): boolean {
  if (input.length > AUTH_CALLBACK_URL_MAX_LENGTH) {
    return false;
  }

  if (!input.startsWith("/")) {
    return false;
  }

  if (hasControlCharacter(input)) {
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
