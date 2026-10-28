"""Exact construction witnesses for paper Lemmas 9--16.

These illustrate proofs; they are not a coNP recognition implementation.
All displayed sizes and equality-of-history claims are checked before export.
"""
from collections import Counter
from copy import deepcopy
from itertools import product
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from fixtures import edge, scenario, strong_connected
from oracle import simulate, node_signatures


def node(key, label=None, **kwargs):
    return dict(id=str(key), label=str(key) if label is None else label, **kwargs)


def arc(source, target, **kwargs):
    return dict(source=str(source), target=str(target), **kwargs)


def network(title, nodes, edges=(), note=None):
    result = dict(title=title, nodes=nodes, edges=list(edges))
    if note:
        result["note"] = note
    return result


def frame(title, caption, networks, metrics=(), **kwargs):
    return dict(title=title, caption=caption, duration=4.5,
                networks=networks, metrics=[dict(label=a, value=str(b)) for a, b in metrics],
                **kwargs)


def example(number, title, label, summary, proof_note, checks, frames, **kwargs):
    return dict(id=f"lemma-{number:02}", number=number, title=title, label=label,
                section="Network-wise complexity", kind="construction", summary=summary,
                proof_note=proof_note, checks=checks, frames=frames, **kwargs)


def physical(title, value, highlight=(), labels=None, details=None, groups=None, note=None):
    labels, details, groups = labels or {}, details or {}, groups or {}
    leaders = set(value["leaders"])
    return network(title, [node(i, labels.get(i, str(i)), leader=i in leaders,
                                highlight=i in highlight, detail=details.get(i, ""),
                                group=groups.get(i, 0 if i in leaders else 1))
                           for i in range(value["n"])],
                   [arc(e["source"], e["target"], multiplicity=e["multiplicity"])
                    for e in value["rounds"][0]["edges"]], note)


def signature(value, t, observer=0):
    snap = simulate(value, max_rounds=t, passive=True)["snapshots"][-1]
    return node_signatures(snap)[snap["agents"][observer]["bottom"]]


def bounded_orders():
    original = scenario(6, [0], [dict(edges=[edge(i, (i + 1) % 6) for i in range(6)])],
                        name="Lemma 9 - original cycle")
    contraction = {0: 0, 5: 2, 1: 1, 2: 1, 3: 1, 4: 1}
    counts = Counter((contraction[e["source"]], contraction[e["target"]])
                     for e in original["rounds"][0]["edges"])
    small = scenario(3, [0], [dict(edges=[edge(a, b, k) for (a, b), k in counts.items()])],
                     name="Lemma 9 - contracted hidden agents")
    larger_edges = [e for e in small["rounds"][0]["edges"] if (e["source"], e["target"]) != (0, 1)]
    larger_edges += [edge(0, 3), edge(3, 1)]
    larger = scenario(4, [0], [dict(edges=larger_edges)], name="Lemma 9 - one subdivided arc")
    assert all(strong_connected(v["n"], v["rounds"][0]["edges"]) for v in (original, small, larger))
    assert signature(original, 1) == signature(small, 1) == signature(larger, 1)
    support = {0} | {e["source"] for e in original["rounds"][0]["edges"] if e["target"] == 0}
    assert support == {0, 5}
    snap = simulate(original, max_rounds=1, passive=True)["snapshots"][-1]
    visible = [v for v in snap["nodes"] if v["id"] in snap["agents"][0]["visible_nodes"] and v["level"] >= 0]
    nu = len(visible)
    M = max([1] + [int(v["outdegree"]) for v in visible] +
            [int(e["multiplicity"]) for v in visible for e in v["incoming"]])
    bound = (1 + nu * M) + 1 + 2
    assert nu == 3 and M == 1 and bound == 7 and small["n"] != larger["n"] <= bound
    return example(9, "Bounded compatible orders", "lem:conp-bounded-orders",
        "Keep the causal support, then change the population outside it.",
        "One round of a six-agent cycle is contracted to three agents and expanded to four. "
        "The exact observer signatures agree. The general proof bounds causal support and "
        "applies this construction round by round; this example does not enumerate the spectrum.",
        ["All three round graphs are strongly connected.",
         "Observer 0 has exactly the same canonical round-1 history at orders 6, 3, and 4.",
         "The two constructed orders are at most K + ell + 2 = 7."], [
            frame("Only two agents have influenced the observer", "After one round, the four other agents are outside the causal support.",
                  [physical("Six agents", original, highlight=(0, 5), details={0: "observer", 5: "sender"})],
                  [("Observed round", 1), ("Causal support", "2 of 6")], round=1),
            frame("Merge the hidden agents", "Keep every parallel arc and loop created by contraction.",
                  [physical("Three agents", small, highlight=(0, 2), labels={1: "h", 2: "5"},
                            details={0: "observer", 1: "four merged"})],
                  [("Population", 3), ("Observer history", "unchanged")], round=1),
            frame("Insert one new hidden agent", "Subdivide an outgoing arc without changing what reaches the observer.",
                  [physical("Four agents", larger, highlight=(3,), labels={1: "h", 2: "5", 3: "new"},
                            details={0: "observer"})],
                  [("Population", 4), ("Observer history", "unchanged")], round=1),
            frame("Two small witnesses", "Different populations can explain exactly the same observation.",
                  [physical("Order 3", small, labels={1: "h", 2: "5"}),
                   physical("Order 4", larger, labels={1: "h", 2: "5", 3: "new"})],
                  [("Compatible witness orders", "3 and 4"), ("Lemma bound", 7)], round=1),
        ], scenario=original, scenarios=[small, larger])


