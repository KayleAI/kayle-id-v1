#!/bin/sh
set -eu

# Regenerate apps/ios/Kayle ID/Localizable.xcstrings from the TypeScript
# source-of-truth in packages/translations/src/ios-copy.ts. Invoked from the
# "Generate Localizable.xcstrings" build phase in the Xcode project so the
# catalog stays in sync with the TS dictionaries on every build (local and
# CI). The catalog itself is gitignored — this phase produces it.
#
# Inputs declared on the build phase (so Xcode re-runs on change):
#   $(SRCROOT)/../../packages/translations/src/ios-copy.ts
#   $(SRCROOT)/../../packages/translations/src/i18n.ts
#   $(SRCROOT)/../../packages/translations/scripts/generate-ios-catalog.ts
#   $(SRCROOT)/scripts/generate-localizable-catalog.sh
# Output:
#   $(SRCROOT)/Kayle ID/Localizable.xcstrings

# Xcode build phases run with a minimal PATH that omits user shell installs.
# Probe the common locations bun ships to so command -v can find it.
export PATH="${HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found in PATH (checked ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin)." >&2
  echo "Install bun (https://bun.sh) so the build phase can regenerate Localizable.xcstrings." >&2
  exit 1
fi

TRANSLATIONS_DIR="${SRCROOT}/../../packages/translations"

if [ ! -d "${TRANSLATIONS_DIR}" ]; then
  echo "error: translations package not found at ${TRANSLATIONS_DIR}." >&2
  exit 1
fi

bun run --cwd "${TRANSLATIONS_DIR}" gen:ios
