import {
	DEFAULT_LOCALE,
	type Locale,
	negotiateLocale,
	parseAcceptLanguage,
} from "@kayle-id/translations/i18n";
import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Pure helper that converts a raw Accept-Language header value into a
 * supported locale. Split out from `negotiateInitialLocale` so tests can
 * exercise the negotiation directly without faking an SSR request context.
 */
export function negotiateLocaleFromAcceptLanguage(
	acceptLanguage: string | null | undefined,
): Locale {
	return negotiateLocale(parseAcceptLanguage(acceptLanguage ?? null));
}

/**
 * Pick the negotiated locale for the current request. Read during SSR via
 * the root route's `beforeLoad` so the result lands in the rendered HTML
 * (`<html lang>`) and in the I18nProvider's initial state — that eliminates
 * the hydration flash that would otherwise happen if the client had to
 * re-detect from `navigator.languages` after the first paint.
 *
 * `getRequestHeader` is only meaningful while a request is being served, so
 * we gate on `typeof window` to avoid touching it from any non-SSR context
 * (tests under jsdom, client-side beforeLoad re-runs after navigation,
 * etc.). In those cases the function falls back to `DEFAULT_LOCALE`, which
 * is the same answer the SSR hydration would have produced anyway when no
 * Accept-Language header was sent.
 */
export function negotiateInitialLocale(): Locale {
	if (typeof window !== "undefined") {
		return DEFAULT_LOCALE;
	}
	return negotiateLocaleFromAcceptLanguage(getRequestHeader("accept-language"));
}
