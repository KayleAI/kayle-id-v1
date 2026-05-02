#!/bin/sh
set -eu

PACKAGE_JSON_PATH="${SCRIPT_INPUT_FILE_0}"
SOURCE_INFO_PLIST_PATH="${SCRIPT_INPUT_FILE_1}"
GENERATED_INFO_PLIST_PATH="${SCRIPT_OUTPUT_FILE_0}"

if [ ! -f "${PACKAGE_JSON_PATH}" ]; then
  echo "Root package.json not found at ${PACKAGE_JSON_PATH}." >&2
  exit 1
fi

if [ ! -f "${SOURCE_INFO_PLIST_PATH}" ]; then
  echo "Source Info.plist not found at ${SOURCE_INFO_PLIST_PATH}." >&2
  exit 1
fi

PACKAGE_VERSION="$(plutil -extract version raw -o - "${PACKAGE_JSON_PATH}")"

case "${PACKAGE_VERSION}" in
  ''|*[!0-9.]*|.*|*..*|*.)
    echo "Root package version must be numeric semver like 1.2.3. Received ${PACKAGE_VERSION}." >&2
    exit 1
    ;;
esac

VERSION_SEGMENT_COUNT="$(printf '%s' "${PACKAGE_VERSION}" | awk -F. '{ print NF }')"

if [ "${VERSION_SEGMENT_COUNT}" -ne 3 ]; then
  echo "Root package version must contain exactly three numeric segments. Received ${PACKAGE_VERSION}." >&2
  exit 1
fi

PLIST_BUDDY="/usr/libexec/PlistBuddy"

mkdir -p "$(dirname "${GENERATED_INFO_PLIST_PATH}")"
cp "${SOURCE_INFO_PLIST_PATH}" "${GENERATED_INFO_PLIST_PATH}"

"${PLIST_BUDDY}" -c "Set :CFBundleShortVersionString ${PACKAGE_VERSION}" "${GENERATED_INFO_PLIST_PATH}"
"${PLIST_BUDDY}" -c "Set :CFBundleVersion ${PACKAGE_VERSION}" "${GENERATED_INFO_PLIST_PATH}"

# The source Info.plist sets `NSAppTransportSecurity > NSAllowsArbitraryLoads`
# so DEBUG builds can talk to a Tailscale-routed dev API over plain HTTP. That
# flag MUST NOT ship to the App Store — it disables ATS app-wide. Strip it for
# any non-Debug configuration so Release builds get default ATS (HTTPS only).
if [ "${CONFIGURATION:-Release}" != "Debug" ]; then
  "${PLIST_BUDDY}" -c "Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads" "${GENERATED_INFO_PLIST_PATH}" 2>/dev/null || true
fi
