#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
counting_prepare_cmake
COUNTING_BUILD_DIR="${COUNTING_BUILD_DIR:-$COUNTING_SIM_ROOT/c/build}"
COUNTING_CMAKE_ARGS=()
if [[ -n "${COUNTING_GMP_ROOT:-}" ]]; then
  COUNTING_CMAKE_ARGS+=("-DCOUNTING_GMP_ROOT=$COUNTING_GMP_ROOT")
elif ! pkg-config --exists gmp 2>/dev/null && [[ ! -f /opt/homebrew/include/gmp.h && ! -f /usr/include/gmp.h && ! -f /usr/include/x86_64-linux-gnu/gmp.h ]]; then
  COUNTING_NATIVE_GMP="$COUNTING_DEPS/gmp-native"
  counting_build_gmp native
  COUNTING_CMAKE_ARGS+=("-DCOUNTING_GMP_ROOT=$COUNTING_NATIVE_GMP")
fi
cmake -S "$COUNTING_SIM_ROOT/c" -B "$COUNTING_BUILD_DIR" \
  -DCMAKE_BUILD_TYPE="${COUNTING_BUILD_TYPE:-Release}" "${COUNTING_CMAKE_ARGS[@]}" "$@"
cmake --build "$COUNTING_BUILD_DIR" -j"$(counting_jobs)"
