#!/usr/bin/env bash
#
# Regenerate verify.capnp bindings (TypeScript + C++) using a `capnp` toolchain
# whose major version matches what's bundled in `Capnp.xcframework` shipped by
# the `arsenstorm/capnproto-swift` package. Mismatched generators emit code
# the bundled library headers won't compile (different macros, different
# CAPNP_VERSION constant).
#
# Resolution order for the `capnp` binary, first match wins:
#   1. $CAPNP_BIN env var, if set and executable.
#   2. Cached build at packages/capnp/.bin/capnp matching the pinned commit.
#   3. `capnp` on PATH if its major version matches REQUIRED_MAJOR.
#   4. Otherwise: clone upstream Cap'n Proto at the pinned commit and build
#      `capnp` + `capnpc-c++` into the cache. Requires git, cmake, make, c++.
#
# The cache lives under `packages/capnp/.bin/` and is gitignored. First run
# from source takes ~2 minutes; subsequent runs are instant.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
CACHE_DIR="$ROOT_DIR/.bin"
SCHEMA="$ROOT_DIR/verify.capnp"

# Pinned to the upstream commit currently bundled in
# arsenstorm/capnproto-swift's xcframework. Bump this in lockstep with that
# package's xcframework rebuild so generated code and library headers stay
# in sync.
PINNED_COMMIT="928bac4f2544489601be6f833011e77e0cf6242b"
PINNED_REPO="https://github.com/capnproto/capnproto.git"
REQUIRED_MAJOR="2"

NODE_BIN_DIR="$REPO_ROOT/node_modules/.bin"

log() { printf '[capnp:regen] %s\n' "$*" >&2; }

build_capnp_from_source() {
	for cmd in cmake git make c++; do
		if ! command -v "$cmd" >/dev/null 2>&1; then
			cat >&2 <<EOF
[capnp:regen] missing required tool: $cmd

To regenerate Cap'n Proto bindings without a system 'capnp', install:
  macOS:  xcode-select --install && brew install cmake
  Debian: sudo apt-get install -y build-essential cmake git

Or set CAPNP_BIN to a capnp $REQUIRED_MAJOR.x binary you already have.
EOF
			exit 1
		fi
	done

	log "Building Cap'n Proto compiler from source at $PINNED_COMMIT (one-time, ~2 min)..."
	local tmp_dir
	tmp_dir="$(mktemp -d)"
	# Always clean the temp dir, even on error.
	# shellcheck disable=SC2064
	trap "rm -rf '$tmp_dir'" RETURN

	git clone --quiet --no-checkout "$PINNED_REPO" "$tmp_dir/capnproto" >&2
	(cd "$tmp_dir/capnproto" && git checkout --quiet "$PINNED_COMMIT")

	(
		cd "$tmp_dir/capnproto/c++"
		cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF >/dev/null
		cmake --build build --target capnp_tool capnpc_cpp -j >&2
	)

	mkdir -p "$CACHE_DIR"
	cp "$tmp_dir/capnproto/c++/build/src/capnp/capnp" "$CACHE_DIR/capnp"
	cp "$tmp_dir/capnproto/c++/build/src/capnp/capnpc-c++" "$CACHE_DIR/capnpc-c++"
	echo "$PINNED_COMMIT" >"$CACHE_DIR/.commit"
	log "Cached toolchain at $CACHE_DIR"
}

resolve_capnp() {
	if [[ -n "${CAPNP_BIN:-}" && -x "${CAPNP_BIN:-}" ]]; then
		printf '%s\n' "$CAPNP_BIN"
		return
	fi

	if [[ -x "$CACHE_DIR/capnp" && -x "$CACHE_DIR/capnpc-c++" ]] \
		&& [[ -f "$CACHE_DIR/.commit" ]] \
		&& [[ "$(cat "$CACHE_DIR/.commit")" == "$PINNED_COMMIT" ]]; then
		printf '%s\n' "$CACHE_DIR/capnp"
		return
	fi

	if command -v capnp >/dev/null 2>&1; then
		local current_major
		current_major="$(capnp --version 2>&1 | grep -oE '[0-9]+' | head -1 || true)"
		if [[ "$current_major" == "$REQUIRED_MAJOR" ]]; then
			printf '%s\n' "$(command -v capnp)"
			return
		fi
		log "found 'capnp' on PATH but major version is '$current_major', need $REQUIRED_MAJOR — falling through to source build"
	fi

	build_capnp_from_source
	printf '%s\n' "$CACHE_DIR/capnp"
}

CAPNP="$(resolve_capnp)"
CAPNP_DIR="$(dirname "$CAPNP")"
export PATH="$CAPNP_DIR:$PATH"

if [[ ! -d "$NODE_BIN_DIR" ]]; then
	log "node_modules/.bin not found at $NODE_BIN_DIR — run 'bun install' first."
	exit 1
fi

cd "$ROOT_DIR"
"$CAPNP" compile -o c++:./generated/c "$SCHEMA"
"$CAPNP" compile -o "$NODE_BIN_DIR/capnpc-ts:./generated/ts" "$SCHEMA"
"$CAPNP" compile -o "$NODE_BIN_DIR/capnpc-js:./generated/ts" "$SCHEMA"
"$CAPNP" compile -o "$NODE_BIN_DIR/capnpc-dts:./generated/ts" "$SCHEMA"

log "regenerated bindings via $CAPNP"
