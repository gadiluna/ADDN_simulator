# ADDN simulator

[Open the simulator](https://gadiluna.github.io/ADDN_simulator/)

An interactive simulator for counting in anonymous dynamic directed networks.
The browser runs the exact C engine through WebAssembly, with GMP arithmetic
inside a Web Worker.

Explore changing networks, inspect an agent's local history, and expand the
mathematical checks behind its counting decision. The interface includes
lower-bound examples, configurable random networks, scenario import/export,
round replay, and resizable network and memory panels.

## STOC presentation branch

The `presentation/stoc-lemma-demos` branch includes visual demonstrations of
all 16 lemmas, a paired lower-bound example, and annotated Full HD recordings.
Open `/?presentation=1` on the local app, or browse the
[clip gallery](simulator/presentation/recordings/index.html) and
[presentation guide](simulator/presentation/README.md).

## Run locally

```sh
cd simulator/web
npm ci
npm run dev
```

The repository includes browser engine assets. To rebuild them from C, run
`bash simulator/scripts/build_wasm.sh` from the repository root. Build scripts
download pinned dependencies into `simulator/.deps` without changing system
packages. See the [simulator guide](simulator/README.md) for native builds,
independent verification, and experimental campaigns.

## Verify

```sh
cd simulator/web
npx playwright install chromium
npm run build
npm test
```

## GitHub Pages

The [deployment workflow](.github/workflows/pages.yml) rebuilds the WebAssembly
engine, runs the browser and mathematical regressions, packages dependency
notices, and tests the production site under its URL prefix before publishing.
Pushes to `main` deploy automatically; the workflow can also be started manually.

The published artifact contains only `simulator/web/dist`. Native experiments
run separately; browser execution needs no backend.

Third-party license texts, the GMP source archive, and materials for relinking
the WebAssembly engine are available from the simulator's Help menu.