def balanced_vertex():
    vertices = ["a", "b", "c"]
    original = [(v, "z") for v in vertices] + [("z", v) for v in vertices]
    stages = [[(v, v) for v in vertices], [("a", "b"), ("b", "a"), ("c", "c")],
              [("a", "b"), ("b", "c"), ("c", "a")]]
    assert sum(b == "z" for a, b in original) == sum(a == "z" for a, b in original) == 3
    assert ("z", "z") not in original
    def reachable(pairs, source):
        seen, pending = {source}, [source]
        while pending:
            a = pending.pop()
            for x, y in pairs:
                if x == a and y not in seen:
                    seen.add(y)
                    pending.append(y)
        return seen
    assert all(set(vertices) <= reachable(original, v) for v in vertices)
    for pairs in stages:
        assert Counter(a for a, b in pairs) == Counter(vertices)
        assert Counter(b for a, b in pairs) == Counter(vertices)
    assert [len({frozenset(reachable(p, v)) for v in vertices}) for p in stages] == [3, 2, 1]
    for before, after in zip(stages, stages[1:]):
        assert all(reachable(before, v) <= reachable(after, v) for v in vertices)
    drawings = [network("Balanced auxiliary vertex", [
        node("a", x=.18, y=.25), node("b", x=.82, y=.25), node("c", x=.5, y=.82),
        node("z", detail="3 in · 3 out", highlight=True, x=.5, y=.46)],
        [arc(a, b) for a, b in original])]
    for i, pairs in enumerate(stages):
        drawings.append(network(["An arbitrary pairing", "Switch two pairings", "A strongly connected cycle"][i],
            [node(v, group=(0 if i == 2 else (0 if v in "ab" and i == 1 else j)),
                  x=[.2, .8, .5][j], y=[.25, .25, .8][j]) for j, v in enumerate(vertices)],
            [arc(a, b, highlight=i > 0 and a != b) for a, b in pairs]))
    return example(10, "Eliminating a balanced auxiliary vertex", "lem:conp-balanced-vertex",
        "Switch shortcut pairings until all components join.",
        "A three-leaf bidirected star supplies a concrete balanced auxiliary vertex. "
        "Each pairing preserves every real vertex's degrees. The switches preserve old reachability "
        "and merge components, illustrating the general switching proof.",
        ["The auxiliary vertex has equal indegree and outdegree and no loop.",
         "All shortcut stages preserve the real vertices' in- and outdegrees.",
         "The component count falls from 3 to 2 to 1 without losing reachability."], [
            frame("Route everything through z", "The auxiliary vertex receives and sends the same number of arcs.", drawings[:1], [("Incoming arcs", 3), ("Outgoing arcs", 3)]),
            frame("A careless pairing can disconnect", "Pairing each incoming arc with its own return creates three isolated loops.", drawings[1:2], [("Strong components", 3)]),
            frame("Swap two shortcuts", "Cross the pairings to join two components while preserving all degrees.", drawings[2:3], [("Strong components", 2)]),
            frame("Repeat until connected", "One more switch produces a directed cycle on the original vertices.", drawings[3:4], [("Strong components", 1), ("Auxiliary vertices", 0)]),
        ])


