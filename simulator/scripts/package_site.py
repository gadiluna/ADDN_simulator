#!/usr/bin/env python3
"""Package notices and LGPL relinking materials for the browser deployment.

Run after npm ci and build_wasm.sh, before the Vite production build. Only
explicitly named inputs are published; no build cache or source tree is copied.
"""
from __future__ import annotations

import gzip
import hashlib
import html
import io
import json
from pathlib import Path
import tarfile


SIM = Path(__file__).resolve().parents[1]
GMP_VERSION = "6.3.0"
GMP_HASH = "a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898"
EMSDK_VERSION = "4.0.15"
EMSDK_COMMIT = "389a68bc35dcff7ebae4614e1615099dafda00d1"
EXPORTS = "['_sim_create','_sim_step','_sim_snapshot','_sim_summary','_sim_destroy','_sim_free_string','_sim_last_error','_sim_audit_json','_malloc','_free']"
RUNTIME_EXPORTS = "['ccall','UTF8ToString','HEAPU8']"

APPLICATION_TERMS = """Application object files for GMP relinking

The application object files supplied in engine-relink.tar.gz are Corresponding
Application Code for section 4(d)(0) of the GNU Lesser General Public License,
version 3. Permission is granted to use, reproduce, and redistribute these
object files to recombine or relink the application with an interface-compatible
modified version of GMP, and to produce and use the resulting combined work.
Modification of the GMP portions of that combined work, and reverse engineering
for debugging such modifications, are permitted.

This permission applies to the supplied relinking materials. It does not assign
an open-source license to other application code or to any research manuscript.
GMP and the other third-party components retain their respective licenses.
"""

BUILD_GMP = r'''#!/usr/bin/env bash
set -euo pipefail
bundle="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(emcc --version)" in *4.0.15*) ;; *) echo 'Activate Emscripten 4.0.15 first.' >&2; exit 1;; esac
work="$(mktemp -d "${TMPDIR:-/tmp}/counting-relink.XXXXXX")"
trap 'rm -rf "$work"' EXIT
if [[ -n "${GMP_SOURCE_DIR:-}" ]]; then
  source_dir="$(cd "$GMP_SOURCE_DIR" && pwd)"
else
  python3 - "$bundle/gmp-6.3.0.tar.xz" <<'PY'
import hashlib, pathlib, sys
if hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() != 'a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898':
    raise SystemExit('GMP source archive checksum mismatch')
PY
  tar -xf "$bundle/gmp-6.3.0.tar.xz" -C "$work"
  source_dir="$work/gmp-6.3.0"
fi
ln -s "$source_dir" "$work/src"
mkdir "$work/build"
(
  cd "$work/build"
  emconfigure "$work/src/configure" --host=none --disable-assembly \
    --disable-shared --enable-static --prefix="$work/install" \
    CC=emcc CXX=em++ CXXCPP='em++ -E' HOST_CC=cc AR=emar RANLIB=emranlib CFLAGS=-O2
  emmake make -j"${COUNTING_JOBS:-2}"
  emmake make install
)
mkdir -p "$bundle/gmp-install"
cp -R "$work/install/." "$bundle/gmp-install/"
echo 'GMP is ready in gmp-install/. Run bash relink.sh next.'
'''

RELINK = r'''#!/usr/bin/env bash
set -euo pipefail
bundle="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(emcc --version)" in *4.0.15*) ;; *) echo 'Activate Emscripten 4.0.15 first.' >&2; exit 1;; esac
gmp_prefix="${1:-$bundle/gmp-install}"
output="${2:-$bundle/output}"
[[ -f "$gmp_prefix/lib/libgmp.a" ]] || { echo 'Build GMP first, or pass its installation prefix.' >&2; exit 1; }
mkdir -p "$output"
emcc -O3 -DNDEBUG "$bundle/application/wasm.c.o" \
  "$bundle/application/libcounting_engine.a" "$gmp_prefix/lib/libgmp.a" \
  --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576 \
  "-sEXPORTED_FUNCTIONS=__EXPORTS__" \
  "-sEXPORTED_RUNTIME_METHODS=__RUNTIME_EXPORTS__" \
  -o "$output/engine.mjs"
echo 'Relinked engine.mjs and engine.wasm are ready in the output directory.'
'''.replace("__EXPORTS__", EXPORTS).replace("__RUNTIME_EXPORTS__", RUNTIME_EXPORTS)

