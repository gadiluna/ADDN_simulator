#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
mkdir -p "$COUNTING_DEPS"
if [[ ! -d "$COUNTING_DEPS/emsdk/.git" ]]; then
  git clone --depth 1 --branch "$COUNTING_EMSDK_VERSION" \
    https://github.com/emscripten-core/emsdk.git "$COUNTING_DEPS/emsdk"
fi
if [[ "$(git -C "$COUNTING_DEPS/emsdk" rev-parse HEAD)" != "$COUNTING_EMSDK_COMMIT" ]]; then
  echo 'Unexpected Emscripten SDK revision; restore the pinned local SDK.' >&2
  exit 1
fi
(cd "$COUNTING_DEPS/emsdk" && ./emsdk install "$COUNTING_EMSDK_VERSION" && ./emsdk activate "$COUNTING_EMSDK_VERSION")
export EMSDK_QUIET=1
source "$COUNTING_DEPS/emsdk/emsdk_env.sh"
COUNTING_WASM_GMP="$COUNTING_DEPS/gmp-wasm"
counting_build_gmp wasm
emcc --version
echo "Local GMP WebAssembly library: $COUNTING_WASM_GMP"
