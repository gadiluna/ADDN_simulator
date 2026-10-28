#!/usr/bin/env python3
"""Check presentation scenarios against the independent Fraction oracle."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tests"))
from oracle import check_invariants, compare_results, simulate
from fixtures import strong_connected
from build_examples import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, default=HERE.parent / "c/build/counting")
    args = parser.parse_args()
    data = build()
    cases = []
    for path in sorted((HERE / "scenarios").glob("*.json")):
        scenario = json.loads(path.read_text())
        assert all(strong_connected(scenario["n"], graph["edges"]) for graph in scenario["rounds"]), path.name
        expected = simulate(scenario)
        result = subprocess.run([str(args.engine.resolve()), "run", str(path), "--trace"], check=True, capture_output=True, text=True, timeout=30)
        actual = json.loads(result.stdout)
        compare_results(actual, expected)
        check_invariants(actual, scenario["n"], len(scenario["leaders"]))
        cases.append(dict(file=path.name, n=scenario["n"], leaders=len(scenario["leaders"]), rounds=actual["termination_round"], sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        print(f"PASS {path.name}: n={scenario['n']}, {len(actual['snapshots'])} snapshots")
    report = dict(schema_version=1, paper_sha256=data["paper_sha256"], engine_sha256=hashlib.sha256(args.engine.read_bytes()).hexdigest(), lemma_count=16, illustration_count=len(data["examples"]), cases=cases, scope="Concrete examples only; construction assertions and complete C/Fraction trace comparisons, not a proof or a network-recognition solver.")
    (HERE / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"PASS {len(cases)} native/oracle scenarios and {len(data['examples'])} validated illustrations.")


if __name__ == "__main__":
    main()