BUNDLE_README = f"""Counting simulator: GMP source and engine relinking

This bundle accompanies the deployed engine.mjs and engine.wasm. The manifest
identifies those files and the exact application objects by SHA-256. It includes
the unmodified GMP {GMP_VERSION} source archive, its license texts, and compiled
application object files suitable for linking with a modified GMP library.
No research manuscript or private build configuration is included.

Prerequisites: Bash, Python 3, GNU make, a native C compiler, GNU m4, tar with xz
support, Git, and Emscripten {EMSDK_VERSION}. A normal Linux or macOS development
environment is suitable. Activate the pinned toolchain in the current shell:

  git clone --depth 1 --branch {EMSDK_VERSION} https://github.com/emscripten-core/emsdk.git
  git -C emsdk rev-parse HEAD

The revision must be {EMSDK_COMMIT}. Then:

  ./emsdk/emsdk install {EMSDK_VERSION}
  ./emsdk/emsdk activate {EMSDK_VERSION}
  source ./emsdk/emsdk_env.sh

From the directory containing this README, build and relink the unmodified GMP:

  bash build-gmp.sh
  bash relink.sh

To modify GMP, extract gmp-6.3.0.tar.xz into a separate directory, make your
changes, and rebuild with that directory selected:

  GMP_SOURCE_DIR=/path/to/modified/gmp-6.3.0 bash build-gmp.sh
  bash relink.sh

Alternatively, pass an existing compatible WebAssembly GMP installation prefix
and an output directory to relink.sh. The exported API, memory growth, stack
size, optimization, and module settings match the published CMake build.
Application objects were built for the pinned Emscripten toolchain. A different
toolchain or an incompatible GMP interface can require rebuilding the application.

Serve the resulting output/engine.mjs and output/engine.wasm together over HTTP
or HTTPS. To use them with a local copy of the simulator, replace the two files
in simulator/web/public/, then build the site normally. The browser loads GMP
as part of this WebAssembly engine; no signatures or installation keys prevent
using a modified engine. Reload the page to create a fresh worker/engine instance.

Read APPLICATION-RELINKING.txt for the application object permissions,
COPYING.LESSERv3 and COPYINGv3 for GMP's LGPL route, and COPYINGv2 for its
alternative GPLv2 route. The GMP archive retains the upstream copyright notices
and licensing for its auxiliary programs. GNU GMP is provided without warranty.
"""


