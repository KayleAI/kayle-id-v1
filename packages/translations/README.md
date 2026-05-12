# @kayle-id/translations

Single source of truth for user-facing copy across the Kayle ID monorepo.

## Layout

```
src/
├── i18n.ts                  # Locale type, SUPPORTED_LOCALES, parsing utilities
├── i18n.test.ts
├── verify-handoff-copy.ts   # apps/verify dictionaries + getVerifyHandoffCopy(locale)
└── error-messages.ts        # Shared error-message dictionaries + getErrorMessages(locale)
```

## Adding a language

1. Append the BCP-47 tag to `SUPPORTED_LOCALES` in `src/i18n.ts`. TypeScript will
   then flag every `Record<Locale, …>` site that hasn't been translated yet —
   follow those errors to know exactly what to fill in.
2. Add a dictionary entry in `verify-handoff-copy.ts` (`VERIFY_HANDOFF_COPY_BY_LOCALE`).
3. Add a dictionary entry in `error-messages.ts` (`ERROR_MESSAGES_BY_LOCALE`).
4. Update `apps/ios/Kayle ID/Info.plist`'s `CFBundleLocalizations` array.
5. Add the language to `apps/ios/Kayle ID/Localizable.xcstrings` via Xcode's
   catalog editor (or by hand — it's JSON).

The `Record<Locale, Dict>` typing means missing keys are a compile error, not
a runtime surprise.

## What is NOT in this package

**iOS String Catalog**: `apps/ios/Kayle ID/Localizable.xcstrings` stays in
the iOS app bundle. Apple's String Catalog is a build-system citizen — Xcode
harvests `String(localized:)` calls into it, the translator workflow lives in
Xcode's catalog editor, and the build phase bundles it into the app. Moving
it out of the iOS resource tree would add fragility (symlinks, build-phase
copying, or `.xcodeproj` surgery) for no real translator benefit.

If a single-source-of-truth-everywhere becomes important, the path is a
build-time generator that emits both the TypeScript dictionaries here and a
regenerated `Localizable.xcstrings`. Not worth the tooling cost at one
supported locale.

## What is NOT translated

`apps/api` and `apps/platform` import the English `ERROR_MESSAGES` /
`VERIFY_HANDOFF_COPY` constants directly. That's intentional: the API server
returns error codes (client localizes), and the platform marketing pages
stay in English. Both surfaces sit upstream of locale negotiation.
