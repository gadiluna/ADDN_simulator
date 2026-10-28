#!/usr/bin/env python3
"""Build three test-only native mutants and require that the checks kill them.

These intentional errors exercise communication multiplicity, exact integrality
and suffix descendant bounds. Production CMake defaults to mutation='none'.
"""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

from fixtures import edge, scenario
from oracle import compare_results, simulate
from run import DEFAULT_BIN, ROOT, native_audits
from test_oracle import synthetic_audits


def invoke(binary, command, value):
    with tempfile.TemporaryDirectory(prefix="counting-mutation-") as directory:
        path = Path(directory) / "input.json"
        path.write_text(json.dumps(value))
        completed = subprocess.run([str(binary), command, str(path)] + (["--trace"] if command == "run" else []),
                                   text=True, capture_output=True, timeout=20)
        assert completed.returncode in (0, 1, 2), completed.stderr
        return completed.returncode, json.loads(completed.stdout)


def build_mutant(name, build_root):
    directory = build_root / ("build-mutant-" + name)
    for command in (["cmake", "-S", str(ROOT / "c"), "-B", str(directory),
                     "-DCOUNTING_MUTATION=" + name, "-DCMAKE_BUILD_TYPE=Debug"],
                    ["cmake", "--build", str(directory), "--parallel", "2"]):
        completed = subprocess.run(command, text=True, capture_output=True, timeout=120)
        if completed.returncode:
            raise RuntimeError(completed.stdout + completed.stderr)
    return directory / "counting"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=DEFAULT_BIN)
    parser.add_argument("--build-root", type=Path, default=ROOT / "c")
    args = parser.parse_args()
    # The unmodified implementation must pass the same witnesses first.
    native_audits(args.binary)
    witness = scenario(1, [0], [dict(edges=[edge(0, 0, 7)])], variant="core")
    expected = simulate(witness)
    code, actual = invoke(args.binary, "run", witness)
    assert code == 0
    compare_results(actual, expected)
    results = []
    mutant = build_mutant("ignore_multiplicity", args.build_root)
    code, actual = invoke(mutant, "run", witness)
    if actual.get("status") == "error":
        assert (actual.get("failure") or {}).get("kind") in ("late_halt", "wrong_output", "early_halt", "asynchronous_halt"), actual
        detected = True
    else:
        try:
            compare_results(actual, expected)
        except AssertionError:
            detected = True
        else:
            detected = False
    assert detected, "ignore_multiplicity survived its witness"
    results.append(dict(mutation="ignore_multiplicity", killed=True,
                        witness="singleton core, self-loop multiplicity seven"))
    inputs = dict(synthetic_audits())
    for mutation, reason in (("skip_integrality", "non_integer"), ("skip_suffix", "suffix")):
        mutant = build_mutant(mutation, args.build_root)
        code, actual = invoke(mutant, "audit", dict(schema_version=1, **inputs[reason]))
        assert code == 0, actual
        assert actual["reason"] != reason, (mutation, "mutant survived", actual)
        assert actual["reason"] == "accepted", (mutation, "unexpected failure instead of intended mutation", actual)
        results.append(dict(mutation=mutation, killed=True, witness=reason + " synthetic audit"))
    print(json.dumps(dict(status="complete", killed=len(results), mutations=results), indent=2))


if __name__ == "__main__":
    main()
