# Presentation example contract

Generated `web/public/presentation/examples.json` contains:

```
{schema_version: 1, paper_sha256: string, examples: Example[]}
```

Each Example has `id` (e.g. `lemma-01`), `number` (integer), `title`, `label`
(paper LaTeX label), `section`, `kind` (`execution` or `construction`),
`summary` (one plain-English sentence), `proof_note` (scope/general argument),
`checks` (nonempty array of descriptions of computations actually asserted),
`frames`, and optional `scenario` (a valid simulator Scenario).

Each frame has `title`, `caption` (brief English, intuitive), `duration` (seconds,
usually 4), `networks` (one or two Network objects), optional `metrics`
(`[{label: string, value: string}]`), and optional `round`.

A Network has `title`, `nodes`, `edges`, and optional `note`.
A node has `id` (string), `label` (short), optional `detail` (one short line),
`leader` (boolean), `highlight` (boolean), `muted` (boolean), `group` (0..5),
`x` and `y` (coordinates in 0..1). If coordinates are omitted, use a circle.
An edge has `source`, `target` (node IDs), optional `label`, `multiplicity`
(decimal string), `highlight`, and `kind` (`black`, `red`, or `communication`).
Arrows follow source to target; black edges are ancestry, red edges are messages.

Keep diagrams small (usually <= 8 nodes; at most 16). Never depict illustrative
assignments as outputs of the C engine. All captions use observer knowledge;
actual agents do not know fiber sizes or the true population. Equality claims
about views must compare full canonical signatures, not incidental node IDs.
The generator must assert the specific numerical properties displayed.

Core module: `core_examples.py`, exports `build_examples()` returning examples
1..8, plus optional bonus theorem example with id `lower-bound` and number 17.
Complexity module: `complexity_examples.py`, same export, examples 9..16.
Modules must be importable with Python 3's standard library only; they may import
the existing simulator/tests/oracle.py. A module may export `validate()` for
extra checks. Do not edit the paper or copy its full text into this public repo.
