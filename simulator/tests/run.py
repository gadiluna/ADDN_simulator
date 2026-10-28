#!/usr/bin/env python3
"""Run independent exact differential checks against the native C simulator.

Default quick is deterministic and finite.  --mode exhaustive completely covers
only n<=2, binary arc multiplicities (including loops), all leader sets and all
strongly connected round sequences through the core's 2n-1 round horizon.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from fixtures import deterministic_scenarios, edge, random_scenario, relabel, scenario, tiny_exhaustive
from oracle import check_invariants, compare_results, simulate
from test_oracle import synthetic_audits


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BIN = ROOT / "c" / "build" / "counting"


def native_run(scenario, binary=None, timeout=20, summary=False, max_rounds=None):
    binary = str(binary or os.environ.get("COUNTING_BIN", DEFAULT_BIN))
    with tempfile.TemporaryDirectory(prefix="counting-test-") as directory:
        path = Path(directory) / "scenario.json"
        path.write_text(json.dumps(scenario))
        command = [binary, "run", str(path), "--summary" if summary else "--trace"]
        if max_rounds is not None:
            command += ["--max-rounds", str(max_rounds)]
        completed = subprocess.run(command,
                                   text=True, capture_output=True, timeout=timeout)
        actual = json.loads(completed.stdout)
        if completed.returncode != (2 if actual.get("status") == "incomplete" else 0):
            raise AssertionError(f"native exit={completed.returncode}: {completed.stderr[:2000]}")
        return actual


def check_case(value, binary=None):
    expected = simulate(value)
    check_invariants(expected, value["n"], len(value["leaders"]))
    actual = native_run(value, binary)
    compare_results(actual, expected)
    check_invariants(actual, value["n"], len(value["leaders"]))
    if expected["status"] == "complete":
        n, ell = value["n"], len(value["leaders"])
        deadline = (2 * n - 1 if value["variant"] == "core" else n if n == ell
                    else 2 * n - 1 if ell == 1 else 2 * n - 2)
        assert expected["termination_round"] == deadline, "unexpected protocol schedule"
        assert all(a["output"] == n for a in actual["snapshots"][-1]["agents"]), "wrong count"
    return actual


def check_summary_case(value, binary=None):
    """Fast schedule/count smoke check; explicitly not an oracle differential."""
    actual = native_run(value, binary, summary=True)
    n, ell = value["n"], len(value["leaders"])
    deadline = (2 * n - 1 if value["variant"] == "core" else n if n == ell
                else 2 * n - 1 if ell == 1 else 2 * n - 2)
    assert actual["status"] == "complete", actual
    assert actual["termination_round"] == deadline, actual
    if "outputs" in actual:
        assert all(output == n for output in actual["outputs"]), actual
    return actual


def native_audits(binary):
    for reason, value in synthetic_audits():
        with tempfile.TemporaryDirectory(prefix="counting-audit-") as directory:
            path = Path(directory) / "audit.json"
            path.write_text(json.dumps(dict(schema_version=1, **value)))
            result = subprocess.run([str(binary), "audit", str(path)], text=True,
                                    capture_output=True, timeout=10)
            assert result.returncode == 0, (reason, result.stderr)
            actual = json.loads(result.stdout)
            assert actual["reason"] == reason, (reason, actual)


def native_boundaries(binary):
    base = scenario(2, [0], [dict(edges=[edge(0, 1), edge(1, 0)])])
    finite = deepcopy(base)
    finite["repeat_last"] = False
    compare_results(native_run(finite, binary), simulate(finite))
    compare_results(native_run(finite, binary, max_rounds=20), simulate(finite, max_rounds=20))
    compare_results(native_run(base, binary, max_rounds=0), simulate(base, max_rounds=0))
    invalid = []
    for key, value in (("n", 0), ("n", 2.5), ("leaders", []),
                       ("leaders", [0, 0]), ("leaders", [-1]), ("leaders", [2]),
                       ("variant", "unknown"), ("schema_version", 2),
                       ("repeat_last", "true"), ("rounds", [])):
        changed = deepcopy(base)
        changed[key] = value
        invalid.append(changed)
    for field, value in (("source", -1), ("target", 2), ("source", 0.5),
                         ("multiplicity", "0"), ("multiplicity", "-1"),
                         ("multiplicity", "1.5"), ("multiplicity", 2),
                         ("multiplicity", "1e9")):
        changed = deepcopy(base)
        changed["rounds"][0]["edges"][0][field] = value
        invalid.append(changed)
    disconnected = deepcopy(base)
    disconnected["rounds"][0]["edges"] = [edge(0, 0), edge(1, 1)]
    invalid.append(disconnected)
    for index, value in enumerate(invalid):
        with tempfile.TemporaryDirectory(prefix="counting-invalid-") as directory:
            path = Path(directory) / "invalid.json"
            path.write_text(json.dumps(value))
            result = subprocess.run([str(binary), "run", str(path), "--summary"],
                                    text=True, capture_output=True, timeout=10)
            assert result.returncode == 1, ("invalid input accepted", index, value, result.stdout)
            assert json.loads(result.stdout)["status"] == "error", (index, result.stdout)
    malformed = [b'{"n":', b'{"n":1,"n":2}', b'[] trailing',
                 json.dumps(base).encode() + b'\0INVALID']
    for index, raw in enumerate(malformed):
        with tempfile.TemporaryDirectory(prefix="counting-malformed-") as directory:
            path = Path(directory) / "malformed.json"
            path.write_bytes(raw)
            result = subprocess.run([str(binary), "run", str(path), "--summary"],
                                    text=True, capture_output=True, timeout=10)
            assert result.returncode == 1, ("malformed JSON accepted", index, result.stdout)


def save_failure(value, error, destination):
    destination.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:12]
    path = destination / f"failure-{digest}.json"
    path.write_text(json.dumps(value, indent=2) + "\n")
    path.with_suffix(".error.txt").write_text(str(error) + "\n")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("quick", "exhaustive", "unit"), default="quick")
    parser.add_argument("--binary", type=Path, default=Path(os.environ.get("COUNTING_BIN", DEFAULT_BIN)))
    parser.add_argument("--max-n", type=int, default=12)
    parser.add_argument("--random-cases", type=int, default=16)
    parser.add_argument("--failure-dir", type=Path, default=ROOT / "results" / "regressions")
    parser.add_argument("--time-budget", type=float, default=60)
    args = parser.parse_args()
    started = time.monotonic()
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern="test_*.py")
    unit = unittest.TextTestRunner(verbosity=1).run(suite)
    if not unit.wasSuccessful():
        raise SystemExit(1)
    if args.mode == "unit":
        return
    if not args.binary.is_file():
        parser.error(f"native simulator not found: {args.binary}; build simulator/c first")
    native_audits(args.binary)
    native_boundaries(args.binary)
    if args.mode == "exhaustive":
        values = ((value, True) for value in tiny_exhaustive())
    else:
        def quick_values():
            for value in deterministic_scenarios(args.max_n):
                if value["n"] <= args.max_n:
                    yield value, value["n"] <= 4
            for seed in range(args.random_cases):
                n = 1 + seed % 16
                ell = 1 + (seed * 7) % n
                value = random_scenario(n, ell, f"quick-{seed}", variant="sharp" if seed % 2 else "core")
                yield value, True
                yield relabel(value, list(reversed(range(n)))), True
                split = deepcopy(value)
                for graph in split["rounds"]:
                    graph["edges"].reverse()
                yield split, True
        values = quick_values()
    count = 0
    differential_count = 0
    summary_count = 0
    incomplete = False
    for value, exact in values:
        if time.monotonic() - started >= args.time_budget:
            incomplete = True
            break
        try:
            if exact:
                check_case(value, args.binary)
                differential_count += 1
            else:
                check_summary_case(value, args.binary)
                summary_count += 1
        except Exception as error:
            path = save_failure(value, error, args.failure_dir)
            print(json.dumps(dict(status="failure", cases=count, reproducer=str(path), error=str(error))), file=sys.stderr)
            raise SystemExit(1)
        count += 1
    report = dict(status="incomplete" if incomplete else "complete", mode=args.mode,
                  cases=count, differential_cases=differential_count,
                  summary_cases=summary_count,
                  elapsed_seconds=round(time.monotonic() - started, 3),
                  max_n=args.max_n if args.mode == "quick" else 2,
                  domain="deterministic+fixed-seed" if args.mode == "quick" else "binary n<=2 all SC dynamic sequences through 2n-1, all leader sets, both variants")
    print(json.dumps(report, indent=2))
    if incomplete:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
