// biome-ignore-all lint/style/noExportedImports: re-exporting locale entry points keeps the public API on this module.

import { IOS_COPY_EN, type IosCopy, type IosCopyKey } from "./en/ios-copy";
import { IOS_COPY_FR } from "./fr/ios-copy";
import type { Locale } from "./i18n";

/**
 * Registry for the iOS Localizable.xcstrings dictionary. The per-locale
 * dictionaries live in `src/<locale>/ios-copy.ts`; this module stitches them
 * into a `Locale`-keyed record that the generator reads, and re-exports the
 * English source + types so consumers can keep using
 * `@kayle-id/translations/ios-copy` as a single import surface.
 */
export { IOS_COPY_EN, type IosCopy, type IosCopyKey };

export const IOS_COPY_BY_LOCALE: Record<Locale, IosCopy> = {
  en: IOS_COPY_EN,
  fr: IOS_COPY_FR,
};