def read_required(path: Path) -> bytes:
    if not path.is_file():
        raise SystemExit(f"Required publication input is missing: {path.relative_to(SIM)}")
    return path.read_bytes()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def package() -> None:
    deps = SIM / ".deps"
    public = SIM / "web/public"
    build = SIM / "c/build-wasm"
    sdk = deps / "emsdk/upstream/emscripten"
    common = read_required(SIM / "scripts/common.sh").decode()
    for name, value in {"GMP_VERSION": GMP_VERSION, "GMP_SHA256": GMP_HASH,
                        "EMSDK_VERSION": EMSDK_VERSION, "EMSDK_COMMIT": EMSDK_COMMIT}.items():
        if f"COUNTING_{name}={value}\n" not in common:
            raise SystemExit(f"Update packaging instructions for the changed {name}.")
    cmake = read_required(SIM / "c/CMakeLists.txt").decode()
    for setting in [f"-sEXPORTED_FUNCTIONS={EXPORTS}", f"-sEXPORTED_RUNTIME_METHODS={RUNTIME_EXPORTS}",
                    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web,worker,node",
                    "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=1048576", "--no-entry"]:
        if setting not in cmake:
            raise SystemExit(f"Relinking instructions do not match CMake setting: {setting}")

    gmp_archive = read_required(deps / f"gmp-{GMP_VERSION}.tar.xz")
    if digest(gmp_archive) != GMP_HASH:
        raise SystemExit("GMP source archive SHA-256 does not match the pinned release.")
    notices: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(gmp_archive), mode="r:xz") as source:
        for name in ["COPYING.LESSERv3", "COPYINGv3", "COPYINGv2"]:
            entry = source.extractfile(f"gmp-{GMP_VERSION}/{name}")
            if entry is None:
                raise SystemExit(f"GMP archive is missing {name}.")
            notices[name] = entry.read()

    components = []
    for name in ["react", "react-dom", "scheduler", "cytoscape"]:
        directory = SIM / "web/node_modules" / name
        metadata = json.loads(read_required(directory / "package.json"))
        filename = f"{name}-LICENSE.txt"
        notices[filename] = read_required(directory / "LICENSE")
        components.append((name, metadata["version"], filename))
    for name, relative in [("Emscripten-LICENSE.txt", "LICENSE"),
                           ("musl-COPYRIGHT.txt", "system/lib/libc/musl/COPYRIGHT"),
                           ("compiler-rt-LICENSE.txt", "system/lib/compiler-rt/LICENSE.TXT")]:
        notices[name] = read_required(sdk / relative)

    objects = {
        "application/libcounting_engine.a": read_required(build / "libcounting_engine.a"),
        "application/wasm.c.o": read_required(build / "CMakeFiles/engine.dir/src/wasm.c.o"),
    }
    # Release objects should not contain the publisher's workspace location.
    for name, content in objects.items():
        if str(SIM.parent).encode() in content:
            raise SystemExit(f"{name} embeds the build location; rebuild with file-prefix mapping.")
    assets = {}
    for name in ["engine.mjs", "engine.wasm"]:
        assets[name] = read_required(public / name)
        if assets[name] != read_required(build / name):
            raise SystemExit(f"public/{name} does not match the current WebAssembly build.")
    manifest = {
        "schema_version": 1,
        "emscripten": {"version": EMSDK_VERSION, "sdk_commit": EMSDK_COMMIT},
        "gmp": {"version": GMP_VERSION, "source_sha256": GMP_HASH},
        "sha256": {name: digest(data) for name, data in {**assets, **objects}.items()},
        "javascript_components": {name: version for name, version, _ in components},
    }
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode()
    bundle_files = {
        **objects,
        **{name: notices[name] for name in ["COPYING.LESSERv3", "COPYINGv3", "COPYINGv2"]},
        f"gmp-{GMP_VERSION}.tar.xz": gmp_archive,
        "APPLICATION-RELINKING.txt": APPLICATION_TERMS.encode(),
        "README.txt": BUNDLE_README.encode(),
        "manifest.json": manifest_bytes,
        "build-gmp.sh": BUILD_GMP.encode(),
        "relink.sh": RELINK.encode(),
    }
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode="wb", filename="", mtime=0) as stream:
        with tarfile.open(fileobj=stream, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(bundle_files.items()):
                entry = tarfile.TarInfo(f"engine-relink/{name}")
                entry.size, entry.mtime = len(data), 0
                entry.mode = 0o755 if name.endswith(".sh") else 0o644
                archive.addfile(entry, io.BytesIO(data))

    component_links = "\n".join(f'<li>{html.escape(name)} {html.escape(version)} — <a href="{filename}">MIT license</a></li>'
                                for name, version, filename in components)
    notice_html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Licenses and engine relinking · Counting</title>
<style>body{{max-width:64rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.7 system-ui,sans-serif;color:#172336}}a{{color:#1d4ed8}}h1,h2{{line-height:1.3}}code{{overflow-wrap:anywhere}}li{{margin:.35rem 0}}</style></head>
<body><a href="../">Back to the simulator</a><h1>Licenses and engine relinking</h1>
<p>The WebAssembly counting engine uses GNU GMP {GMP_VERSION} for exact arithmetic.
GMP is available under GNU LGPL version 3 or later, or alternatively GNU GPL version 2 or later, and is provided without warranty.</p>
<ul><li><a href="COPYING.LESSERv3">GNU LGPLv3</a> and <a href="COPYINGv3">GNU GPLv3</a></li>
<li><a href="COPYINGv2">Alternative GNU GPLv2 license</a></li>
<li><a href="gmp-{GMP_VERSION}.tar.xz">Exact GMP {GMP_VERSION} source archive</a></li>
<li><a href="engine-relink.tar.gz">Engine relinking bundle</a> — GMP source, application object files, and build instructions</li>
<li><a href="APPLICATION-RELINKING.txt">Application object permissions</a> and <a href="manifest.json">version and SHA-256 manifest</a></li></ul>
<p>The relinking bundle lets you rebuild the engine with a modified, compatible GMP library. Its permissions apply to those materials; they do not assign a project-wide license.</p>
<h2>JavaScript components</h2><ul>{component_links}</ul>
<h2>WebAssembly toolchain runtime</h2><ul>
<li><a href="Emscripten-LICENSE.txt">Emscripten {EMSDK_VERSION} license</a></li>
<li><a href="musl-COPYRIGHT.txt">musl copyright and license notices</a></li>
<li><a href="compiler-rt-LICENSE.txt">LLVM compiler-rt license</a></li></ul>
</body></html>\n"""
    output = public / "licenses"
    output.mkdir(parents=True, exist_ok=True)
    for name, data in {**notices, f"gmp-{GMP_VERSION}.tar.xz": gmp_archive,
                       "engine-relink.tar.gz": compressed.getvalue(), "manifest.json": manifest_bytes,
                       "APPLICATION-RELINKING.txt": APPLICATION_TERMS.encode(),
                       "index.html": notice_html.encode()}.items():
        temporary = output / f".{name}.tmp"
        temporary.write_bytes(data)
        temporary.replace(output / name)
    print(f"Published notices and relinking materials: simulator/web/public/licenses ({len(compressed.getvalue())} bundle bytes)")


if __name__ == "__main__":
    package()
