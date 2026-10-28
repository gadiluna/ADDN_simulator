#!/usr/bin/env bash
# Shared local dependency paths. Sourcing this file never alters shell startup files.
set -euo pipefail
COUNTING_SIM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNTING_DEPS="$COUNTING_SIM_ROOT/.deps"
COUNTING_GMP_VERSION=6.3.0
COUNTING_GMP_SHA256=a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898
COUNTING_EMSDK_VERSION=4.0.15
COUNTING_EMSDK_COMMIT=389a68bc35dcff7ebae4614e1615099dafda00d1
COUNTING_CMAKE_VERSION=3.31.8
COUNTING_M4_VERSION=1.4.19
COUNTING_M4_SHA256=63aede5c6d33b6d9b13511cd0be2cac046f2e70fd0a07aa9573a04a82783af96

counting_prepare_m4() {
  if command -v m4 >/dev/null 2>&1; then return; fi
  local prefix="$COUNTING_DEPS/m4-native"
  if [[ ! -x "$prefix/bin/m4" ]]; then
    mkdir -p "$COUNTING_DEPS"
    local archive="$COUNTING_DEPS/m4-$COUNTING_M4_VERSION.tar.xz"
    curl --fail --location --retry 3 \
      "https://ftp.gnu.org/gnu/m4/m4-$COUNTING_M4_VERSION.tar.xz" -o "$archive"
    python3 - "$archive" "$COUNTING_M4_SHA256" <<'PY'
from pathlib import Path
import hashlib, sys
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit('GNU m4 archive checksum mismatch')
PY
    if [[ ! -d "$COUNTING_DEPS/m4-$COUNTING_M4_VERSION" ]]; then tar -xf "$archive" -C "$COUNTING_DEPS"; fi
    local staging
    staging="$(mktemp -d "${TMPDIR:-/tmp}/counting-m4.XXXXXX")"
    ln -s "$COUNTING_DEPS/m4-$COUNTING_M4_VERSION" "$staging/src"
    mkdir -p "$staging/build"
    (cd "$staging/build" && "$staging/src/configure" --prefix="$staging/install" CFLAGS='-O2 -std=gnu17' && \
      make -j"$(counting_jobs)" && make install)
    mkdir -p "$prefix"
    cp -R "$staging/install/." "$prefix/"
    rm -rf "$staging"
  fi
  export PATH="$prefix/bin:$PATH"
}

counting_prepare_cmake() {
  if command -v cmake >/dev/null 2>&1; then return; fi
  if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    echo 'CMake is required on this platform; Linux x86_64 has an automatic local fallback.' >&2
    return 1
  fi
  local package="cmake-$COUNTING_CMAKE_VERSION-linux-x86_64"
  local base="https://cmake.org/files/v${COUNTING_CMAKE_VERSION%.*}"
  if [[ ! -x "$COUNTING_DEPS/$package/bin/cmake" ]]; then
    mkdir -p "$COUNTING_DEPS"
    curl --fail --location --retry 3 "$base/$package.tar.gz" -o "$COUNTING_DEPS/$package.tar.gz"
    curl --fail --location --retry 3 "$base/cmake-$COUNTING_CMAKE_VERSION-SHA-256.txt" -o "$COUNTING_DEPS/cmake-checksums.txt"
    python3 - "$COUNTING_DEPS/$package.tar.gz" "$COUNTING_DEPS/cmake-checksums.txt" <<'PY'
from pathlib import Path
import hashlib, sys
archive, manifest = map(Path, sys.argv[1:])
expected = next((line.split()[0] for line in manifest.read_text().splitlines()
                 if len(line.split()) == 2 and line.split()[1].lstrip('*') == archive.name), None)
if expected is None or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Official CMake archive checksum verification failed')
PY
    tar -xzf "$COUNTING_DEPS/$package.tar.gz" -C "$COUNTING_DEPS"
  fi
  export PATH="$COUNTING_DEPS/$package/bin:$PATH"
}

counting_jobs() {
  python3 -c 'import os; print(max(1,min(4,(os.cpu_count() or 2)//2)))'
}

counting_gmp_source() {
  mkdir -p "$COUNTING_DEPS"
  local archive="$COUNTING_DEPS/gmp-$COUNTING_GMP_VERSION.tar.xz"
  if [[ ! -f "$archive" ]]; then
    curl --fail --location --retry 3 \
      "https://ftp.gnu.org/gnu/gmp/gmp-$COUNTING_GMP_VERSION.tar.xz" -o "$archive.part"
    mv "$archive.part" "$archive"
  fi
  python3 - "$archive" "$COUNTING_GMP_SHA256" <<'PY'
import hashlib, pathlib, sys
p = pathlib.Path(sys.argv[1])
actual = hashlib.sha256(p.read_bytes()).hexdigest()
if actual != sys.argv[2]:
    raise SystemExit(f"GMP archive checksum mismatch: {actual}; delete {p} and retry")
PY
  if [[ ! -d "$COUNTING_DEPS/gmp-$COUNTING_GMP_VERSION" ]]; then
    tar -xf "$archive" -C "$COUNTING_DEPS"
  fi
}

counting_build_gmp() {
  local kind="$1"
  local prefix="$COUNTING_DEPS/gmp-$kind"
  if [[ -f "$prefix/lib/libgmp.a" ]]; then return; fi
  counting_prepare_m4
  counting_gmp_source
  # GMP's bundled config.sub/libtool do not support whitespace in source/build
  # paths. A temporary source alias and build directory keep this workspace safe.
  local staging
  staging="$(mktemp -d "${TMPDIR:-/tmp}/counting-gmp.XXXXXX")"
  ln -s "$COUNTING_DEPS/gmp-$COUNTING_GMP_VERSION" "$staging/src"
  mkdir -p "$staging/build"
  if [[ "$kind" == wasm ]]; then
    (cd "$staging/build" && \
      emconfigure "$staging/src/configure" --host=none --disable-assembly \
        --disable-shared --enable-static --prefix="$staging/install" \
        CC=emcc CXX=em++ CXXCPP='em++ -E' HOST_CC=cc AR=emar RANLIB=emranlib CFLAGS=-O2 && \
      emmake make -j"$(counting_jobs)" && emmake make install)
  else
    (cd "$staging/build" && \
      "$staging/src/configure" --disable-shared --enable-static --prefix="$staging/install" && \
      make -j"$(counting_jobs)" && make install)
  fi
  mkdir -p "$prefix"
  cp -R "$staging/install/." "$prefix/"
  python3 - "$prefix" "$staging/install" <<'PY'
from pathlib import Path
import sys
prefix = Path(sys.argv[1])
for pattern in ('*.la', '*.pc'):
    for p in prefix.rglob(pattern):
        p.write_text(p.read_text().replace(sys.argv[2], str(prefix)))
PY
  rm -rf "$staging"
}
