# Counting simulator laboratory

Two interfaces execute the same C implementation of the paper's **core** and
**sharp** Counting protocols: a native command-line tool for experiments, and a
WebAssembly module for the browser. GMP provides exact integer and rational
arithmetic. The independent Python verifier uses global history partitions and
`fractions.Fraction`, rather than the C implementation's local vista merge.

The simulator never supplies the physical population, simulator vertex IDs,
fibers, or true anonymities to an agent's decision procedure. Those quantities
are available to the observer and verifier. All messages come from the previous
round; agents learn their current outdegree after communication. Stopping is
applied only after every active agent has completed the round.

## Build and run locally

Run these commands from the project root. Requirements: a C compiler, CMake,
Python 3.10 or newer, and Node.js for the browser and Wasm parity checks.

```sh
bash simulator/scripts/build_native.sh
python3 simulator/tests/run.py --mode unit
python3 simulator/tests/run.py --mode quick --time-budget 120
python3 simulator/tests/run.py --mode exhaustive --time-budget 120
```

On Linux x86_64, a missing CMake is downloaded as official version **3.31.8**,
verified against its official SHA-256 manifest, and unpacked under `.deps`.
The native build uses installed GMP when available. Otherwise it builds GMP
6.3.0 under `simulator/.deps`, without administrator access. If GMP's GNU m4
prerequisite is missing, it also builds pinned m4 **1.4.19** locally and checks
its source archive SHA-256. To select an
existing installation, set `COUNTING_GMP_ROOT` to its prefix. A separate sanitizer
build does not replace the release binary:

```sh
COUNTING_BUILD_DIR="$PWD/simulator/c/build-sanitize" \
  bash simulator/scripts/build_native.sh -DCOUNTING_SANITIZERS=ON
python3 simulator/tests/run.py --binary simulator/c/build-sanitize/counting \
  --mode quick --time-budget 120
```

Build the shared engine for the browser:

```sh
bash simulator/scripts/build_wasm.sh
cd simulator/web
npm ci
npm run dev
```

The first Wasm build downloads a pinned Emscripten SDK **4.0.15**, at commit
`389a68bc35dcff7ebae4614e1615099dafda00d1`, and GMP **6.3.0** from GNU. The GMP
archive is checked against SHA-256
`a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898`.
The SDK is activated only for the build process. No shell startup files or
system packages are modified. Generic C GMP is built with assembly disabled;
temporary paths avoid GMP's upstream limitations with spaces in directory names.
The outputs `engine.mjs` and `engine.wasm` are copied to `web/public`.

## Scenarios, results, and replay

A scenario is versioned JSON. Multiplicities are positive decimal **strings**,
including values greater than the JavaScript safe integer limit. Round graphs
must be strongly connected, with fixed vertices `0..n-1`; self-loops and parallel
arcs are supported. Agent IDs describe the experiment, not an agent's knowledge.

```json
{
  "schema_version": 1,
  "n": 2,
  "leaders": [0],
  "variant": "sharp",
  "repeat_last": true,
  "rounds": [{"edges": [
    {"source": 0, "target": 1, "multiplicity": "1"},
    {"source": 1, "target": 0, "multiplicity": "1"}
  ]}]
}
```

`repeat_last: true` repeats the last graph after the explicit prefix; otherwise,
exhausting the graph sequence before termination yields an incomplete result.
The native tool emits machine-readable JSON:

```sh
simulator/c/build/counting run scenario.json --summary
simulator/c/build/counting run scenario.json --trace > trace.json
python3 simulator/tests/oracle.py scenario.json --trace > oracle-trace.json
node simulator/scripts/check_wasm_parity.mjs scenario.json
```

Trace output includes every snapshot, starting at round zero. The native tool
uses exit code `0` for a complete valid run, `2` for an incomplete run, and `1`
for an error or detected failure. The Wasm module exposes `sim_create`,
`sim_step`, `sim_snapshot`, `sim_destroy`, `sim_free_string`, and
`sim_last_error`; snapshot strings are freed after decoding. Node parity checks
compare every native and Wasm snapshot for the provided scenarios.

Correct termination schedules are:

| Protocol | Population | Round |
|---|---|---|
| Core | Every valid population | `2n-1` |
| Sharp | `n=ell` | `n` |
| Sharp | `ell=1<n` | `2n-1` |
| Sharp | `2<=ell<n` | `2n-2` |

