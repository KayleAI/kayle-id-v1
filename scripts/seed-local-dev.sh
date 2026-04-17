#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INITIAL_WORKDIR="$(pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/postgres/compose.yml"
POSTGRES_PROJECT_NAME="kayle-id"
POSTGRES_SERVICE_NAME="postgres"
CAPNP_SCHEMA_FILE="${ROOT_DIR}/packages/capnp/verify.capnp"
CAPNP_TS_OUTPUT="${ROOT_DIR}/packages/capnp/generated/ts/verify.ts"
CAPNP_TS_JS_OUTPUT="${ROOT_DIR}/packages/capnp/generated/ts/verify.js"
CAPNP_TS_DTS_OUTPUT="${ROOT_DIR}/packages/capnp/generated/ts/verify.d.ts"
CAPNP_CPP_OUTPUT="${ROOT_DIR}/packages/capnp/generated/c/verify.capnp.c++"
CAPNPROTO_SWIFT_ROOT="${CAPNPROTO_SWIFT_PATH:-${HOME}/Work/capnproto-swift}"
CAPNPROTO_SWIFT_BIN="${CAPNPROTO_SWIFT_ROOT}/.build/xcframework/macosx/capnproto/c++/src/capnp/capnp"
PKD_OBJECTS_LDIF="${ICAO_PKD_OBJECTS_LDIF:-${HOME}/Downloads/icaopkd-001-complete-10023.ldif}"
PKD_MASTER_LISTS_LDIF="${ICAO_PKD_MASTER_LISTS_LDIF:-${HOME}/Downloads/icaopkd-002-complete-508.ldif}"
PKD_BUNDLE_OUTPUT="${PKD_BUNDLE_OUTPUT:-${ROOT_DIR}/temp/icao-pkd-bundle.json}"
PKD_LEGACY_LOCAL_ASSET_OUTPUT="${ROOT_DIR}/apps/api/public/verify/pkd-trust/latest.json"
PKD_LOCAL_BUCKET_NAME="${PKD_LOCAL_BUCKET_NAME:-kayle-id-r2}"
PKD_LOCAL_OBJECT_KEY="${PKD_LOCAL_OBJECT_KEY:-verify/pkd-trust/latest.json}"
SKIP_CAPNP="false"
SKIP_DB="false"
SKIP_PKD_IMPORT="false"
SKIP_R2_UPLOAD="false"

usage() {
  cat <<EOF
Usage:
  bash ./scripts/seed-local-dev.sh [options]

Options:
  --objects <path>          Path to the ICAO PKD objects LDIF.
  --master-lists <path>     Path to the ICAO PKD CSCA master-list LDIF.
  --output <path>           Output path for the generated PKD bundle JSON.
  --bucket <name>           Local R2 bucket name for PKD upload.
  --key <key>               Local R2 object key for PKD upload.
  --compose-file <path>     Docker Compose file for local Postgres.
  --project-name <name>     Docker Compose project name.
  --postgres-service <name> Docker Compose service name for Postgres.
  --capnp-swift-path <path> Root path to capnproto-swift.
  --skip-db                 Skip local Postgres startup and Drizzle migrations.
  --skip-capnp              Skip Cap'n Proto generation checks.
  --skip-pkd-import         Skip PKD bundle generation and reuse --output as-is.
  --skip-r2-upload          Skip uploading the PKD bundle to local R2.
  -h, --help                Show this help text.

Defaults:
  objects LDIF:      ${PKD_OBJECTS_LDIF}
  master-list LDIF:  ${PKD_MASTER_LISTS_LDIF}
  bundle output:     ${PKD_BUNDLE_OUTPUT}
  local R2 bucket:   ${PKD_LOCAL_BUCKET_NAME}
  local R2 key:      ${PKD_LOCAL_OBJECT_KEY}

Examples:
  bash ./scripts/seed-local-dev.sh \\
    --objects ./temp/icao-pkd-objects.ldif \\
    --master-lists ./temp/icao-pkd-master-lists.ldif \\
    --output ./temp/icao-pkd-bundle.json

  bash ./scripts/seed-local-dev.sh \\
    --output ./temp/icao-pkd-bundle.json \\
    --skip-pkd-import
EOF
}

