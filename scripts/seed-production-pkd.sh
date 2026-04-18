#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INITIAL_WORKDIR="$(pwd)"
PKD_OBJECTS_LDIF="${ICAO_PKD_OBJECTS_LDIF:-${ROOT_DIR}/temp/icaopkd-001-complete-10023.ldif}"
PKD_MASTER_LISTS_LDIF="${ICAO_PKD_MASTER_LISTS_LDIF:-${ROOT_DIR}/temp/icaopkd-002-complete-508.ldif}"
PKD_BUNDLE_OUTPUT="${PKD_BUNDLE_OUTPUT:-${ROOT_DIR}/temp/icao-pkd-trust-store.sql}"
TRUST_STORE_DATABASE_NAME="${TRUST_STORE_DATABASE_NAME:-kayle-id-trust-store}"
SKIP_PKD_IMPORT="false"
SKIP_D1_SEED="false"

usage() {
  cat <<EOF
Usage:
  bash ./scripts/seed-production-pkd.sh [options]

Options:
  --objects <path>       Path to the ICAO PKD objects LDIF.
  --master-lists <path>  Path to the ICAO PKD CSCA master-list LDIF.
  --output <path>        Output path for the generated trust-store seed SQL.
  --database <name>      Remote D1 database name for trust-store seeding.
  --skip-pkd-import      Skip PKD bundle generation and reuse --output as-is.
  --skip-d1-seed         Skip applying migrations and importing the trust-store seed into remote D1.
  -h, --help             Show this help text.

Defaults:
  objects LDIF:      ${PKD_OBJECTS_LDIF}
  master-list LDIF:  ${PKD_MASTER_LISTS_LDIF}
  seed output:       ${PKD_BUNDLE_OUTPUT}
  remote D1 DB:      ${TRUST_STORE_DATABASE_NAME}

Example:
  bash ./scripts/seed-production-pkd.sh \\
    --objects ./temp/icao-pkd-objects.ldif \\
    --master-lists ./temp/icao-pkd-master-lists.ldif \\
    --output ./temp/icao-pkd-trust-store.sql
EOF
}

log() {
  printf '[seed-production-pkd] %s\n' "$1"
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

cleanup_temp_log() {
  local log_file="$1"

  if [[ -n "${log_file}" && -f "${log_file}" ]]; then
    rm -f "${log_file}"
  fi
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
      --database)
        TRUST_STORE_DATABASE_NAME="$2"
        shift 2
        ;;
      --skip-pkd-import)
        SKIP_PKD_IMPORT="true"
        shift
        ;;
      --skip-d1-seed)
        SKIP_D1_SEED="true"
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

seed_remote_trust_store() {
  if [[ "${SKIP_D1_SEED}" == "true" ]]; then
    log "Skipping remote D1 trust-store seed."
    return
  fi

  require_file "${PKD_BUNDLE_OUTPUT}"

  local execute_log_file=""
  execute_log_file="$(mktemp)"

  (
    cd "${ROOT_DIR}/apps/api"
    log "Applying remote trust-store migrations..."
    bunx wrangler d1 migrations apply \
      "${TRUST_STORE_DATABASE_NAME}" \
      --config ./wrangler.jsonc \
      --remote
    log "Importing ICAO PKD trust-store seed into remote D1..."
    if ! bunx wrangler d1 execute \
      "${TRUST_STORE_DATABASE_NAME}" \
      --config ./wrangler.jsonc \
      --file "${PKD_BUNDLE_OUTPUT}" \
      --remote \
      >"${execute_log_file}" 2>&1; then
      cat "${execute_log_file}" >&2
      cleanup_temp_log "${execute_log_file}"
      fail "Remote D1 trust-store seed import failed."
    fi
  )

  local execute_summary=""
  execute_summary="$(
    LC_ALL=C grep -Eo '🚣 [0-9]+ commands executed successfully\.' \
      "${execute_log_file}" \
      | tail -n 1
  )"

  if [[ -n "${execute_summary}" ]]; then
    log "${execute_summary}"
  else
    log "Remote D1 trust-store seed import completed."
  fi

  cleanup_temp_log "${execute_log_file}"
}

main() {
  parse_args "$@"
  validate_inputs
  generate_pkd_bundle_if_needed
  seed_remote_trust_store
  log "Production PKD seed complete."
}

main "$@"
