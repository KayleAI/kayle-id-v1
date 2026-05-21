import {
	type ErrorMessages,
	getErrorMessages,
} from "@kayle-id/translations/error-messages";
import { DEFAULT_LOCALE, type Locale } from "@kayle-id/translations/i18n";
import {
	getVerifyHandoffCopy,
	type VerifyHandoffCopy,
} from "@kayle-id/translations/verify-handoff-copy";
import { createContext, type ReactNode, useContext, useMemo } from "react";

type I18nContextValue = {
	locale: Locale;
	verifyHandoffCopy: VerifyHandoffCopy;
	errorMessages: ErrorMessages;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

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

// Default-locale fallback so component tests that skip mounting the provider
// still get the English dictionary instead of crashing.
const DEFAULT_CONTEXT_VALUE: I18nContextValue = {
	locale: DEFAULT_LOCALE,
	verifyHandoffCopy: getVerifyHandoffCopy(DEFAULT_LOCALE),
	errorMessages: getErrorMessages(DEFAULT_LOCALE),
};

function useI18nContext(): I18nContextValue {
	return useContext(I18nContext) ?? DEFAULT_CONTEXT_VALUE;
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
