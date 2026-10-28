# Correctness checks

Run from the project directory after building the native executable:

```sh
python3 simulator/tests/run.py --mode unit
python3 simulator/tests/run.py --mode quick
python3 simulator/tests/run.py --mode exhaustive
python3 simulator/tests/mutations.py
python3 -m unittest discover -s simulator/tests -p test_campaign.py -v
```

`COUNTING_BIN` or `--binary` selects another native executable. No third-party
Python dependencies are needed. `--time-budget` defaults to 60 seconds; reaching
it returns status `incomplete` and exit code 2, never an exhaustive success.
Failures return exit code 1 and save the original scenario and diagnosis under
`simulator/results/regressions/` for replay and reduction.

The reference implementation uses Python arbitrary-precision integers and
`fractions.Fraction`. It constructs the global indistinguishability partition
directly from each adjacency matrix, and projects a local vista by ancestry.
This differs from the production local-history merge implementation. Agent IDs,
fibers, and actual population size are used only by the reference/harness, never
as inputs to an agent's counting decision. Structural digests match histories
without assuming common internal node IDs. Exact comparison includes the graph,
visible histories, fibers, halting, outputs and each audit's equations, rational
solution, anchor and descendants. H1--H4, flow balance, exhaustive-flat recovery,
and the conditional credit lemma are also checked.

The quick suite covers static/dynamic families with actual population at most
12 and every leader count, using inexpensive native termination/count checks.
It performs full exact differential comparison on the deterministic cases with
population at most 4 and fixed-seed cases up to 16, including agent relabeling and
edge-order changes. The report separates these two levels of coverage. Unit tests
also cover parallel-arc splitting, huge exact coefficients, all audit rejection
reasons, mutation sensitivity, an explicit unsound one-leader shortcut, and
singleton networks with zero arcs or loops.

Native boundary checks reject invalid leader sets, indices and schema types,
disconnected graphs, and nonpositive/noninteger multiplicities. They also verify
that finite prefixes and a zero-round run return an honest incomplete trace.
`mutations.py` builds three isolated test-only C variants and requires that the
same witnesses pass on production C and detect ignored multiplicity, skipped
integrality and skipped suffix checks. These builds do not alter production C.

The exhaustive suite contains exactly 388 cases: populations 1 and 2, binary arc
multiplicities including loops, every nonempty leader set, both algorithm
variants, and every strongly connected round sequence through `2n-1`. It is
complete only for this finite domain. It says nothing exhaustive about larger
populations, parallel multiplicities above one, or arbitrary dynamic networks.

The lower-bound fixtures follow Appendix "Termination Lower Bounds", including
the fixed final cycle in the several-leader construction. Passive full histories
are compared through the claimed common depth and at their first divergence.
These tests diagnose implementation/fixture disagreement and can expose a
counterexample; passing them is experimental evidence, not a proof of the paper.

For use by campaigns, `fixtures.py` exports `random_scenario`, `binary_graphs`,
`tiny_exhaustive`, `lowerbound_pair`, and `strong_connected`. `oracle.py` exports
`simulate`, `compare_results`, and `check_invariants`; `run.py` exports `check_case`
and `native_run`. The oracle also supports the scenario CLI:

```sh
python3 simulator/tests/oracle.py scenario.json --trace
python3 simulator/tests/oracle.py scenario.json --summary
```

Campaign regression tests cover paired core/sharp random networks, reproducible
resume indices, independent stress-size and coefficient choices, extreme leader
counts, and balanced oracle sampling. Scheduler tests check that 64 workers are
available on a 128-CPU host, free workers refill before a slow earlier case ends,
and an out-of-order resource failure cannot advance the checkpoint past an
unchecked case.
