// biome-ignore-all lint/style/noExportedImports: re-exporting the English source keeps the public API on this module.

import { VERIFY_HANDOFF_COPY } from "./en/verify-handoff-copy";
import { VERIFY_HANDOFF_COPY_FR } from "./fr/verify-handoff-copy";
import { DEFAULT_LOCALE, type Locale, type LocalizedDictionary } from "./i18n";

/**
 * Registry for the verify-handoff copy. Per-locale entries live in
 * `src/<locale>/verify-handoff-copy.ts`; this module stitches them into a
 * `Locale`-keyed record, re-exports `VERIFY_HANDOFF_COPY` for non-localized
 * surfaces (apps/api, apps/platform), and exposes the negotiated-locale
 * getter.
 */
export { VERIFY_HANDOFF_COPY };

export type VerifyHandoffCopy = LocalizedDictionary<typeof VERIFY_HANDOFF_COPY>;

const VERIFY_HANDOFF_COPY_BY_LOCALE: Record<Locale, VerifyHandoffCopy> = {
  en: VERIFY_HANDOFF_COPY,
  fr: VERIFY_HANDOFF_COPY_FR,
};

/**
 * Return the verify-handoff copy dictionary for `locale`, falling back to
 * the default (English) when a locale has not yet been translated. Callers
 * pass the negotiated locale from `negotiateLocale` / the React i18n
 * provider — this function does not negotiate on its own.
 */
export function getVerifyHandoffCopy(locale: Locale): VerifyHandoffCopy {
  return (
    VERIFY_HANDOFF_COPY_BY_LOCALE[locale] ??
    VERIFY_HANDOFF_COPY_BY_LOCALE[DEFAULT_LOCALE]
  );
}
