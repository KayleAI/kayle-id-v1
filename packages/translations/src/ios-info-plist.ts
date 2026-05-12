// biome-ignore-all lint/style/noExportedImports: re-exporting locale entry points keeps the public API on this module.

import {
  IOS_INFO_PLIST_EN,
  type IosInfoPlist,
  type IosInfoPlistKey,
} from "./en/ios-info-plist";
import { IOS_INFO_PLIST_FR } from "./fr/ios-info-plist";
import type { Locale } from "./i18n";

/**
 * Registry for the Info.plist localization dictionary. Per-locale entries
 * live in `src/<locale>/ios-info-plist.ts`; this module stitches them into a
 * `Locale`-keyed record that the generator emits as `InfoPlist.xcstrings`,
 * and re-exports the English source + types so consumers have one import
 * surface.
 */
export { IOS_INFO_PLIST_EN, type IosInfoPlist, type IosInfoPlistKey };

export const IOS_INFO_PLIST_BY_LOCALE: Record<Locale, IosInfoPlist> = {
  en: IOS_INFO_PLIST_EN,
  fr: IOS_INFO_PLIST_FR,
};