def transition():
    realized = scenario(4, [0, 1], [dict(edges=[edge(0, 2), edge(2, 1), edge(1, 3), edge(3, 0)])],
                        name="Lemma 11 - realized balanced transition")
    sizes, degree = {"U": 2, "W": 2}, {"U": 1, "W": 1}
    receipts = {("U", "U"): 0, ("U", "W"): 1, ("W", "U"): 1, ("W", "W"): 0}
    assert all(sizes[u] * degree[u] == sum(sizes[w] * receipts[u, w] for w in sizes) for u in sizes)
    assert strong_connected(4, realized["rounds"][0]["edges"])
    group = {0: "U", 1: "U", 2: "W", 3: "W"}
    for target in range(4):
        got = Counter(group[e["source"]] for e in realized["rounds"][0]["edges"] if e["target"] == target)
        assert all(got[u] == receipts[u, group[target]] for u in sizes)
        assert sum(e["source"] == target for e in realized["rounds"][0]["edges"]) == 1
    aux_nodes = [node("0", "a", leader=True, x=.2, y=.2), node("1", "b", leader=True, x=.2, y=.8),
                 node("2", "c", x=.8, y=.2), node("3", "d", x=.8, y=.8),
                 node("zU", detail="balanced", highlight=True, x=.48, y=.28),
                 node("zW", detail="balanced", highlight=True, x=.52, y=.72)]
    aux_edges = [arc(a, b) for a, b in [("0", "zU"), ("1", "zU"), ("zU", "2"), ("zU", "3"),
                                       ("2", "zW"), ("3", "zW"), ("zW", "0"), ("zW", "1")]]
    table = network("Two history classes", [node("U", detail="2 leaders", leader=True, x=.25, y=.5),
                                            node("W", detail="2 nonleaders", x=.75, y=.5)],
                    [arc("U", "W", label="1 per receiver"), arc("W", "U", label="1 per receiver")])
    return example(11, "Realizing a transition", "lem:conp-transition",
        "Balanced class-level requirements can be wired into a real round.",
        "This four-agent instance satisfies positive degrees, exact flow balance, and a strongly connected "
        "class digraph. Removing the two balanced auxiliary vertices gives the displayed round. "
        "The lemma establishes sufficiency for arbitrary binary-encoded class tables.",
        ["Both old fibers have outgoing flow 2 and required incoming-target flow 2.",
         "Every agent has outdegree 1 and receives one state from the opposite old fiber.",
         "The resulting four-agent graph is strongly connected."], [
            frame("Start from class requirements", "Every agent needs one message from the opposite class.", [table], [("Agents", 4), ("Outdegree per agent", 1)]),
            frame("Balance supply and demand", "Each class supplies two arcs, exactly matching the two required receipts.", [table], [("Flow from U", "2 supplied · 2 required"), ("Flow from W", "2 supplied · 2 required")]),
            frame("Introduce balanced auxiliaries", "Route outgoing capacity through one auxiliary vertex per old class.", [network("Auxiliary construction", aux_nodes, aux_edges)], [("Balanced auxiliaries", 2)]),
            frame("Remove the auxiliaries", "Shortcut the paths to obtain one strongly connected communication round.", [physical("A valid realization", realized, labels={0:"a",1:"b",2:"c",3:"d"})], [("Required receipts", "preserved"), ("Strong connectivity", "preserved")]),
        ], scenario=realized)


