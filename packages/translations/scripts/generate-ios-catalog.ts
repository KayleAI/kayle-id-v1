#!/usr/bin/env bun
/**
 * Generate `apps/ios/Kayle ID/Localizable.xcstrings` and
 * `apps/ios/Kayle ID/InfoPlist.xcstrings` from the TypeScript source-of-truth
 * in `src/ios-copy.ts`. Run via `bun run gen:ios` (from this package) or
 * `bun --cwd packages/translations run gen:ios` (from the repo root). Re-run
 * any time `IOS_COPY_BY_LOCALE` or `IOS_INFO_PLIST_BY_LOCALE` change.
 *
 * Two catalogs because iOS reads them from different places:
 *
 *  - `Localizable.xcstrings` — what `String(localized:)` / `Text("…")` look
 *    up at runtime.
 *  - `InfoPlist.xcstrings` — what iOS uses to localize the strings it owns
 *    (camera/NFC permission prompts, app display name). Keys must be
 *    Info.plist key names verbatim (e.g. `NSCameraUsageDescription`).
 *
 * Both catalogs match Apple's String Catalog v1.0 shape closely enough that
 * Xcode picks them up as-is. We deliberately use stock `JSON.stringify`
 * rather than Xcode's slightly idiosyncratic spacing (`"key" :`) — Xcode
 * reads both, and the diff against an Xcode-managed catalog is a one-time
 * whitespace shift.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "../src/i18n";
import { IOS_COPY_BY_LOCALE, type IosCopyKey } from "../src/ios-copy";
import {
  IOS_INFO_PLIST_BY_LOCALE,
  type IosInfoPlistKey,
} from "../src/ios-info-plist";

interface XcStringLocalization {
  stringUnit: {
    state: "translated";
    value: string;
  };
}

interface XcStringEntry {
  extractionState: "manual";
  localizations: Record<string, XcStringLocalization>;
}

interface XcStringsCatalog {
  sourceLanguage: string;
  strings: Record<string, XcStringEntry>;
  version: string;
}

function buildCatalog<K extends string>(
  dictByLocale: Record<Locale, Record<K, string>>
): XcStringsCatalog {
  const sourceDict = dictByLocale[DEFAULT_LOCALE];
  const keys = (Object.keys(sourceDict) as K[]).sort();

  const strings: Record<string, XcStringEntry> = {};
  for (const key of keys) {
    const localizations: Record<string, XcStringLocalization> = {};
    for (const locale of SUPPORTED_LOCALES) {
      const value = dictByLocale[locale][key];
      if (typeof value !== "string") {
        continue;
      }
      localizations[locale] = {
        stringUnit: {
          state: "translated",
          value,
        },
      };
    }
    strings[key] = {
      extractionState: "manual",
      localizations,
    };
  }

  return {
    sourceLanguage: DEFAULT_LOCALE,
    strings,
    version: "1.0",
  };
}

const IOS_APP_DIR = resolve(import.meta.dir, "../../../apps/ios/Kayle ID");
const LOCALIZABLE_TARGET = resolve(IOS_APP_DIR, "Localizable.xcstrings");
const INFO_PLIST_TARGET = resolve(IOS_APP_DIR, "InfoPlist.xcstrings");

function writeCatalog(target: string, catalog: XcStringsCatalog): void {
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  writeFileSync(target, serialized);
  const count = Object.keys(catalog.strings).length;
  const locales = SUPPORTED_LOCALES.length;
  process.stdout.write(
    `Wrote ${count} strings (${locales} locale(s)) to ${target}\n`
  );
}

function main(): void {
  writeCatalog(
    LOCALIZABLE_TARGET,
    buildCatalog<IosCopyKey>(IOS_COPY_BY_LOCALE)
  );
  writeCatalog(
    INFO_PLIST_TARGET,
    buildCatalog<IosInfoPlistKey>(IOS_INFO_PLIST_BY_LOCALE)
  );
}

main();
