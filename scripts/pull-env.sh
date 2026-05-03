#!/usr/bin/env bash
set -euo pipefail

# Refresh the repo-root .env from Infisical.
#
# Usage:
#   bun run env:pull               # pull the dev environment
#   bun run env:pull -- prod       # pull a different environment
#
# Requires:
#   - The Infisical CLI installed (https://infisical.com/docs/cli/overview).
#   - `infisical login` already run on this machine.
#   - .infisical.json at the repo root pinning the workspace.
#
# Outsiders without Infisical access should run `bun run env:setup` instead.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PATH="${ROOT_DIR}/.env"
ENV_NAME="${1:-dev}"

log() {
  printf '[pull-env] %s\n' "$1"
}

fail() {
  printf '[pull-env] %s\n' "$1" >&2
  exit 1
}

if ! command -v infisical >/dev/null 2>&1; then
  fail "infisical CLI not found. Install it from https://infisical.com/docs/cli/overview, or run \`bun run env:setup\` for a contributor bootstrap."
fi

if [[ -f "${ENV_PATH}" ]]; then
  log "Overwriting existing ${ENV_PATH}."
fi

cd "${ROOT_DIR}"

log "Pulling Infisical secrets for env=${ENV_NAME}..."
infisical export --env="${ENV_NAME}" --format=dotenv > "${ENV_PATH}"

# Lock the file down — these are real secrets when pulled by a maintainer.
chmod 600 "${ENV_PATH}"

log "Wrote ${ENV_PATH} (mode 600)."