def normal_form():
    original_edges = [edge(i, (i + 1) % 6) for i in range(6)] + [edge(i, i, i) for i in range(1, 5)]
    original = scenario(6, [0], [dict(edges=original_edges)], name="Lemma 12 - distinct hidden histories")
    normalized_edges = [edge(0, 5), edge(5, 0)] + [edge(i, 5, 7) for i in range(1, 5)]
    normalized_edges += [edge(5, i) for i in range(1, 5)] + [edge(5, 5, 4)]
    normalized = scenario(6, [0], [dict(edges=normalized_edges)], name="Lemma 12 - normalized hidden histories")
    assert all(strong_connected(6, s["rounds"][0]["edges"]) for s in (original, normalized))
    assert signature(original, 1) == signature(normalized, 1)
    snaps = [simulate(s, max_rounds=1, passive=True)["snapshots"][-1] for s in (original, normalized)]
    partitions = [[set(v["fiber"]) for v in s["nodes"] if v["level"] == 1] for s in snaps]
    assert len(partitions[0]) == 6
    assert {frozenset(x) for x in partitions[1]} == {frozenset({0}), frozenset({5}), frozenset({1,2,3,4})}
    assert len(partitions[1]) == 3 <= 2 + 1 + 1 + 2
    compressed = network("Normalized history partition", [
        node("L0", "L", leader=True, detail="1 agent", x=.2, y=.2), node("N0", "N", detail="5 agents", x=.7, y=.2),
        node("L1", "L", leader=True, detail="observer", x=.2, y=.8), node("H1", "H", detail="4 agents · d=7", x=.55, y=.8),
        node("q1", "q", detail="1 agent · d=9", highlight=True, x=.85, y=.8)],
        [arc("L0", "L1", kind="black"), arc("N0", "H1", kind="black"), arc("N0", "q1", kind="black")],
        "Black edges show refinement; labels include external fiber sizes.")
    return example(12, "Small full prefix", "lem:conp-normal-form",
        "Simplify hidden histories while keeping the observer's vista fixed.",
        "This is one normalization transition: all six physical agents and the leader are retained. "
        "Visible incoming records and outdegrees are unchanged; four hidden histories become one block. "
        "The general lemma repeats the construction at every level and bounds encoding length.",
        ["The original and normalized six-agent graphs are strongly connected.",
         "Observer 0 has the same canonical round-1 vista in both graphs.",
         "Six level-1 histories become exactly three, with fibers {0}, {5}, and {1,2,3,4}.",
         "The displayed degree labels 7 and 9 and the lemma's level bound are satisfied."], [
            frame("Hidden histories need not be preserved", "The observer sees one incoming nonleader state; hidden agents may have many different histories.",
                  [physical("Six different round-1 histories", original, highlight=(0,), details={0:"observer"})], [("Agents", 6), ("History classes", 6)], round=1),
            frame("Route hidden traffic through q", "Keep the observer's incoming arc and outdegree exactly as before.",
                  [physical("Rewire hidden history information", normalized, highlight=(5,), labels={5:"q"}, details={0:"observer"})], [("Observer vista", "unchanged"), ("Agents retained", 6)], round=1),
            frame("Hidden agents share a signature", "Four agents now have the same degree and incoming history, so they form one block.",
                  [compressed], [("History classes", 3), ("Merged hidden fiber", "4 agents")], round=1),
            frame("A smaller description of the same observation", "The network keeps its size, but its full history table becomes simpler.",
                  [physical("Original: six classes", original, highlight=(0,)), compressed], [("Population before / after", "6 / 6"), ("History classes before / after", "6 / 3")], round=1),
        ], scenario=original, scenarios=[normalized])


