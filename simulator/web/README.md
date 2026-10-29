# Counting Lab

An interactive observer for the core algorithm in §4.1 of the paper, backed by the native exact C simulator. The React interface never substitutes a JavaScript counting implementation for the WebAssembly engine.

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

The interactive simulator runs only the core algorithm: candidate `m ≥ ℓ` is
tested at round `2m − 1` on the prefix through `𝓛_m`. With admissible topologies
supplied through round `2n − 1`, all agents halt at that round, including when
every agent is a leader. All presets and random networks use this schedule.
Legacy `sharp` scenarios and native bundles retain their topology,
leaders and seed on import, but run a fresh core execution; exported scenarios
and traces record `variant: "core"`. Native research tools and the separate
recorded presentation examples retain their original variants.

- Select an example or import a version-1 scenario / native failure bundle containing `scenario`.
- Examples include Alternating, Rotating hub, and all three appendix lower-bound
  pairs described below. Choose Random, set Agents (1–128) and Leaders (1–Agents),
  and press Generate for a new strongly
  connected network sequence. Each generated scenario records its seed;
  restarting or exporting/importing preserves the same topologies and leaders.
- The main screen contains the network selector, full-height graph, Play/Pause,
  single-round step, restart, and recorded timeline. Secondary controls appear
  only in Options: edit, import/export, playback speed, observer overlay, and Help.
- Click a network node to open its vista and state in the agent panel.
  The panel is initially closed; closing it returns the space to the network.
  On mobile it opens above the playback controls, keeping them usable.
- On desktop, drag the vertical divider to resize the network and agent panels.
  The chosen width is retained when reopening the panel. Double-click the divider
  to reset it; when focused, Left/Right resize and Enter resets the split.
- The vista renders only the selected agent’s `visible_nodes`. Mathematical
  details are collapsed below it and expose the actual candidate, anchor,
  equations, solution, and rejection or acceptance reason returned by C.
- Options → Help & legend explains the paper’s notation, node colours, black/red
  edges, and sending, receiving, updating the vista, and deciding. The observer
  overlay exposes the corresponding history node, actual anonymity, and fiber,
  explicitly labelled as information unavailable to the agent.
- Edit each round’s edge list or the full scenario. Changes are validated and
  start a new execution. Scenario and recorded-trace exports remain replayable.
- Space toggles playback; left/right move through rounds. Focus the network and
  press Enter to inspect the selected agent; up/down select another agent.

The exact engine advances an entire synchronous round atomically. The Help
explanations describe that round without creating partial algorithm states.

The network preserves dragged positions, pan and zoom between rounds. A vista
automatically stays in frame as it grows until the user moves or zooms
its camera. Fit restores automatic framing. Opening or closing the inspector
fits the network to its new available space.

Every network arc is fully visible by default, including when a new round is
denser. In dense graphs, the optional “Highlight selected agent connections”
button dims other arcs and displays an explicit highlighting label. Loading a
different network restores equal visibility for all arcs. Each random round
contains a directed cycle through every agent, ensuring strong connectivity.

The interactive viewer accepts up to 128 agents. Every topology must be strongly connected. Self-loops and parallel edges are supported; the renderer combines parallel edges using exact integer sums. All multiplicities remain decimal strings during import/export.

## Correspondence with the paper

The model and vistas follow §3; the counting test follows §4.1. Mathematical
text uses subscripts, superscripts, summation bounds, and the paper’s distinct
styles for candidate anonymities, actual anonymities, and fibers. Exact integer
and rational values remain unchanged by typesetting.

| Paper | Simulator |
| --- | --- |
| Physical agent `x`; abstract history node `v` (§3) | Network labels `x₀, x₁, …`; vista labels `v₀, v₁, …`. Numeric labels identify objects for the observer and are unavailable to the anonymous agents. |
| Vista `𝓥_t`, visible levels `𝓛_r` (§3) | Selected agent’s vista, shaded green, with its round and the tested prefix. |
| Figure conventions (§3) | Blue leaders; black edges carry `d_r(v)` and red edges carry `μ_r(u,v)`. Both point away from the root. Labels equal to 1 are omitted; edges from the root have no outdegree label. |
| Fiber `A(v)` and actual anonymity `a(v) = |A(v)|` (§3) | Observer overlay and node details only; neither is used by the agent’s test. |
| Anchor `𝓛_h` and candidate anonymity `b(v)` (§4.1) | Largest flat visible level, its flow and leader equations, and separate uniqueness, integrality, positivity, and total checks. |
| Suffix count `q(v)` (§4.1) | Black-edge descendants in `𝓛_m`, compared with `b(v)`; the node itself counts when `h = m`. |

The mathematical panel uses the five names verbatim: **Check the visible
structure**, **Choose the anchor**, **Solve the anchor**, **Propagate backward**,
and **Check the suffix**. It exposes the execution’s evidence and links formulas
to the corresponding vista nodes. The total `m` is checked after solving the
flow and leader equations; it is not an extra equation used to establish
uniqueness.

The appendix presets open on the designated leader. Their network diagrams use
yellow nonleaders and a persistent green ring for the designated leader, following
the lower-bound figure. The blue selection highlight can move independently;
vista colours retain the §3 conventions. Network arc multiplicities use plain
numeric labels, omitting 1. Each pair keeps the known
leader count fixed and has identical designated-leader vistas through these
rounds:

| Appendix family | Populations | Leaders | Designated leader | Common through round |
| --- | --- | --- | --- | --- |
| Several leaders, including the final directed cycle | 6 and 7 | 2 | `x₁` | 9 |
| One leader, bidirected paths with a self-loop at the far endpoint | 4 and 5 | 1 | `x₀` | 6 |
| All leaders in the smaller path; one added nonleader in its companion | 4 and 5 | 4 | `x₀` | 3 |

Tests compare these topologies with the independent Python fixtures and verify
both the common vistas and their first difference in the following round. The
viewer runs core on every pair. The all-leader and several-leader constructions
concern the improved bounds elsewhere in the paper, rather than tight stopping
bounds for core.

## Worker protocol

The main thread sends typed `load`, `step`, and `dispose` requests with IDs. A module Worker exclusively owns the WebAssembly instance and execution handle. It serializes requests, copies each returned snapshot JSON, and frees the C string immediately. Replacing a scenario terminates the old Worker and releases its complete WASM heap.

Production hosting must serve `engine.mjs` as JavaScript and `engine.wasm` as WebAssembly. Use a local HTTP server (`npm run dev` or `npm run preview`), not a `file:` URL.
