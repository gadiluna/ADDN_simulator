# Counting Lab

An interactive observer for the native exact C simulator. The React interface never substitutes a JavaScript counting implementation for the WebAssembly engine.

## Run locally

Build the browser engine as described in `../README.md`. The build places `engine.mjs` and `engine.wasm` in `public/`. The Emscripten module must use an ES-module factory and export `ccall` and `UTF8ToString`.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. Without the engine, the interface shows an explicitly labelled topology preview and a diagnostic. It does not generate execution data.

```sh
npm run build
npm test
```

Browser tests use Playwright Chromium. Run `npx playwright install chromium` if a browser is not installed. Engine-dependent tests report a skip when the generated WebAssembly files are absent; they run against the real engine whenever it is available.

## Explore an execution

- Select an example or import a version-1 scenario / native failure bundle containing `scenario`.
- Examples include Alternating, Rotating hub, and the appendix lower-bound pair
  with six and seven agents (two leaders, including the fixed final cycle).
  Choose Random, set Agents (1–128) and Leaders (1–Agents), and press Generate for a new strongly
  connected network sequence. Each generated scenario records its seed;
  restarting or exporting/importing preserves the same topologies and leaders.
- The main screen contains the network selector, full-height graph, Play/Pause,
  single-round step, restart, and recorded timeline. Secondary controls appear
  only in Options: edit, import/export, playback speed, observer overlay, and Help.
- Click a network node to open its local history and state in the agent panel.
  The panel is initially closed; closing it returns the space to the network.
  On mobile it opens above the playback controls, keeping them usable.
- On desktop, drag the vertical divider to resize the network and agent panels.
  The chosen width is retained when reopening the panel. Double-click the divider
  to reset it; when focused, Left/Right resize and Enter resets the split.
- Local history renders only the selected agent’s `visible_nodes`. Mathematical
  details are collapsed below it and expose the actual candidate, anchor,
  equations, solution, and rejection or acceptance reason returned by C.
- Options → Help & legend explains node colours, parent/message edges and the
  four phases of a round. The observer overlay exposes global class labels and
  true fibre sizes, explicitly labelled as information outside the algorithm.
- Edit each round’s edge list or the full scenario. Changes are validated and
  start a new execution. Scenario and recorded-trace exports remain replayable.
- Space toggles playback; left/right move through rounds. Focus the network and
  press Enter to inspect the selected agent; up/down select another agent.

Help contains the optional “Inside one round” presentation guide. The exact
engine advances an entire synchronous round atomically; the four tabs explain
its phases and never interpolate partial algorithm states.

The network preserves dragged positions, pan and zoom between rounds. A local
history automatically stays in frame as it grows until the user moves or zooms
its camera. Fit restores automatic framing. Opening or closing the inspector
fits the network to its new available space.

The interactive viewer accepts up to 128 agents. Every topology must be strongly connected. Self-loops and parallel edges are supported; the renderer combines parallel edges using exact integer sums. All multiplicities remain decimal strings during import/export.

## Worker protocol

The main thread sends typed `load`, `step`, and `dispose` requests with IDs. A module Worker exclusively owns the WebAssembly instance and execution handle. It serializes requests, copies each returned snapshot JSON, and frees the C string immediately. Replacing a scenario terminates the old Worker and releases its complete WASM heap.

Production hosting must serve `engine.mjs` as JavaScript and `engine.wasm` as WebAssembly. Use a local HTTP server (`npm run dev` or `npm run preview`), not a `file:` URL.
