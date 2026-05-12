import {
	DEFAULT_LOCALE,
	type Locale,
	negotiateLocale,
	parseAcceptLanguage,
} from "@kayle-id/translations/i18n";
import { createIsomorphicFn } from "@tanstack/react-start";
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
 * Implemented via `createIsomorphicFn` so the TanStack Start bundler can
 * tree-shake the server-only `getRequestHeader` call (and its import) out
 * of the client bundle. The client branch falls back to `DEFAULT_LOCALE`,
 * which matches the SSR result when no Accept-Language header was sent
 * and is only consulted on client-side `beforeLoad` re-runs after the
 * initial render has already set the real locale into the provider.
 */
export const negotiateInitialLocale = createIsomorphicFn()
	.client((): Locale => DEFAULT_LOCALE)
	.server(
		(): Locale =>
			negotiateLocaleFromAcceptLanguage(getRequestHeader("accept-language")),
	);
