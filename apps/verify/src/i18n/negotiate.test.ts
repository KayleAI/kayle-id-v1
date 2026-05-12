/**
 * @vitest-environment jsdom
 */
import { DEFAULT_LOCALE } from "@kayle-id/translations/i18n";
import { describe, expect, test } from "vitest";
import { negotiateLocaleFromAcceptLanguage } from "./negotiate";

describe("negotiateLocaleFromAcceptLanguage", () => {
	test("returns the highest-quality supported locale", () => {
		expect(negotiateLocaleFromAcceptLanguage("en-US,fr;q=0.5")).toBe("en");
	});

	test("returns fr when the browser prefers French", () => {
		expect(negotiateLocaleFromAcceptLanguage("fr-FR,en;q=0.5")).toBe("fr");
	});

	test("falls back to the default when nothing matches", () => {
		expect(negotiateLocaleFromAcceptLanguage("de,es;q=0.8")).toBe(
			DEFAULT_LOCALE,
		);
	});

	test("falls back to the default for missing / empty headers", () => {
		expect(negotiateLocaleFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
		expect(negotiateLocaleFromAcceptLanguage(undefined)).toBe(DEFAULT_LOCALE);
		expect(negotiateLocaleFromAcceptLanguage("")).toBe(DEFAULT_LOCALE);
	});

	test("respects q-value ordering, not declaration order", () => {
		expect(negotiateLocaleFromAcceptLanguage("fr;q=0.1, en;q=0.9")).toBe("en");
	});
});
