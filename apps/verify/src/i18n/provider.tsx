import {
	type ErrorMessages,
	getErrorMessages,
} from "@kayle-id/config/error-messages";
import { DEFAULT_LOCALE, type Locale } from "@kayle-id/config/i18n";
import {
	getVerifyHandoffCopy,
	type VerifyHandoffCopy,
} from "@kayle-id/config/verify-handoff-copy";
import { createContext, type ReactNode, useContext, useMemo } from "react";

type I18nContextValue = {
	locale: Locale;
	verifyHandoffCopy: VerifyHandoffCopy;
	errorMessages: ErrorMessages;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/**
 * Provide the negotiated locale and the corresponding copy dictionaries to
 * the verify app. The locale is negotiated server-side (see
 * `negotiateInitialLocale` in `__root.tsx`'s `beforeLoad`) and passed in via
 * `initialLocale`, so the SSR-rendered HTML, the `<html lang>` attribute,
 * and the initial client render all agree — no post-hydration dictionary
 * swap, no flash of English content for non-English users.
 */
export function I18nProvider({
	children,
	initialLocale,
}: {
	children: ReactNode;
	initialLocale: Locale;
}) {
	const value = useMemo<I18nContextValue>(
		() => ({
			locale: initialLocale,
			verifyHandoffCopy: getVerifyHandoffCopy(initialLocale),
			errorMessages: getErrorMessages(initialLocale),
		}),
		[initialLocale],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const DEFAULT_CONTEXT_VALUE: I18nContextValue = {
	locale: DEFAULT_LOCALE,
	verifyHandoffCopy: getVerifyHandoffCopy(DEFAULT_LOCALE),
	errorMessages: getErrorMessages(DEFAULT_LOCALE),
};

/**
 * Fall back to the default English dictionaries when no provider is mounted.
 * The provider is always present in the running app (wired into `__root`),
 * but components rendered in isolation (e.g. component tests) skip the root
 * layout. Letting the hooks degrade to English keeps those tests working
 * without forcing every test to mount the provider.
 */
function useI18nContext(): I18nContextValue {
	const context = useContext(I18nContext);
	return context ?? DEFAULT_CONTEXT_VALUE;
}

export function useLocale(): Locale {
	return useI18nContext().locale;
}

export function useVerifyHandoffCopy(): VerifyHandoffCopy {
	return useI18nContext().verifyHandoffCopy;
}

export function useErrorMessages(): ErrorMessages {
	return useI18nContext().errorMessages;
}
