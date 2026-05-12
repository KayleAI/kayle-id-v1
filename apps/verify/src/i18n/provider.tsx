import {
	type ErrorMessages,
	getErrorMessages,
} from "@kayle-id/config/error-messages";
import {
	DEFAULT_LOCALE,
	detectBrowserLocale,
	type Locale,
} from "@kayle-id/config/i18n";
import {
	getVerifyHandoffCopy,
	type VerifyHandoffCopy,
} from "@kayle-id/config/verify-handoff-copy";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type I18nContextValue = {
	locale: Locale;
	verifyHandoffCopy: VerifyHandoffCopy;
	errorMessages: ErrorMessages;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/**
 * Provide the negotiated locale and the corresponding copy dictionaries to
 * the verify app. First render uses `DEFAULT_LOCALE` so that SSR output
 * matches the initial client render; after hydration we detect the device's
 * language via `navigator.languages` and swap dictionaries in. The detected
 * locale is also mirrored onto `<html lang>` so screen readers and browser
 * UI pick up the language change.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

	useEffect(() => {
		const detected = detectBrowserLocale();
		setLocale(detected);
	}, []);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		document.documentElement.setAttribute("lang", locale);
	}, [locale]);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			verifyHandoffCopy: getVerifyHandoffCopy(locale),
			errorMessages: getErrorMessages(locale),
		}),
		[locale],
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