def certificate():
    value = scenario(4, [0], [dict(edges=[edge(i, (i + 1) % 4) for i in range(4)])],
                     name="Lemma 13 - four-agent certificate")
    snap = simulate(value, max_rounds=1, passive=True)["snapshots"][-1]
    old = {"L": 1, "N": 3}
    rows = [dict(id="L1", parent="L", a=1, d=1, incoming={"N":1}),
            dict(id="A", parent="N", a=1, d=1, incoming={"L":1}),
            dict(id="B", parent="N", a=2, d=1, incoming={"N":1})]
    def verify(data):
        assert all(isinstance(r["a"], int) and r["a"] > 0 for r in data)
        assert sum(r["a"] for r in data) == 4
        assert sum(r["a"] for r in data if r["parent"] == "L") == 1
        for parent, count in old.items():
            assert sum(r["a"] for r in data if r["parent"] == parent) == count
            assert sum(r["a"] * r["d"] for r in data if r["parent"] == parent) == sum(r["a"] * r["incoming"].get(parent, 0) for r in data)
            children = [r for r in data if r["parent"] == parent]
            assert len({(r["d"], tuple(sorted(r["incoming"].items()))) for r in children}) == len(children)
        assert all(r["d"] > 0 and sum(r["incoming"].values()) > 0 for r in data)
        quotient = [edge(i, j) for i, a in enumerate(data) for j, b in enumerate(data) if b["incoming"].get(a["parent"], 0) > 0]
        assert strong_connected(len(data), quotient)
    verify(rows)
    old_names = {v["id"]: "L" if v["leader"] else "N" for v in snap["nodes"] if v["level"] == 0}
    actual_rows = sorted((old_names[v["parent"]], len(v["fiber"]), int(v["outdegree"]),
                          tuple(sorted((old_names[e["source"]], int(e["multiplicity"])) for e in v["incoming"])))
                         for v in snap["nodes"] if v["level"] == 1)
    expected_rows = sorted((r["parent"], r["a"], r["d"], tuple(sorted(r["incoming"].items()))) for r in rows)
    assert actual_rows == expected_rows
    visible = [v for v in snap["nodes"] if v["id"] in snap["agents"][0]["visible_nodes"]]
    assert sorted((v["level"], v["leader"]) for v in visible) == [(-1,False),(0,False),(0,True),(1,True)]
    bad = deepcopy(rows)
    bad[-1]["a"] = 3
    try:
        verify(bad)
    except AssertionError:
        pass
    else:
        raise AssertionError("The inconsistent certificate was accepted")
    def diagram(bad=False):
        return network("Full-prefix table" if not bad else "One corrupted anonymity", [
            node("L", leader=True, detail="1 agent", x=.2, y=.18), node("N", detail="3 agents", x=.7, y=.18),
            node("L1", "L′", leader=True, detail="observer · 1", highlight=not bad, x=.2, y=.8), node("A", detail="1 agent", x=.55, y=.8),
            node("B", detail="3 agents" if bad else "2 agents", highlight=bad, group=2 if bad else 1, x=.85, y=.8)],
            [arc("L", "L1", kind="black"), arc("N", "A", kind="black"), arc("N", "B", kind="black"),
             arc("N", "L1", kind="red"), arc("L", "A", kind="red"), arc("N", "B", kind="red")],
            "Black: refinement. Red: received old state. Every new outdegree is 1.")
    return example(13, "Fixed-order certificates", "lem:conp-fixed-order",
        "Verify a compact history table instead of listing a large execution.",
        "The illustrated table is a complete one-round certificate for a four-agent cycle. "
        "It checks conservation, leader count, exact flows, distinct signatures, realizability, "
        "and the terminal backward closure. The lemma's polynomial-size statement is general, "
        "not inferred from this small certificate.",
        ["The full table matches the independent oracle's partition and labels.",
         "Positive anonymities, totals, leader count, parent conservation, flow, distinct siblings, and class connectivity pass.",
         "The observer's backward closure has exactly the displayed input vista.",
         "Changing the size of B from 2 to 3 is rejected."], [
            frame("A concrete four-agent realization", "A certificate records groups of equal histories, not one row per physical agent.", [physical("One communication round", value, highlight=(0,))], [("Network order", 4)], round=1),
            frame("Check the full history table", "The nonleader parent splits into fibers of one and two agents.", [diagram()], [("Parent conservation", "3 = 1 + 2"), ("Leader count", 1)], round=1),
            frame("Check flow and the observer's closure", "Every required receipt is supplied, and the selected bottom node exposes exactly the input vista.", [diagram()], [("Leader flow", "1 out · 1 accounted"), ("Nonleader flow", "3 out · 3 accounted")], round=1),
            frame("A wrong entry is detectable", "Changing one fiber size breaks conservation and the claimed network order.", [diagram(True)], [("Claimed order", 4), ("Altered total", 5), ("Certificate", "rejected")], round=1),
        ], scenario=value)


