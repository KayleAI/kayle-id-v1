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
`Button("…", role:)` literal in Swift, add the key (English source = key,
English value) to `IOS_COPY_EN` in `src/ios-copy.ts`. That's it — the
catalog regenerates automatically on the next build.

## How the iOS generator works

`apps/ios/Kayle ID/Localizable.xcstrings` is **generated, not committed**.
A "Generate Localizable.xcstrings" Run Script build phase fires before
the Sources phase on every Xcode build (local and CI) and invokes
`apps/ios/scripts/generate-localizable-catalog.sh`, which calls
`bun --cwd packages/translations run gen:ios`.

`scripts/generate-ios-catalog.ts` reads `IOS_COPY_BY_LOCALE` and writes
the catalog in Apple's String Catalog v1.0 format. Each key becomes an
entry with `extractionState: "manual"` and one `stringUnit` per locale
that has a translation. Keys are sorted alphabetically so the generated
output is deterministic.

Xcode bundles the regenerated catalog at build time. `String(localized:
"…")` and `Text("…")` look up the key in the bundled catalog at runtime,
falling back to the literal value if the key isn't present.

### Requirements

`bun` must be on `PATH` during `xcodebuild`. The build-phase script probes
`~/.bun/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` — if your bun
install lives elsewhere, set it up so one of those paths picks it up. CI
installs bun via the `setup-bun` action before invoking `xcodebuild`.

### After cloning

The catalog is regenerated automatically the first time you build the iOS
app in Xcode. If you'd rather not wait for the next build (e.g. to seed
IDE indexing), run `bun --cwd packages/translations run gen:ios` from the
repo root.

Do **not** edit `Localizable.xcstrings` directly — the next build phase
will overwrite it. Edit `ios-copy.ts` instead.

## What is NOT translated

`apps/api` and `apps/platform` import the English `ERROR_MESSAGES` /
`VERIFY_HANDOFF_COPY` constants directly. That's intentional: the API server
returns error codes (client localizes), and the platform marketing pages
stay in English. Both surfaces sit upstream of locale negotiation.
