#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PROJECT_PATH="${ROOT_DIR}/apps/ios/Kayle ID.xcodeproj"
SCHEME_NAME="Kayle ID"
DERIVED_DATA_PATH="${ROOT_DIR}/apps/ios/.derived-data-device"
DEVICE_IDENTIFIER="${IOS_DEVICE_IDENTIFIER:-}"
API_BASE_URL="${KAYLE_DEV_API_BASE_URL:-}"

usage() {
  cat <<EOF
Usage:
  bash ./apps/ios/scripts/run-on-connected-device.sh [options]

Options:
  --device <id|name>     Use a specific connected iPhone by UDID or name.
  --api-base-url <url>   Pass KAYLE_DEV_API_BASE_URL to the launched app.
  --derived-data <path>  Override the derived data output path.
  -h, --help             Show this help text.
EOF
}

log() {
  printf '[ios-device-run] %s\n' "$1"
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

load_env_file() {
  local env_path="${ROOT_DIR}/.env"

  if [[ ! -f "${env_path}" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_path}"
  set +a
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --device)
        DEVICE_IDENTIFIER="$2"
        shift 2
        ;;
      --api-base-url)
        API_BASE_URL="$2"
        shift 2
        ;;
      --derived-data)
        DERIVED_DATA_PATH="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

list_connected_devices() {
  xcodebuild \
    -project "${PROJECT_PATH}" \
    -scheme "${SCHEME_NAME}" \
    -showdestinations 2>/dev/null \
    | sed -n "s/.*{ platform:iOS, arch:[^,]*, id:\([^,}]*\), name:\([^}]*\) }.*/\1|\2/p"
}

resolve_connected_device() {
  local devices
  devices="$(list_connected_devices)"

  if [[ -n "${DEVICE_IDENTIFIER}" ]]; then
    local explicit_match
    explicit_match="$(
      printf '%s\n' "${devices}" \
        | awk -F'|' -v selection="${DEVICE_IDENTIFIER}" '$1 == selection || $2 == selection { print; exit }'
    )"

    if [[ -z "${explicit_match}" ]]; then
      fail "Connected physical iPhone not found for selection: ${DEVICE_IDENTIFIER}"
    fi

    local explicit_name
    explicit_name="${explicit_match#*|}"
    DEVICE_IDENTIFIER="${explicit_match%%|*}"
    log "Selected device: ${explicit_name} (${DEVICE_IDENTIFIER})"
    return
  fi

  local match
  match="$(printf '%s\n' "${devices}" | head -n 1)"

  if [[ -z "${match}" ]]; then
    fail "No connected physical iPhone destination found for the \"${SCHEME_NAME}\" scheme."
  fi

  DEVICE_IDENTIFIER="${match%%|*}"
  local device_name="${match#*|}"
  log "Selected device: ${device_name} (${DEVICE_IDENTIFIER})"
}

load_build_settings() {
  xcodebuild \
    -project "${PROJECT_PATH}" \
    -scheme "${SCHEME_NAME}" \
    -destination "id=${DEVICE_IDENTIFIER}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -showBuildSettings
}

build_setting_value() {
  local build_settings="$1"
  local key="$2"

  printf '%s\n' "${build_settings}" \
    | awk -F' = ' -v search_key="${key}" '$1 ~ "^[[:space:]]*" search_key "$" { print $2; exit }'
}

build_app() {
  mkdir -p "${DERIVED_DATA_PATH}"

  log "Building ${SCHEME_NAME} for device ${DEVICE_IDENTIFIER}..."
  xcodebuild \
    -project "${PROJECT_PATH}" \
    -scheme "${SCHEME_NAME}" \
    -configuration Debug \
    -destination "id=${DEVICE_IDENTIFIER}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
}

install_app() {
  local app_path="$1"

  log "Installing app on ${DEVICE_IDENTIFIER}..."
  xcrun devicectl device install app \
    --device "${DEVICE_IDENTIFIER}" \
    "${app_path}"
}

launch_app() {
  local bundle_identifier="$1"

  log "Launching ${bundle_identifier} on ${DEVICE_IDENTIFIER}..."
  if [[ -n "${API_BASE_URL}" ]]; then
    local environment_json
    environment_json="$(printf '{"KAYLE_DEV_API_BASE_URL":"%s"}' "${API_BASE_URL}")"

    xcrun devicectl device process launch \
      --device "${DEVICE_IDENTIFIER}" \
      --environment-variables "${environment_json}" \
      --terminate-existing \
      "${bundle_identifier}"
    return
  fi

  xcrun devicectl device process launch \
    --device "${DEVICE_IDENTIFIER}" \
    --terminate-existing \
    "${bundle_identifier}"
}

main() {
  parse_args "$@"
  if [[ -z "${API_BASE_URL}" ]]; then
    load_env_file
    API_BASE_URL="${KAYLE_DEV_API_BASE_URL:-}"
  fi
  resolve_connected_device

  local build_settings
  build_settings="$(load_build_settings)"

  local product_name
  local target_build_dir
  local bundle_identifier
  product_name="$(build_setting_value "${build_settings}" "FULL_PRODUCT_NAME")"
  target_build_dir="$(build_setting_value "${build_settings}" "TARGET_BUILD_DIR")"
  bundle_identifier="$(build_setting_value "${build_settings}" "PRODUCT_BUNDLE_IDENTIFIER")"

  if [[ -z "${product_name}" || -z "${target_build_dir}" || -z "${bundle_identifier}" ]]; then
    fail "Failed to resolve build settings for ${SCHEME_NAME}."
  fi

  build_app

  local app_path="${target_build_dir}/${product_name}"
  if [[ ! -d "${app_path}" ]]; then
    fail "Built app not found at ${app_path}"
  fi

  install_app "${app_path}"
  launch_app "${bundle_identifier}"

  log "App installed and launched successfully."
}

main "$@"