def x3c_instance():
    q, B = 2, 5
    triples = [{0,1,2}, {3,4,5}, {0,3,4}]
    K = B ** (3*q)
    W = sum(B**e for e in range(3*q))
    A = q*K + W
    coefficients = [A] + [K + sum(B**e for e in S) for S in triples]
    solutions = [x for x in product(range(q+1), repeat=4) if sum(c*v for c,v in zip(coefficients,x)) == A]
    assert K == 15625 and A == 35156
    assert coefficients == [35156,15656,19500,16376]
    assert solutions == [(0,1,1,0),(1,0,0,0)]
    assert all(sum(x) <= q for x in solutions)
    for x in solutions:
        if x[0] == 0:
            assert all(sum(x[j+1] for j, S in enumerate(triples) if e in S) == 1 for e in range(6))
    return q, B, K, A, triples, coefficients


def digits():
    q, B, K, A, triples, coefficients = x3c_instance()
    def cover_graph(selected, title):
        counts = Counter(e for j in selected for e in triples[j])
        nodes = [node(f"e{e}", str(e+1), detail=("missing" if not counts[e] else "twice" if counts[e] > 1 else "once"),
                      group=2 if counts[e] != 1 else 1, highlight=counts[e] != 1,
                      x=.08 + e*.168, y=.2) for e in range(6)]
        nodes += [node(f"s{j}", f"S{j+1}", group=j, muted=j not in selected,
                       x=.2 + j*.3, y=.75) for j in range(3)]
        edges = [arc(f"s{j}", f"e{e}", highlight=j in selected) for j in selected for e in triples[j]]
        return network(title, nodes, edges, "Numbers 1–6 denote the six universe elements.")
    assert sum(coefficients[j+1] for j in (0,1)) == A
    assert sum(coefficients[j+1] for j in (0,2)) != A
    return example(14, "One reference solution, or an exact cover", "lem:conp-digits",
        "Use carry-free digits to make overlap and omissions visible.",
        "The X3C instance has six elements and three triples. The exact paper encoding uses base 5; "
        "all nonnegative coordinate vectors with sum at most 2 are checked. Its only solutions are "
        "the reference choice and the unique exact cover S1,S2. No claim about arbitrary instances "
        "is inferred from this enumeration.",
        ["The exact paper coefficients are 35156, 15656, 19500, and 16376.",
         "Exhaustive enumeration within the proved coordinate bound gives exactly two solutions.",
         "S1 and S2 cover every element once; S1 and S3 overlap and omit elements.",
         "All element digits are at most 2, strictly below base 5, so no carries occur."], [
            frame("An exact cover touches every element once", "Two disjoint triples cover all six elements.", [cover_graph((0,1), "Choose S1 and S2")], [("Selected triples", 2), ("Coverage", "one per element")]),
            frame("Overlap leaves a visible mismatch", "Replacing S2 by S3 covers one element twice and leaves one uncovered.", [cover_graph((0,2), "Choose S1 and S3")], [("Coverage", "not exact")]),
            frame("Pack the coverage into digits", "Use one digit per element. The base is large enough that counts cannot carry.",
                  [network("Coverage digits, one per element", [node(str(i), "1", detail=f"element {i+1}", x=.08+i*.168, y=.5) for i in range(6)])],
                  [("Base", B), ("Largest possible digit", q), ("Carries", "none")]),
            frame("Exactly two ways to hit the target", "The single reference choice and the exact cover have the same encoded weight.",
                  [network("Reference choice", [node("ref", "ref", detail="35,156", highlight=True, x=.5, y=.5)]),
                   network("Exact-cover choice", [node("s1", "S1", detail="15,656", x=.25, y=.5), node("s2", "S2", detail="19,500", x=.75, y=.5)])],
                  [("Common target", "35,156"), ("Nonnegative solutions", 2)]),
        ])


