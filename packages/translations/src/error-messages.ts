// biome-ignore-all lint/style/noExportedImports: re-exporting the English source keeps the public API on this module.

import { ERROR_MESSAGES } from "./en/error-messages";
import { ERROR_MESSAGES_FR } from "./fr/error-messages";
import { DEFAULT_LOCALE, type Locale, type LocalizedDictionary } from "./i18n";

/**
 * Registry for the shared error-messages dictionary. Per-locale entries live
 * in `src/<locale>/error-messages.ts`; this module stitches them into a
 * `Locale`-keyed record, re-exports `ERROR_MESSAGES` for non-localized
 * surfaces (apps/api, apps/platform), and exposes the negotiated-locale
 * getter.
 */
export { ERROR_MESSAGES };

export type ErrorMessages = LocalizedDictionary<typeof ERROR_MESSAGES>;
export type ErrorMessageKey = keyof ErrorMessages;

const ERROR_MESSAGES_BY_LOCALE: Record<Locale, ErrorMessages> = {
  en: ERROR_MESSAGES,
  fr: ERROR_MESSAGES_FR,
};

/**
 * Return the error-messages dictionary for `locale`, falling back to the
 * default (English) when a locale has not yet been translated. End-user
 * surfaces (apps/verify) should look up the negotiated locale via the React
 * i18n provider.
 */
export function getErrorMessages(locale: Locale): ErrorMessages {
  return (
    ERROR_MESSAGES_BY_LOCALE[locale] ?? ERROR_MESSAGES_BY_LOCALE[DEFAULT_LOCALE]
  );
}
