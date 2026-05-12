# @kayle-id/translations

Single source of truth for user-facing copy across the Kayle ID monorepo.

## Layout

```
src/
├── i18n.ts                  # Locale type, SUPPORTED_LOCALES, parsing utilities
├── i18n.test.ts
├── verify-handoff-copy.ts   # apps/verify dictionaries + getVerifyHandoffCopy(locale)
├── error-messages.ts        # Shared error-message dictionaries + getErrorMessages(locale)
└── ios-copy.ts              # Source-of-truth iOS strings keyed by their English values
scripts/
└── generate-ios-catalog.ts  # Emits apps/ios/Kayle ID/Localizable.xcstrings from ios-copy.ts
```

## Adding a language

1. Append the BCP-47 tag to `SUPPORTED_LOCALES` in `src/i18n.ts`. TypeScript
   will then flag every `Record<Locale, …>` site that hasn't been translated
   yet — follow those errors to know exactly what to fill in.
2. Add dictionary entries in:
   - `verify-handoff-copy.ts` (`VERIFY_HANDOFF_COPY_BY_LOCALE`)
   - `error-messages.ts` (`ERROR_MESSAGES_BY_LOCALE`)
   - `ios-copy.ts` (`IOS_COPY_BY_LOCALE`)
3. Update `apps/ios/Kayle ID/Info.plist`'s `CFBundleLocalizations` array.
4. From the repo root, run
   `bun --cwd packages/translations run gen:ios` to regenerate the iOS
   catalog from the updated TS dictionaries.

The `Record<Locale, Dict>` typing means missing keys are a compile error,
not a runtime surprise.

## Adding a new iOS string

Whenever you add a `String(localized: "…")`, a `Text("…")`, or a
`Button("…", role:)` literal in Swift:

1. Add the key (English source = key, English value) to `IOS_COPY_EN` in
   `src/ios-copy.ts`.
2. Run `bun --cwd packages/translations run gen:ios`.
3. Commit both the updated `ios-copy.ts` and the regenerated
   `Localizable.xcstrings`.

CI runs `bun --cwd packages/translations run verify:ios` to catch drift —
that command regenerates the catalog and fails the build if the file on
disk differs from the freshly generated one.

## How the iOS generator works

`scripts/generate-ios-catalog.ts` reads `IOS_COPY_BY_LOCALE` and writes
`apps/ios/Kayle ID/Localizable.xcstrings` in Apple's String Catalog v1.0
format. Each key becomes an entry with `extractionState: "manual"` and one
`stringUnit` per locale that has a translation. Keys are sorted alphabetically
so the generated output is deterministic across runs.

Xcode reads the generated catalog at build time. `String(localized: "…")`
and `Text("…")` look up the key in the bundled catalog at runtime, falling
back to the literal value if the key isn't present.

Do **not** edit `Localizable.xcstrings` directly — the next regeneration
will overwrite your changes. Edit `ios-copy.ts` instead.

## What is NOT translated

`apps/api` and `apps/platform` import the English `ERROR_MESSAGES` /
`VERIFY_HANDOFF_COPY` constants directly. That's intentional: the API server
returns error codes (client localizes), and the platform marketing pages
stay in English. Both surfaces sit upstream of locale negotiation.