## Bounded tests and longer campaigns

The quick tests exercise deterministic families, lower-bound constructions,
large multiplicities, fixed-seed random cases, relabelings, and independent
exact-arithmetic audits. Exhaustive tests cover **388 scenarios**: populations
`n<=2`, binary arcs including loops, all nonempty leader sets, both protocols,
and all strongly connected dynamic sequences through `2n-1` rounds.

```sh
python3 simulator/scripts/campaign.py --mode quick --max-cases 32 \
  --seconds 60 --output simulator/results/smoke
python3 simulator/scripts/campaign.py --mode nightly --hours 8 \
  --seed 42 --output simulator/results/nightly
python3 simulator/scripts/campaign.py --mode nightly --hours 8 \
  --seed 42 --output simulator/results/nightly --resume
python3 simulator/scripts/campaign.py --mode nightly --hours 24 --workers 64 \
  --case-timeout 120 --stress-timeout 600 \
  --seed 43 --output simulator/results/large-campaign
```

Nightly search visits deterministic cases, the small exhaustive domain, then
all **4536** loopless `n=3` cases with every strongly connected two-round prefix,
all leader sets and both protocols, repeating the second graph afterward.
It then searches deterministic random seeds with `n<=64`, periodically using
stress populations up to `128` and multiplicities larger than `2^53`. Each random
network is tested with both core and sharp. Stress size and huge multiplicities
are independent, and leader counts regularly include `1`, `2`, `n-1`, and `n`.
This `n=3` domain is bounded to two explicit rounds; it does not exhaust all
dynamic histories through termination.

The Python oracle checks every complete trace for `n<=16`, with paired samples
up to `32` so both variants receive the same independent checks. Other cases use
the C summary and its correctness checks.
Pass `--c-only` to disable every oracle comparison, including small populations.
Python then only generates scenarios and coordinates native processes. The C
output, simultaneous stopping, and expected termination round remain checked.
The flag is recorded in checkpoints and cannot be changed when resuming.

`--c-only --scale-agents 2048` selects a separate structured stress cohort at a
fixed population. It uses 64 changing circulant-cycle topologies, optional
self-loops, exact multiplicities, and periodic leader sets (all, every second,
or every fourth agent). Coprime cycle strides ensure strong connectivity. The
last graph then repeats explicitly. These cases provide large-population
coverage with few history classes; they are not arbitrary random graphs at
that size. The C input limit is 4096 agents; the web viewer remains limited to
128. Use separate output directories and worker allocations for size cohorts
so a slow large case does not delay the smaller random cohort.
Use `--skip-baseline` for random search after independently completing the
baseline. Worker count defaults to four and can be increased explicitly, up to
half the CPU count (64 workers on a 128-core host). A continuous queue refills
each free worker without waiting for a batch; at most eight times the worker
count can be ahead of the committed checkpoint. Successful full traces are
discarded inside the worker after comparison. On Linux, workers and their
native children inherit a per-process address-space limit of at most 2 GiB,
reduced further when needed to keep worker budgets within half physical RAM.
The parent process and child-process overhead are additional to those budgets.
macOS records the memory budget but cannot
reliably enforce this address-space limit; Linux is the target for bounded
overnight runs.

Checkpoints record the next deterministic case, seed, paper title, executable
and case-generator hashes, build configuration, machine, elapsed time, and sampled
oracle count. Resuming checks the executable and generator hashes and seed/mode;
manuscript edits do not prevent resuming a campaign. A budget expiry or interruption
is reported as **incomplete**, never as proof of correctness. Already-running
cases retain their per-case timeout (30 seconds normally, 120 seconds for
`n>64`, configurable). The budget stops dispatch and lets the current native
and oracle timeouts finish. A resource or timeout limit is also reported as
incomplete, with a diagnostic bundle. Exit codes are `0` for a
completed bounded case count, `2` for an incomplete campaign, and `1` for failure.

On failure, a bundle includes the scenario, native trace, diagnostic result,
metadata, and a reduced scenario. The reducer reruns the same failure predicate
while deleting agents, round graphs and edges, and reducing multiplicities; each
accepted edit preserves a nonempty leader set and strong connectivity. Reduced
cases remain under `results` for review and promotion to regression fixtures.