def path_instances():
    q, B, K, A, triples, coefficients = x3c_instance()
    sizes0, sizes1 = [6,5,5,5], [5,6,6,5]
    C = B*sum(coefficients) + A
    R = 1 + len(coefficients)*B
    assert R == 21 and C == 468596
    assert sum(a*c for a,c in zip(sizes0,coefficients)) == sum(a*c for a,c in zip(sizes1,coefficients)) == C
    def make(sizes, alternative=False):
        groups, offset = [], 1
        for a in sizes:
            groups.append(list(range(offset, offset+a)))
            offset += a
        forward = [edge(0, x, c) for c, group in zip(coefficients, groups) for x in group]
        paths = [edge(a,b) for group in groups for a,b in zip(group, group[1:] + [0])]
        final = [edge(x,0) for group in groups for x in group]
        if alternative:
            suffix0 = groups[0][B-1:]
            assert len(suffix0) == 1
            final = [e for e in final if e["source"] != suffix0[0]] + [edge(suffix0[0], 0, 2)]
            for j in (1,2):
                a,b = groups[j][B-1:]
                final = [e for e in final if e["source"] != a] + [edge(a,b)]
        rounds = [dict(edges=deepcopy(forward + paths)) for _ in range(B-1)] + [dict(edges=forward + final)]
        value = scenario(offset, [0], rounds, name="Lemma 15-16 - " + ("exact-cover alternative" if alternative else "reference prefix"), repeat_last=True)
        assert all(strong_connected(offset,g["edges"]) for g in rounds)
        return value, groups
    ref, ref_groups = make(sizes0)
    alt, alt_groups = make(sizes1, True)
    traces = [simulate(s, max_rounds=B, passive=True)["snapshots"] for s in (ref,alt)]
    for r in range(1,B):
        signature_sets = []
        for trace, groups in zip(traces,(ref_groups,alt_groups)):
            snap = trace[r]
            sigs = node_signatures(snap)
            signature_sets.append({sigs[v["id"]] for v in snap["nodes"] if 0 <= v["level"] <= r})
            for group in groups:
                fibers = {frozenset(v["fiber"]) for v in snap["nodes"] if v["level"] == r and set(v["fiber"]) <= set(group)}
                expected = {frozenset({x}) for x in group[:r]} | {frozenset(group[r:])}
                assert fibers == expected
            assert len([v for v in snap["nodes"] if v["level"] == r]) == 1+4*(r+1)
        assert signature_sets[0] == signature_sets[1]
    assert signature(ref,B) == signature(alt,B)
    for trace, value in zip(traces,(ref,alt)):
        final = trace[B]
        visible = set(final["agents"][0]["visible_nodes"])
        for r in range(1,B):
            union = set().union(*(set(v["fiber"]) for v in final["nodes"] if v["id"] in visible and v["level"] == r))
            assert union == set(range(value["n"]))
    return dict(q=q, B=B, R=R, C=C, ref=ref, alt=alt, traces=traces, sizes0=sizes0, sizes1=sizes1)


