/**
 * Locale negotiation for end-user surfaces. End-user surfaces (apps/verify,
 * the iOS app) default to the device's language; the platform/API stay in
 * English. Adding a new language is two steps: append its tag to
 * `SUPPORTED_LOCALES` and add a dictionary entry for it in the relevant
 * copy modules.
 */

export const DEFAULT_LOCALE = "en" as const;

/**
 * Supported BCP-47 language tags, in the order they were added. Region
 * subtags are tolerated in input ("en-GB", "fr-CA") but matched here against
 * the base language tag — `negotiateLocale` handles the canonicalization.
 *
 * Adding a tag here forces every `Record<Locale, …>` dictionary to provide
 * a translation, which is the compile-time fence against half-translated
 * locales reaching users.
 */
export const SUPPORTED_LOCALES = ["en", "fr"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Recursively widen the literal-typed leaves of a dictionary back to `string`.
 *
 * Copy modules declare the English source with `as const`, which is great for
 * locking in the shape (key set, nesting) but makes `typeof DICT` describe
 * literal strings like `"Cancel"` rather than the general `string`. A per-
 * locale `Record<Locale, typeof DICT>` would then refuse a translation
 * because `"Annuler"` isn't assignable to `"Cancel"`. Wrapping the type in
 * `LocalizedDictionary<typeof DICT>` keeps the shape but widens every leaf,
 * so additional locales can supply whatever strings they need while still
 * being required to provide every key.
 */
export type LocalizedDictionary<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? LocalizedDictionary<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: LocalizedDictionary<T[K]> }
      : T;

const LANGUAGE_SUBTAG_DELIMITER = /[-_]/;

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Lowercase the language subtag of a BCP-47 tag. We only care about the
 * language portion for matching; region/script are ignored. Returns `null`
 * for empty/invalid input so callers can fold it into a fallback chain.
 */
export function normalizeLanguageSubtag(
  tag: string | null | undefined
): string | null {
  if (!tag) {
    return null;
  }
  const trimmed = tag.trim();
  if (!trimmed) {
    return null;
  }
  const language = trimmed
    .split(LANGUAGE_SUBTAG_DELIMITER, 1)[0]
    ?.toLowerCase();
  return language ? language : null;
}

/**
 * Parse an HTTP `Accept-Language` header into an ordered list of language
 * subtags. Honours q-values: tags are sorted by descending quality, with
 * stable order preserved for equal quality. Tags with `q=0` are dropped
 * (RFC 9110 §12.5.4). Returns lowercase language subtags only.
 */
export function parseAcceptLanguage(
  header: string | null | undefined
): string[] {
  if (!header) {
    return [];
  }

  const entries: { language: string; quality: number; order: number }[] = [];

  const parts = header.split(",");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }

    const [rawTag, ...params] = part.split(";");
    const language = normalizeLanguageSubtag(rawTag ?? null);
    if (!language || language === "*") {
      continue;
    }

    let quality = 1;
    for (const param of params) {
      const [key, value] = param.split("=");
      if (key?.trim().toLowerCase() === "q" && value !== undefined) {
        const parsed = Number.parseFloat(value.trim());
        if (Number.isFinite(parsed)) {
          quality = parsed;
        }
      }
    }

    if (quality <= 0) {
      continue;
    }

    entries.push({ language, quality, order: index });
  }

  entries.sort((a, b) => {
    if (b.quality !== a.quality) {
      return b.quality - a.quality;
    }
    return a.order - b.order;
  });

  return entries.map((entry) => entry.language);
}

/**
 * Pick the best supported locale from a caller-provided preference list.
 * Preferences are tried in order; the first one whose language subtag is in
 * `SUPPORTED_LOCALES` wins. Falls back to `DEFAULT_LOCALE` if nothing
 * matches — callers should not have to special-case empty input.
 */
export function negotiateLocale(
  preferences: readonly (string | null | undefined)[]
): Locale {
  for (const preference of preferences) {
    const language = normalizeLanguageSubtag(preference);
    if (language && isSupportedLocale(language)) {
      return language;
    }
  }
  return DEFAULT_LOCALE;
}
