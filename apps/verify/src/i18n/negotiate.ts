import {
	DEFAULT_LOCALE,
	type Locale,
	negotiateLocale,
	parseAcceptLanguage,
} from "@kayle-id/translations/i18n";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export function negotiateLocaleFromAcceptLanguage(
	acceptLanguage: string | null | undefined,
): Locale {
	return negotiateLocale(parseAcceptLanguage(acceptLanguage ?? null));
}

// Implemented via createIsomorphicFn so the server-only getRequestHeader call
// is tree-shaken out of the client bundle. The client branch returns
// DEFAULT_LOCALE, which only matters on client-side beforeLoad re-runs after
// the initial SSR render has already populated the provider.
export const negotiateInitialLocale = createIsomorphicFn()
	.client((): Locale => DEFAULT_LOCALE)
	.server(
		(): Locale =>
			negotiateLocaleFromAcceptLanguage(getRequestHeader("accept-language")),
	);
