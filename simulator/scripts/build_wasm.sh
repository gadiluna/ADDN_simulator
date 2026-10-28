#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
if [[ ! -f "$COUNTING_DEPS/gmp-wasm/lib/libgmp.a" || ! -f "$COUNTING_DEPS/emsdk/.emscripten" ]]; then
  bash "$COUNTING_SIM_ROOT/scripts/bootstrap_wasm.sh"
fi
export EMSDK_QUIET=1
source "$COUNTING_DEPS/emsdk/emsdk_env.sh"
emcmake cmake -S "$COUNTING_SIM_ROOT/c" -B "$COUNTING_SIM_ROOT/c/build-wasm" \
  -DCMAKE_BUILD_TYPE=Release -DCOUNTING_GMP_ROOT="$COUNTING_DEPS/gmp-wasm" "$@"
cmake --build "$COUNTING_SIM_ROOT/c/build-wasm" -j"$(counting_jobs)"
mkdir -p "$COUNTING_SIM_ROOT/web/public"
cp "$COUNTING_SIM_ROOT/c/build-wasm/engine.mjs" "$COUNTING_SIM_ROOT/web/public/engine.mjs"
cp "$COUNTING_SIM_ROOT/c/build-wasm/engine.wasm" "$COUNTING_SIM_ROOT/web/public/engine.wasm"
echo 'WebAssembly assets copied to simulator/web/public.'