log() {
  printf '[seed-local-dev] %s\n' "$1"
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
        PKD_LOCAL_BUCKET_NAME="$2"
        shift 2
        ;;
      --key)
        PKD_LOCAL_OBJECT_KEY="$2"
        shift 2
        ;;
      --compose-file)
        COMPOSE_FILE="$2"
        shift 2
        ;;
      --project-name)
        POSTGRES_PROJECT_NAME="$2"
        shift 2
        ;;
      --postgres-service)
        POSTGRES_SERVICE_NAME="$2"
        shift 2
        ;;
      --capnp-swift-path)
        CAPNPROTO_SWIFT_ROOT="$2"
        CAPNPROTO_SWIFT_BIN="${CAPNPROTO_SWIFT_ROOT}/.build/xcframework/macosx/capnproto/c++/src/capnp/capnp"
        shift 2
        ;;
      --skip-db)
        SKIP_DB="true"
        shift
        ;;
      --skip-capnp)
        SKIP_CAPNP="true"
        shift
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
  COMPOSE_FILE="$(absolute_path "${COMPOSE_FILE}")"
  PKD_BUNDLE_OUTPUT="$(absolute_path "${PKD_BUNDLE_OUTPUT}")"
  PKD_OBJECTS_LDIF="$(absolute_path "${PKD_OBJECTS_LDIF}")"
  PKD_MASTER_LISTS_LDIF="$(absolute_path "${PKD_MASTER_LISTS_LDIF}")"

  require_file "${CAPNP_SCHEMA_FILE}"
  require_file "${COMPOSE_FILE}"

  if [[ "${SKIP_PKD_IMPORT}" == "false" ]]; then
    require_file "${PKD_OBJECTS_LDIF}"
    require_file "${PKD_MASTER_LISTS_LDIF}"
  fi

  if [[ "${SKIP_PKD_IMPORT}" == "true" ]]; then
    require_file "${PKD_BUNDLE_OUTPUT}"
  fi
}

wait_for_postgres() {
  log "Waiting for Postgres to accept connections..."
  docker compose -p "${POSTGRES_PROJECT_NAME}" -f "${COMPOSE_FILE}" exec -T "${POSTGRES_SERVICE_NAME}" \
    bash -lc 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do sleep 0.2; done'
}

run_database_setup() {
  if [[ "${SKIP_DB}" == "true" ]]; then
    log "Skipping local Postgres startup and Drizzle migrations."
    return
  fi

  log "Starting local Postgres..."
  docker compose -p "${POSTGRES_PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d --remove-orphans
  wait_for_postgres

  log "Running database migrations..."
  (
    cd "${ROOT_DIR}/packages/database"
    bun run db:migrate
  )
}

generate_capnp_if_needed() {
  if [[ "${SKIP_CAPNP}" == "true" ]]; then
    log "Skipping Cap'n Proto generation checks."
    return
  fi

  local needs_ts_generation="false"
  local needs_cpp_generation="false"

  if any_input_newer_than_output "${CAPNP_TS_OUTPUT}" "${CAPNP_SCHEMA_FILE}" \
    || any_input_newer_than_output "${CAPNP_TS_JS_OUTPUT}" "${CAPNP_SCHEMA_FILE}" \
    || any_input_newer_than_output "${CAPNP_TS_DTS_OUTPUT}" "${CAPNP_SCHEMA_FILE}"; then
    needs_ts_generation="true"
  fi

  if any_input_newer_than_output "${CAPNP_CPP_OUTPUT}" "${CAPNP_SCHEMA_FILE}"; then
    needs_cpp_generation="true"
  fi

  if [[ "${needs_cpp_generation}" == "true" ]]; then
    if [[ ! -x "${CAPNPROTO_SWIFT_BIN}" ]]; then
      fail "Cap'n Proto C++ output is stale or missing, but the capnproto-swift compiler was not found at ${CAPNPROTO_SWIFT_BIN}."
    fi

    log "Generating Cap'n Proto TypeScript and C++ artifacts..."
    bash "${ROOT_DIR}/scripts/generate-capnp.sh"
    return
  fi

  if [[ "${needs_ts_generation}" == "true" ]]; then
    log "Generating Cap'n Proto TypeScript artifacts..."
    bash "${ROOT_DIR}/scripts/generate-capnp-ts.sh"
    return
  fi

  log "Cap'n Proto artifacts are up to date."
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

remove_legacy_local_pkd_asset() {
  if [[ ! -f "${PKD_LEGACY_LOCAL_ASSET_OUTPUT}" ]]; then
    return
  fi

  rm -f "${PKD_LEGACY_LOCAL_ASSET_OUTPUT}"
  log "Removed legacy PKD asset copy at ${PKD_LEGACY_LOCAL_ASSET_OUTPUT}; local development now relies on R2 only."
}

upload_pkd_bundle_to_local_r2() {
  if [[ "${SKIP_R2_UPLOAD}" == "true" ]]; then
    log "Skipping local R2 upload."
    return
  fi

  require_file "${PKD_BUNDLE_OUTPUT}"

  log "Uploading ICAO PKD bundle to local R2 (${PKD_LOCAL_BUCKET_NAME}/${PKD_LOCAL_OBJECT_KEY})..."
  (
    cd "${ROOT_DIR}/apps/api"
    bunx wrangler r2 object put \
      "${PKD_LOCAL_BUCKET_NAME}/${PKD_LOCAL_OBJECT_KEY}" \
      --file "${PKD_BUNDLE_OUTPUT}" \
      --local
  )
}

main() {
  parse_args "$@"
  validate_inputs
  run_database_setup
  generate_capnp_if_needed
  generate_pkd_bundle_if_needed
  remove_legacy_local_pkd_asset
  upload_pkd_bundle_to_local_r2
  log "Local development seed complete."
}

main "$@"
