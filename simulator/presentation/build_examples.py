#!/usr/bin/env python3
"""Build the reviewed presentation data and reusable simulator scenarios."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from core_examples import build_examples as core
from complexity_examples import build_examples as complexity

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "web/public/presentation"


def validate(examples: list[dict]) -> None:
    assert {e["number"] for e in examples if e["id"].startswith("lemma-")} == set(range(1, 17))
    assert len({e["id"] for e in examples}) == len(examples)
    for example in examples:
        assert re.fullmatch(r"[a-z0-9-]+", example["id"])
        for key in ("title", "label", "section", "summary", "proof_note"):
            assert isinstance(example[key], str) and example[key].strip(), (example["id"], key)
        assert example["kind"] in ("execution", "construction")
        assert example["checks"] and all(isinstance(c, str) for c in example["checks"])
        assert 3 <= len(example["frames"]) <= 8
        for frame in example["frames"]:
            assert frame["title"] and frame["caption"]
            assert 2 <= frame["duration"] <= 12
            assert 1 <= len(frame["networks"]) <= 2
            for network in frame["networks"]:
                ids = {node["id"] for node in network["nodes"]}
                assert 1 <= len(ids) == len(network["nodes"]) <= 20
                for node in network["nodes"]:
                    assert isinstance(node["id"], str) and node["label"]
                    for key in ("x", "y"):
                        if key in node:
                            assert 0 <= node[key] <= 1
                for edge in network["edges"]:
                    assert edge["source"] in ids and edge["target"] in ids
                    if "multiplicity" in edge:
                        assert isinstance(edge["multiplicity"], str) and int(edge["multiplicity"]) > 0
                    assert edge.get("kind", "communication") in ("communication", "black", "red")


def build(paper: Path | None = None) -> dict:
    examples = sorted(core() + complexity(), key=lambda example: example["number"])
    validate(examples)
    if paper:
        source = paper.read_bytes()
        labels = re.findall(rb"\\begin\{lemma\}(?:\[[^\]]*\])?\s*\\label\{([^}]+)\}", source)
        assert set(label.decode() for label in labels) == {
            example["label"] for example in examples if example["id"].startswith("lemma-")
        }, "The lemma inventory changed; review the coverage before publishing."
        digest = hashlib.sha256(source).hexdigest()
    else:
        previous = PUBLIC / "examples.json"
        if not previous.exists():
            raise SystemExit("First generation requires --paper /path/to/paper.tex")
        digest = json.loads(previous.read_text())["paper_sha256"]
    document = dict(schema_version=1, paper_sha256=digest, examples=examples)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "examples.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    scenarios = HERE / "scenarios"
    scenarios.mkdir(exist_ok=True)
    # Only delete files this generator owns, not user-authored scenarios.
    for path in scenarios.glob("lemma-*.json"):
        path.unlink()
    for path in scenarios.glob("lower-bound*.json"):
        path.unlink()
    for example in examples:
        values = ([example["scenario"]] if example.get("scenario") else []) + example.get("scenarios", [])
        for i, scenario in enumerate(values):
            name = example["id"] + (f"-{i + 1}" if i else "") + ".json"
            (scenarios / name).write_text(json.dumps(scenario, indent=2) + "\n")
    lines = ["# STOC presentation storyboard", "", "English captions for visual intuition. Each finite example illustrates a proof mechanism; it is not a proof of the general lemma.", "", f"Paper SHA-256: `{digest}`", ""]
    for example in examples:
        heading = f"Lemma {example['number']}" if example["id"].startswith("lemma-") else "Bonus: lower bound"
        lines += [f"## {heading} — {example['title']}", "", f"Paper label: `{example['label']}`. Type: {example['kind']}.", "", example["summary"], ""]
        for i, frame in enumerate(example["frames"], 1):
            lines += [f"{i}. **{frame['title']}** ({frame['duration']} s): {frame['caption']}"]
        lines += ["", f"**Proof connection.** {example['proof_note']}", "", "**Checked facts.**", ""]
        lines += [f"- {check}" for check in example["checks"]]
        lines += [""]
    (HERE / "STORYBOARD.md").write_text("\n".join(lines))
    return document


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paper", type=Path, help="Source paper for coverage and SHA-256 verification")
    args = parser.parse_args()
    data = build(args.paper)
    print(f"Built {len(data['examples'])} examples; all construction assertions and schema checks passed.")
