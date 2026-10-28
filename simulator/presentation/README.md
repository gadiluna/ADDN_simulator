# STOC lemma demonstrations

This branch adds a presentation mode with a checked example for each of the
paper's 16 numbered lemmas and a bonus comparison of the lower-bound networks.
The main simulator remains available at the normal URL.

## Watch and present

Start the web app as usual, then open
`http://127.0.0.1:4180/?presentation=1` (using the port chosen below).
Choose a lemma and press Play, or use the arrow keys to advance one step.
The full-screen view is suitable for live explanation. The proof connection
and checked facts are available below the illustration.

```sh
cd simulator/web
npm ci
npm run dev -- --port 4180 --strictPort
```

For the slide-ready media, open [the offline clip gallery](recordings/index.html).
Every MP4 is 1920 × 1080, H.264, 30 fps, silent, with English annotations already
visible. Insert the MP4 as a video in PowerPoint or Keynote. The adjacent SRT
files contain editable caption text; the JPG files are still-image alternatives.

[STORYBOARD.md](STORYBOARD.md) maps every clip to its paper label and explains
the general proof mechanism. The suggested main-talk sequence is flat level,
credit refinement, credit loss, tail exposure, short audit, then the paired
lower bound. The other clips are available for detailed discussion or backup.
For a talk focused on network-wise complexity, follow lemmas 9 through 16.

## What the examples establish

The diagrams use observer knowledge, including physical identities and fiber
sizes. These are not information available to the anonymous agents.
`execution` examples are views of concrete generated executions;
`construction` examples explain a proof mechanism with explicit mathematical
objects or trial assignments. A rejected hypothetical assignment is not an
output of the counting engine. A finite checked example is not a general proof.

The complexity clips do not implement a general coNP recognition solver.
In the path-prefix construction, grouped nodes stand for entire fibers; they
must not be read as one physical agent each. The proof notes record these
distinctions and the generator asserts the numerical claims shown.

## Reproduce the checks

The generators use Python's standard library and the independent Fraction
oracle in `simulator/tests`. Rebuilding does not require distributing the paper.
To update against a changed paper, explicitly pass its path; the builder verifies
the inventory of lemma labels and stores the SHA-256 of the source.

```sh
python3 simulator/presentation/build_examples.py --paper /path/to/paper.tex
cmake -S simulator/c -B simulator/c/build -DCMAKE_BUILD_TYPE=Release
cmake --build simulator/c/build -j4
python3 simulator/presentation/validate_examples.py
COUNTING_WASM_MODULE=simulator/web/public/engine.mjs \
  node simulator/scripts/check_wasm_parity.mjs simulator/presentation/scenarios/*.json
cd simulator/web
PLAYWRIGHT_PORT=4180 npm test
npm run build
```

On macOS with Homebrew GMP, add
`-DCOUNTING_GMP_ROOT=/opt/homebrew/opt/gmp` to the CMake configuration command.
All exported graph sequences are compared round by round between native C,
the independent Python oracle, and the WebAssembly build. Construction examples
add assertions specific to the lemma. `validation.json` lists the actual cases;
it is an evidence record for these examples, not an exhaustive campaign.

## Record again

With the presentation server running on port 4180 and `ffmpeg`/`ffprobe` on PATH:

```sh
cd simulator/web
node scripts/record-presentation.mjs http://127.0.0.1:4180/
cd ../..
python3 simulator/presentation/package_recordings.py
```

Pass a final example ID such as `lemma-04` to record just one clip. Recordings
capture the actual browser interface; the script advances its public keyboard
controls. The gallery and `STOC-clips.zip` are generated from the verified files.
`recordings/manifest.json` contains clip dimensions, durations and hashes.

The `presentation/**` branch workflow runs the example validation, native/Wasm
parity, browser tests and production build. Only pushes to `main` deploy the
public GitHub Pages simulator.
