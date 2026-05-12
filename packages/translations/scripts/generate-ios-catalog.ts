#!/usr/bin/env bun
/**
 * Generate `apps/ios/Kayle ID/Localizable.xcstrings` from the TypeScript
 * source-of-truth at `src/ios-copy.ts`. Run via `bun run gen:ios` (from this
 * package) or `bun --cwd packages/translations run gen:ios` (from the repo
 * root). Re-run any time `IOS_COPY_BY_LOCALE` changes.
 *
 * The generated catalog matches Apple's String Catalog v1.0 shape closely
 * enough that Xcode picks it up as-is. We deliberately use stock
 * `JSON.stringify` rather than Xcode's slightly idiosyncratic spacing
 * (`"key" :`) — Xcode reads both, and the diff after the first regenerate
 * is a one-time whitespace shift.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../src/i18n";
import { IOS_COPY_BY_LOCALE, type IosCopyKey } from "../src/ios-copy";

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

function buildCatalog(): XcStringsCatalog {
  const sourceDict = IOS_COPY_BY_LOCALE[DEFAULT_LOCALE];
  const keys = (Object.keys(sourceDict) as IosCopyKey[]).sort();

  const strings: Record<string, XcStringEntry> = {};
  for (const key of keys) {
    const localizations: Record<string, XcStringLocalization> = {};
    for (const locale of SUPPORTED_LOCALES) {
      const value = IOS_COPY_BY_LOCALE[locale][key];
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

const TARGET = resolve(
  import.meta.dir,
  "../../../apps/ios/Kayle ID/Localizable.xcstrings"
);

function main(): void {
  const catalog = buildCatalog();
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  writeFileSync(TARGET, serialized);
  const count = Object.keys(catalog.strings).length;
  const locales = SUPPORTED_LOCALES.length;
  process.stdout.write(
    `Wrote ${count} strings (${locales} locale(s)) to ${TARGET}\n`
  );
}

main();