def path_prefix(data):
    def group_drawing(size, r, title):
        nodes = [node("L", "λ", leader=True, detail="same outdegree", x=.5, y=.12)]
        nodes += [node(str(i), str(i+1), detail="singleton" if i < r else "same suffix", group=(i%5+1 if i<r else 0),
                       highlight=i==r-1, x=.08+i*.84/(size-1), y=.68) for i in range(size)]
        edges = [arc("L", str(i), **({"label":"c₀"} if i==0 else {})) for i in range(size)]
        edges += [arc(str(i), str(i+1)) for i in range(size-1)] + [arc(str(size-1), "L")]
        return network(title, nodes, edges, "Group 0 only. All λ→member arcs have c₀ copies; three omitted paths balance λ's outdegree.")
    captions = ["The first position separates; every later position still has the same history.",
                "One more position becomes distinguishable in each network.",
                "The split moves along the path, one round at a time.",
                "The same labeled classes remain, even though their suffix fibers have different sizes."]
    frames = []
    for r in range(1,5):
        frames.append(frame(f"Path prefix · round {r}", captions[r-1],
            [group_drawing(6,r,"Reference group 0 · 6 agents"), group_drawing(5,r,"Alternative group 0 · 5 agents")],
            [("Full network orders", "22 and 23"), ("Suffix sizes in group 0", f"{6-r} and {5-r}"), ("History labels", "identical")], round=r))
    return example(15, "Common path prefix", "lem:conp-path-prefix",
        "A path reveals one new position per round while hiding its remaining length.",
        "Both full constructions use the exact coefficients from Lemma 14 and equal leader outdegree 468596. "
        "Only group 0 is expanded in the drawing. Canonical signatures of every full history level "
        "agree through round 4; physical fiber sizes intentionally differ. The final graphs are also "
        "exported and reproduce the reference leader's round-5 vista.",
        ["The reference and alternative orders are 22 and 23, with the same leader outdegree 468596.",
         "Every group splits into r singleton classes and one suffix after rounds r=1,2,3,4.",
         "The complete labeled history prefixes, ignoring fiber sizes, have equal canonical signature sets.",
         "Both final-round leader vistas agree, and every round graph is strongly connected."],
        frames, scenario=data["ref"], scenarios=[data["alt"]])


def first_full(data):
    R,q,B = data["R"],data["q"],data["B"]
    assert B-2 == q+1 == 3
    assert R+q-(B-2) == R-1 == 20
    def shrinking(stage):
        nodes = [node(str(r), str(R+q-r+1), detail=f"level {r}",
                      highlight=r==stage, muted=r>stage, group=2 if r==4 else 1,
                      x=.12+(r-1)*.25, y=.45) for r in range(1,5)]
        return network("Assume the first visible level is not full", nodes,
                       [arc(str(r),str(r+1),label="lose ≥ 1", highlight=r<stage) for r in range(1,4)],
                       "Hypothetical upper bounds on visible support; not an observed execution.")
    return example(16, "The first visible level is full", "lem:conp-first-full",
        "Hidden agents would force more losses than the visible support can afford.",
        "For the same q=2 instance, the initial visible support has size at most 23 and level 4 "
        "needs at least 21 agents. Assuming an unseen agent forces three strict decreases, leaving "
        "at most 20: a contradiction. The oracle separately confirms fullness in the two explicit "
        "realizations, while the support argument applies to every compatible realization.",
        ["The construction has R=21, q=2, B=5, so the initial slack is at most 2.",
         "There are exactly B-2=3 transitions, forcing a hypothetical bound of 20 < 21.",
         "The reference and alternative final leader vistas have identical canonical signatures.",
         "Their first visible levels contain all 22 and all 23 agents, respectively."], [
            frame("Only two agents of slack", "The first visible level can contain at most 23 agents; the last needs at least 21.", [shrinking(1)], [("Initial upper bound", 23), ("Final lower bound", 21)]),
            frame("An unseen agent forces a loss", "Strong connectivity makes every proper visible support shrink at the next level.", [shrinking(2)], [("Hypothetical upper bound", 22), ("Transitions used", 1)]),
            frame("The slack is exhausted", "After two strict decreases, only the required minimum remains.", [shrinking(3)], [("Hypothetical upper bound", 21), ("Transitions still required", 1)]),
            frame("One more decrease is impossible", "Three losses exceed the two-agent slack. The first visible level must be full.", [shrinking(4)], [("Hypothetical maximum", 20), ("Required minimum", 21), ("Conclusion", "no unseen agents at level 1")]),
        ], scenario=data["ref"], scenarios=[data["alt"]])


def build_examples():
    data = path_instances()
    return [bounded_orders(), balanced_vertex(), transition(), normal_form(), certificate(),
            digits(), path_prefix(data), first_full(data)]


if __name__ == "__main__":
    import json
    values = build_examples()
    print(json.dumps({"examples": len(values), "frames": sum(len(x["frames"]) for x in values),
                      "checks": sum(len(x["checks"]) for x in values)}))
