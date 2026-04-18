#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INITIAL_WORKDIR="$(pwd)"
PKD_OBJECTS_LDIF="${ICAO_PKD_OBJECTS_LDIF:-${ROOT_DIR}/temp/icaopkd-001-complete-10023.ldif}"
PKD_MASTER_LISTS_LDIF="${ICAO_PKD_MASTER_LISTS_LDIF:-${ROOT_DIR}/temp/icaopkd-002-complete-508.ldif}"
PKD_BUNDLE_OUTPUT="${PKD_BUNDLE_OUTPUT:-${ROOT_DIR}/temp/icao-pkd-bundle.json}"
PKD_REMOTE_BUCKET_NAME="${PKD_REMOTE_BUCKET_NAME:-kayle-id-r2}"
PKD_REMOTE_OBJECT_KEY="${PKD_REMOTE_OBJECT_KEY:-verify/pkd-trust/latest.json}"
SKIP_PKD_IMPORT="false"
SKIP_R2_UPLOAD="false"

usage() {
  cat <<EOF
Usage:
  bash ./scripts/seed-production-pkd.sh [options]

Options:
  --objects <path>       Path to the ICAO PKD objects LDIF.
  --master-lists <path>  Path to the ICAO PKD CSCA master-list LDIF.
  --output <path>        Output path for the generated PKD bundle JSON.
  --bucket <name>        Remote R2 bucket name for PKD upload.
  --key <key>            Remote R2 object key for PKD upload.
  --skip-pkd-import      Skip PKD bundle generation and reuse --output as-is.
  --skip-r2-upload       Skip uploading the PKD bundle to remote R2.
  -h, --help             Show this help text.

Defaults:
  objects LDIF:      ${PKD_OBJECTS_LDIF}
  master-list LDIF:  ${PKD_MASTER_LISTS_LDIF}
  bundle output:     ${PKD_BUNDLE_OUTPUT}
  remote R2 bucket:  ${PKD_REMOTE_BUCKET_NAME}
  remote R2 key:     ${PKD_REMOTE_OBJECT_KEY}

Example:
  bash ./scripts/seed-production-pkd.sh \\
    --objects ./temp/icao-pkd-objects.ldif \\
    --master-lists ./temp/icao-pkd-master-lists.ldif \\
    --output ./temp/icao-pkd-bundle.json
EOF
}

