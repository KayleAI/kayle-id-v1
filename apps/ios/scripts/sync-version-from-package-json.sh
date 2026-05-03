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

# CFBundleVersion (the "build number" in Apple terminology) must be unique per
# CFBundleShortVersionString in App Store Connect. CI passes IOS_BUILD_NUMBER as
# the GitHub workflow's run_attempt so each re-run of the same package version
# produces a fresh CFBundleVersion (e.g. 1.2.1.1, 1.2.1.2, ...). Local builds
# default to 1, which is harmless because they are never uploaded.
IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-1}"

case "${IOS_BUILD_NUMBER}" in
  ''|*[!0-9]*)
    echo "IOS_BUILD_NUMBER must be a positive integer. Received ${IOS_BUILD_NUMBER}." >&2
    exit 1
    ;;
esac

if [ "${IOS_BUILD_NUMBER}" -lt 1 ]; then
  echo "IOS_BUILD_NUMBER must be >= 1. Received ${IOS_BUILD_NUMBER}." >&2
  exit 1
fi

BUNDLE_VERSION="${PACKAGE_VERSION}.${IOS_BUILD_NUMBER}"

PLIST_BUDDY="/usr/libexec/PlistBuddy"

mkdir -p "$(dirname "${GENERATED_INFO_PLIST_PATH}")"
cp "${SOURCE_INFO_PLIST_PATH}" "${GENERATED_INFO_PLIST_PATH}"

"${PLIST_BUDDY}" -c "Set :CFBundleShortVersionString ${PACKAGE_VERSION}" "${GENERATED_INFO_PLIST_PATH}"
"${PLIST_BUDDY}" -c "Set :CFBundleVersion ${BUNDLE_VERSION}" "${GENERATED_INFO_PLIST_PATH}"

# The source Info.plist sets `NSAppTransportSecurity > NSAllowsArbitraryLoads`
# so DEBUG builds can talk to a Tailscale-routed dev API over plain HTTP. That
# flag MUST NOT ship to the App Store — it disables ATS app-wide. Strip it for
# any non-Debug configuration so Release builds get default ATS (HTTPS only).
if [ "${CONFIGURATION:-Release}" != "Debug" ]; then
  "${PLIST_BUDDY}" -c "Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads" "${GENERATED_INFO_PLIST_PATH}" 2>/dev/null || true
fi
