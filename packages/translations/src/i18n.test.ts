import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  negotiateLocale,
  normalizeLanguageSubtag,
  parseAcceptLanguage,
  SUPPORTED_LOCALES,
} from "./i18n";

describe("normalizeLanguageSubtag", () => {
  test("strips region and lowercases", () => {
    expect(normalizeLanguageSubtag("en-GB")).toBe("en");
    expect(normalizeLanguageSubtag("FR")).toBe("fr");
    expect(normalizeLanguageSubtag("zh_Hant")).toBe("zh");
  });

  test("handles empty / nullish input", () => {
    expect(normalizeLanguageSubtag(null)).toBeNull();
    expect(normalizeLanguageSubtag(undefined)).toBeNull();
    expect(normalizeLanguageSubtag("")).toBeNull();
    expect(normalizeLanguageSubtag("   ")).toBeNull();
  });
});

describe("parseAcceptLanguage", () => {
  test("sorts by descending q-value, preserving insertion order on ties", () => {
    expect(parseAcceptLanguage("fr;q=0.5, en;q=0.9, de;q=0.9")).toEqual([
      "en",
      "de",
      "fr",
    ]);
  });

  test("ignores wildcards and zero-quality tags", () => {
    expect(parseAcceptLanguage("*, en;q=0, fr-CA")).toEqual(["fr"]);
  });

  test("defaults missing q-value to 1", () => {
    expect(parseAcceptLanguage("en-US, fr;q=0.8")).toEqual(["en", "fr"]);
  });

  test("returns an empty list for empty / nullish input", () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("negotiateLocale", () => {
  test("returns the first preference present in SUPPORTED_LOCALES", () => {
    expect(negotiateLocale(["fr", "es", "en"])).toBe("en");
  });

  test("falls back to DEFAULT_LOCALE when nothing matches", () => {
    expect(negotiateLocale(["fr", "es"])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale([])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale([null, undefined])).toBe(DEFAULT_LOCALE);
  });

  test("matches case-insensitively and ignores region subtags", () => {
    expect(negotiateLocale(["EN-GB"])).toBe("en");
  });
});

describe("isSupportedLocale", () => {
  test("identifies tags that belong to SUPPORTED_LOCALES", () => {
    for (const tag of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(tag)).toBe(true);
    }
    expect(isSupportedLocale("xx")).toBe(false);
  });
});