log() {
  printf '[seed-production-pkd] %s\n' "$1"
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_file() {
  local path="$1"

  if [[ ! -f "${path}" ]]; then
    fail "Required file not found: ${path}"
  fi
}

any_input_newer_than_output() {
  local output_path="$1"
  shift

  if [[ ! -f "${output_path}" ]]; then
    return 0
  fi

  for input_path in "$@"; do
    if [[ "${input_path}" -nt "${output_path}" ]]; then
      return 0
    fi
  done

  return 1
}

absolute_path() {
  local path="$1"

  if [[ "${path}" = /* ]]; then
    printf '%s\n' "${path}"
    return
  fi

  printf '%s/%s\n' "${INITIAL_WORKDIR}" "${path#./}"
}

pkd_segment_dir_for_output() {
  local output_path="$1"
  local output_dir
  local output_name

  output_dir="$(dirname "${output_path}")"
  output_name="$(basename "${output_path}")"
  output_name="${output_name%.*}"

  printf '%s/%s.dsc-country\n' "${output_dir}" "${output_name}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --objects)
        PKD_OBJECTS_LDIF="$2"
        shift 2
        ;;
      --master-lists)
        PKD_MASTER_LISTS_LDIF="$2"
        shift 2
        ;;
      --output)
        PKD_BUNDLE_OUTPUT="$2"
        shift 2
        ;;
      --bucket)
        PKD_REMOTE_BUCKET_NAME="$2"
        shift 2
        ;;
      --key)
        PKD_REMOTE_OBJECT_KEY="$2"
        shift 2
        ;;
      --skip-pkd-import)
        SKIP_PKD_IMPORT="true"
        shift
        ;;
      --skip-r2-upload)
        SKIP_R2_UPLOAD="true"
        shift
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

validate_inputs() {
  PKD_BUNDLE_OUTPUT="$(absolute_path "${PKD_BUNDLE_OUTPUT}")"
  PKD_OBJECTS_LDIF="$(absolute_path "${PKD_OBJECTS_LDIF}")"
  PKD_MASTER_LISTS_LDIF="$(absolute_path "${PKD_MASTER_LISTS_LDIF}")"

  if [[ "${SKIP_PKD_IMPORT}" == "false" ]]; then
    require_file "${PKD_OBJECTS_LDIF}"
    require_file "${PKD_MASTER_LISTS_LDIF}"
  fi

  if [[ "${SKIP_PKD_IMPORT}" == "true" ]]; then
    require_file "${PKD_BUNDLE_OUTPUT}"
  fi
}

generate_pkd_bundle_if_needed() {
  if [[ "${SKIP_PKD_IMPORT}" == "true" ]]; then
    log "Skipping PKD bundle generation and reusing ${PKD_BUNDLE_OUTPUT}."
    return
  fi

  mkdir -p "$(dirname "${PKD_BUNDLE_OUTPUT}")"

  if any_input_newer_than_output \
    "${PKD_BUNDLE_OUTPUT}" \
    "${PKD_OBJECTS_LDIF}" \
    "${PKD_MASTER_LISTS_LDIF}" \
    "${ROOT_DIR}/scripts/import-icao-pkd.ts" \
    "${ROOT_DIR}/apps/api/src/v1/verify/pkd-trust.ts"; then
    log "Generating ICAO PKD bundle..."
    bun run pkd:import \
      --objects "${PKD_OBJECTS_LDIF}" \
      --master-lists "${PKD_MASTER_LISTS_LDIF}" \
      --output "${PKD_BUNDLE_OUTPUT}"
    return
  fi

  log "Reusing existing ICAO PKD bundle at ${PKD_BUNDLE_OUTPUT}."
}

upload_pkd_bundle_to_remote_r2() {
  if [[ "${SKIP_R2_UPLOAD}" == "true" ]]; then
    log "Skipping remote R2 upload."
    return
  fi

  require_file "${PKD_BUNDLE_OUTPUT}"
  local segment_dir
  segment_dir="$(pkd_segment_dir_for_output "${PKD_BUNDLE_OUTPUT}")"

  (
    cd "${ROOT_DIR}/apps/api"
    if [[ -d "${segment_dir}" ]]; then
      for segment_file in "${segment_dir}"/*.json; do
        [[ -e "${segment_file}" ]] || continue
        local segment_name
        segment_name="$(basename "${segment_file}")"
        log "Uploading ICAO PKD DSC segment to remote R2 (${PKD_REMOTE_BUCKET_NAME}/verify/pkd-trust/dsc-country/${segment_name})..."
        bunx wrangler r2 object put \
          "${PKD_REMOTE_BUCKET_NAME}/verify/pkd-trust/dsc-country/${segment_name}" \
          --file "${segment_file}" \
          --remote
      done
    fi

    log "Uploading ICAO PKD manifest to remote R2 (${PKD_REMOTE_BUCKET_NAME}/${PKD_REMOTE_OBJECT_KEY})..."
    bunx wrangler r2 object put \
      "${PKD_REMOTE_BUCKET_NAME}/${PKD_REMOTE_OBJECT_KEY}" \
      --file "${PKD_BUNDLE_OUTPUT}" \
      --remote
  )
}

main() {
  parse_args "$@"
  validate_inputs
  generate_pkd_bundle_if_needed
  upload_pkd_bundle_to_remote_r2
  log "Production PKD seed complete."
}

main "$@"
