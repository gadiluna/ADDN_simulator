"""Independent exact reference for paper.tex, using global partition refinement.

The production implementation merges local histories.  This reference instead
refines the actual population into equivalence classes, then projects ancestors
of each observer.  Actual fibers are used only here and by diagnostic assertions.
No third-party Python packages are required.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from fractions import Fraction
import hashlib
import json
from pathlib import Path
from typing import Any


def idle_audit() -> dict:
    return dict(candidate=None, final_level=None, anchor=None, status="idle",
                reason="waiting", solution=[], equations=[], descendants=[])


def solve_exact(rows: list[list[int | Fraction]], rhs: list[int | Fraction],
                width: int) -> tuple[str, list[Fraction]]:
    """Gauss-Jordan elimination; report inconsistency before non-uniqueness."""
    matrix = [[Fraction(x) for x in row] + [Fraction(b)]
              for row, b in zip(rows, rhs)]
    rank = 0
    pivots = []
    for col in range(width):
        pivot = next((r for r in range(rank, len(matrix)) if matrix[r][col]), None)
        if pivot is None:
            continue
        matrix[rank], matrix[pivot] = matrix[pivot], matrix[rank]
        factor = matrix[rank][col]
        matrix[rank] = [x / factor for x in matrix[rank]]
        for r in range(len(matrix)):
            if r != rank and matrix[r][col]:
                factor = matrix[r][col]
                matrix[r] = [a - factor * b for a, b in zip(matrix[r], matrix[rank])]
        pivots.append(col)
        rank += 1
    if any(not any(row[:width]) and row[width] for row in matrix):
        return "inconsistent", []
    if rank < width:
        return "non_unique", []
    answer = [Fraction(0)] * width
    for r, col in enumerate(pivots):
        answer[col] = matrix[r][width]
    return "unique", answer


def audit(nodes: list[dict], visible: list[int] | set[int], candidate: int,
          final_level: int, ell: int) -> dict:
    """Implement Steps 1--5 directly on the projected visible prefix."""
    result = idle_audit()
    result.update(candidate=candidate, final_level=final_level, status="rejected")
    by_id = {v["id"]: v for v in nodes}
    levels = {r: sorted((i for i in visible if by_id[i]["level"] == r))
              for r in range(-1, final_level + 1)}

    def reject(reason: str) -> dict:
        result["reason"] = reason
        return result

    if not any(by_id[i]["leader"] for i in levels[0]):
        return reject("leader_missing")
    if any(len(levels[r]) > candidate for r in range(final_level + 1)):
        return reject("node_limit")
    children = defaultdict(list)
    for r in range(final_level + 1):
        for i in levels[r]:
            children[by_id[i]["parent"]].append(i)
    if any(not children[i] for r in range(final_level) for i in levels[r]):
        return reject("missing_child")
    flat = [r for r in range(1, final_level + 1)
            if all(len(children[i]) == 1 for i in levels[r - 1])]
    if not flat:
        return reject("no_flat")
    h = max(flat)
    result["anchor"] = h
    variables = levels[h]
    equations, rows, rhs = [], [], []
    for u in levels[h - 1]:
        coefficients = []
        for v in variables:
            node = by_id[v]
            incoming = sum(int(e["multiplicity"]) for e in node["incoming"]
                           if e["source"] == u)
            coefficients.append(incoming - (int(node["outdegree"])
                                            if node["parent"] == u else 0))
        rows.append(coefficients)
        rhs.append(0)
    rows.append([int(by_id[v]["leader"]) for v in variables])
    rhs.append(ell)
    for row, b in zip(rows, rhs):
        equations.append(dict(terms=[dict(node=v, coefficient=str(c))
                                    for v, c in zip(variables, row) if c], rhs=str(b)))
    result["equations"] = equations
    status, solution = solve_exact(rows, rhs, len(variables))
    if status != "unique":
        return reject(status)
    result["solution"] = [dict(node=v, value=str(value))
                          for v, value in zip(variables, solution)]
    if any(value.denominator != 1 for value in solution):
        return reject("non_integer")
    if any(value <= 0 for value in solution):
        return reject("non_positive")
    if sum(solution) != candidate:
        return reject("wrong_total")
    counts = dict(zip(variables, solution))
    for r in range(h - 1, -2, -1):
        for u in levels[r]:
            counts[u] = sum((counts[v] for v in children[u]), Fraction(0))
    for r in range(1, h):
        for u in levels[r - 1]:
            incoming = sum((int(edge["multiplicity"]) * counts[v]
                            for v in levels[r] for edge in by_id[v]["incoming"]
                            if edge["source"] == u), Fraction(0))
            outgoing = sum((int(by_id[v]["outdegree"]) * counts[v]
                            for v in children[u]), Fraction(0))
            if incoming != outgoing:
                return reject("backward_flow")
    for u in variables:
        descendants = 0
        for v in levels[final_level]:
            ancestor = v
            while by_id[ancestor]["level"] > h:
                ancestor = by_id[ancestor]["parent"]
            descendants += ancestor == u
        result["descendants"].append(dict(node=u, count=descendants))
    if any(d["count"] > counts[d["node"]] for d in result["descendants"]):
        return reject("suffix")
    result.update(status="accepted", reason="accepted")
    return result


def visible_ancestors(nodes: list[dict], bottom: int) -> set[int]:
    by_id = {v["id"]: v for v in nodes}
    seen, stack = set(), [bottom]
    while stack:
        v = stack.pop()
        if v in seen:
            continue
        seen.add(v)
        node = by_id[v]
        if node["parent"] is not None:
            stack.append(node["parent"])
        stack.extend(e["source"] for e in node["incoming"])
    return seen


def simulate(scenario: dict, max_rounds: int | None = None,
             passive: bool = False) -> dict:
    """Return a trace; passive=True constructs full histories without halting."""
    n = scenario["n"]
    leaders = set(scenario["leaders"])
    ell, variant = len(leaders), scenario["variant"]
    assert n >= 1 and leaders and leaders <= set(range(n))
    assert variant in ("core", "sharp")
    rounds = scenario["rounds"]
    horizon = 2 * n - 1 if scenario.get("repeat_last", False) and rounds else len(rounds)
    if max_rounds is not None:
        horizon = max_rounds if rounds and scenario.get("repeat_last", False) else min(horizon, max_rounds)
    nodes = [dict(id=0, level=-1, leader=False, parent=None, outdegree="0",
                  incoming=[], fiber=list(range(n)))]
    bottoms = [None] * n
    for leader in (False, True):
        fiber = [x for x in range(n) if (x in leaders) == leader]
        if fiber:
            node_id = len(nodes)
            nodes.append(dict(id=node_id, level=0, leader=leader, parent=0,
                              outdegree="0", incoming=[], fiber=fiber))
            for x in fiber:
                bottoms[x] = node_id
    halted = [False] * n
    outputs = [None] * n
    snapshots = []

    def snapshot(t: int, graph: dict | None, audits: list[dict]) -> None:
        agents = [dict(id=x, leader=x in leaders, bottom=bottoms[x], halted=halted[x],
                       output=outputs[x], visible_nodes=sorted(visible_ancestors(nodes, bottoms[x])),
                       audit=audits[x]) for x in range(n)]
        snapshots.append(dict(schema_version=1, round=t, complete=all(halted),
                              variant=variant, n=n, ell=ell, agents=agents,
                              nodes=deepcopy(nodes), graph=deepcopy(graph)))

    snapshot(0, None, [idle_audit() for _ in range(n)])
    for t in range(1, horizon + 1):
        graph = rounds[min(t - 1, len(rounds) - 1)]
        incoming = [defaultdict(int) for _ in range(n)]
        outdegree = [0] * n
        for edge in graph["edges"]:
            a, b, multiplicity = edge["source"], edge["target"], int(edge["multiplicity"])
            assert 0 <= a < n and 0 <= b < n and multiplicity > 0
            outdegree[a] += multiplicity
            if not halted[a] and not halted[b]:
                incoming[b][bottoms[a]] += multiplicity
        classes = defaultdict(list)
        for x in range(n):
            if not halted[x]:
                key = (bottoms[x], outdegree[x], tuple(sorted(incoming[x].items())))
                classes[key].append(x)
        for (parent, degree, messages), fiber in sorted(classes.items()):
            node_id = len(nodes)
            nodes.append(dict(id=node_id, level=t, leader=fiber[0] in leaders,
                              parent=parent, outdegree=str(degree),
                              incoming=[dict(source=u, multiplicity=str(k)) for u, k in messages],
                              fiber=fiber))
            for x in fiber:
                bottoms[x] = node_id
        audits = [idle_audit() for _ in range(n)]
        if not passive:
            for x in range(n):
                if halted[x]:
                    continue
                visible = visible_ancestors(nodes, bottoms[x])
                if variant == "sharp" and t == ell:
                    a = idle_audit()
                    has_nonleader = any(nodes[v]["level"] == 0 and not nodes[v]["leader"]
                                        for v in visible)
                    a.update(candidate=ell, final_level=0,
                             status="rejected" if has_nonleader else "accepted",
                             reason="nonleader_visible" if has_nonleader else "all_leaders")
                    audits[x] = a
                elif (variant == "core" or ell == 1) and t % 2 == 1 and (t + 1) // 2 >= ell:
                    m = (t + 1) // 2
                    audits[x] = audit(nodes, visible, m, m, ell)
                elif variant == "sharp" and ell >= 2 and t % 2 == 0 and t // 2 + 1 > ell:
                    m = t // 2 + 1
                    audits[x] = audit(nodes, visible, m, m - 1, ell)
                if audits[x]["status"] == "accepted":
                    outputs[x] = audits[x]["candidate"]
                    halted[x] = True
        snapshot(t, graph, audits)
        if all(halted):
            break
    return dict(schema_version=1, status="complete" if all(halted) else "incomplete",
                termination_round=snapshots[-1]["round"] if all(halted) else None,
                snapshots=snapshots)


def node_signatures(snapshot: dict) -> dict[int, str]:
    """Canonical recursive structural signatures, independent of node IDs/fibers."""
    signatures = {}
    for node in sorted(snapshot["nodes"], key=lambda v: (v["level"], v["id"])):
        if node["level"] == -1:
            description = ["root"]
        else:
            incoming = defaultdict(int)
            for edge in node["incoming"]:
                incoming[signatures[edge["source"]]] += int(edge["multiplicity"])
            description = [node["level"], bool(node["leader"]),
                           signatures[node["parent"]], int(node["outdegree"]),
                           sorted(incoming.items())]
        signatures[node["id"]] = hashlib.sha256(json.dumps(description).encode()).hexdigest()
    return signatures


def _normalize_audit(a: dict, signatures: dict[int, str]) -> dict:
    result = {k: a.get(k) for k in ("candidate", "final_level", "anchor", "status", "reason")}
    result["solution"] = sorted((signatures[v["node"]], str(Fraction(v["value"])))
                                for v in a.get("solution", []))
    result["descendants"] = sorted((signatures[v["node"]], v["count"])
                                   for v in a.get("descendants", []))
    # Compare the anchor equations independent of row/variable order and scaling.
    equations = []
    for equation in a.get("equations", []):
        terms = defaultdict(Fraction)
        for term in equation["terms"]:
            terms[signatures[term["node"]]] += Fraction(term["coefficient"])
        row = sorted((s, c) for s, c in terms.items() if c)
        rhs = Fraction(equation["rhs"])
        divisor = row[0][1] if row else (rhs or Fraction(1))
        equations.append((tuple((s, str(c / divisor)) for s, c in row), str(rhs / divisor)))
    result["equations"] = sorted(equations)
    return result


def compare_results(actual: dict, expected: dict) -> None:
    assert actual["schema_version"] == expected["schema_version"] == 1
    for key in ("status", "termination_round"):
        assert actual[key] == expected[key], (key, actual[key], expected[key])
    assert len(actual["snapshots"]) == len(expected["snapshots"]), "snapshot count"
    for left, right in zip(actual["snapshots"], expected["snapshots"]):
        t = right["round"]
        for key in ("round", "complete", "variant", "n", "ell"):
            assert left[key] == right[key], (t, key, left[key], right[key])
        def graph_signature(graph):
            if graph is None:
                return None
            pairs = defaultdict(int)
            for e in graph["edges"]:
                pairs[e["source"], e["target"]] += int(e["multiplicity"])
            return sorted(pairs.items())
        assert graph_signature(left["graph"]) == graph_signature(right["graph"]), (t, "round graph")
        sl, sr = node_signatures(left), node_signatures(right)
        assert len(set(sl.values())) == len(sl), (t, "duplicate canonical history")
        fl = {sl[v["id"]]: sorted(v["fiber"]) for v in left["nodes"]}
        fr = {sr[v["id"]]: sorted(v["fiber"]) for v in right["nodes"]}
        assert fl == fr, (t, "history nodes or fibers differ")
        la = {a["id"]: a for a in left["agents"]}
        ra = {a["id"]: a for a in right["agents"]}
        assert la.keys() == ra.keys(), (t, "agent set")
        for x, a in la.items():
            b = ra[x]
            for key in ("leader", "halted", "output"):
                assert a[key] == b[key], (t, x, key, a[key], b[key])
            assert sl[a["bottom"]] == sr[b["bottom"]], (t, x, "bottom")
            assert {sl[i] for i in a["visible_nodes"]} == {sr[i] for i in b["visible_nodes"]}, (t, x, "visible history")
            al, ar = _normalize_audit(a["audit"], sl), _normalize_audit(b["audit"], sr)
            assert al == ar, (t, x, "audit", al, ar)


def check_invariants(result: dict, n: int, ell: int) -> None:
    """Check paper H1--H4 and exhaustive-flat recovery from actual fibers."""
    for snapshot in result["snapshots"]:
        t = snapshot["round"]
        nodes = {v["id"]: v for v in snapshot["nodes"]}
        levels = defaultdict(list)
        for v in nodes.values():
            levels[v["level"]].append(v)
        for r, level in levels.items():
            fibers = [set(v["fiber"]) for v in level]
            assert sum(map(len, fibers)) == n and set.union(*fibers) == set(range(n)), (t, r, "global partition")
            if r >= 0:
                assert sum(len(v["fiber"]) for v in level if v["leader"]) == ell
                for v in level:
                    assert set(v["fiber"]) <= set(nodes[v["parent"]]["fiber"])
            if r >= 1:
                for u in levels[r - 1]:
                    incoming = sum(int(e["multiplicity"]) * len(v["fiber"])
                                   for v in level for e in v["incoming"] if e["source"] == u["id"])
                    outgoing = sum(int(v["outdegree"]) * len(v["fiber"])
                                   for v in level if v["parent"] == u["id"])
                    assert incoming == outgoing, (t, r, "flow")
        for agent in snapshot["agents"]:
            visible = set(agent["visible_nodes"])
            assert visible == visible_ancestors(list(nodes.values()), agent["bottom"])
            for r in range(t + 1):
                visible_level = [v for v in levels[r] if v["id"] in visible]
                if t >= r + n - 1:
                    assert len(visible_level) == len(levels[r]), (t, r, "H4")
            a = agent["audit"]
            if a["solution"]:
                anchor_nodes = [v for v in levels[a["anchor"]] if v["id"] in visible]
                if sum(len(v["fiber"]) for v in anchor_nodes) == n:
                    # The flat exhaustive-level lemma predicts the actual counts.
                    actual_counts = {v["id"]: len(v["fiber"]) for v in anchor_nodes}
                    assert all(Fraction(value["value"]) == actual_counts[value["node"]]
                               for value in a["solution"]), (t, "exhaustive flat recovery")
            if a["reason"] in ("accepted", "suffix", "backward_flow"):
                values = {v["node"]: Fraction(v["value"]) for v in a["solution"]}
                if a["reason"] != "backward_flow":
                    h = a["anchor"]
                    for r in range(h - 1, -1, -1):
                        for v in levels[r]:
                            if v["id"] in visible:
                                values[v["id"]] = sum((values[w["id"]] for w in levels[r + 1]
                                                        if w["id"] in visible and w["parent"] == v["id"]), Fraction(0))
                    credit = [sum(min(len(v["fiber"]) - 1, values[v["id"]])
                                  for v in levels[r] if v["id"] in visible) for r in range(h + 1)]
                    for before, after in zip(credit, credit[1:]):
                        assert after <= before, (t, "credit increases")
                        if after == before:
                            assert a["candidate"] == n, (t, "credit equality with false candidate")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", type=Path)
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--max-rounds", type=int)
    args = parser.parse_args()
    scenario = json.loads(args.scenario.read_text())
    result = simulate(scenario, max_rounds=args.max_rounds)
    if args.summary:
        result.pop("snapshots")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
