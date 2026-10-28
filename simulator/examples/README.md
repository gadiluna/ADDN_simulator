# Replayable examples

Each JSON file can be run by the native engine or imported directly into the web
viewer. From the project root:

```sh
simulator/c/build/counting run simulator/examples/cycle3.json --trace
```

- `singleton.json`: a single leader with no arcs; strong connectivity is vacuous.
- `cycle3.json`: a directed cycle with one leader.
- `all-leaders-path3.json`: the initial sharp test succeeds at round three.
- `one-leader-path4.json`: the bidirected lower-bound path with a far-end loop.
- `several-leaders-n5-l2.json` and `several-leaders-n6-l2.json`: the paired
  several-leader construction from the appendix, using the fixed final cycle.

The last pair has two leaders on each side. The designated observer is agent 1
in both networks; its full-information vistas agree through round seven and
first differ at round eight. Agent IDs are experiment labels, not identifiers
available to the distributed protocol. The fixtures' passive-history checks
establish this experimental comparison independently of the terminating runs.
