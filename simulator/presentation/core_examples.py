"""Checked visual illustrations of the counting lemmas and the lower bound.

The diagrams expose observer knowledge. Numerical annotations come from the
independent history-tree oracle; proof-only assignments are explicitly marked.
"""
from __future__ import annotations

from copy import deepcopy
from fractions import Fraction
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from fixtures import cycle_edges, edge, lowerbound_pair, scenario, strong_connected, two_center
from oracle import node_signatures, simulate, solve_exact


def frame(title, caption, networks, metrics=(), duration=5, **kwargs):
    return dict(title=title, caption=caption, duration=duration, networks=networks,
                metrics=[dict(label=k, value=str(v)) for k, v in metrics], **kwargs)


def example(number, title, label, kind, summary, proof_note, checks, frames, **kwargs):
    return dict(id=f"lemma-{number:02}", number=number, title=title, label=label,
                section="Counting and sharp bounds" if number < 8 else "Termination lower bounds",
                kind=kind, summary=summary, proof_note=proof_note, checks=checks,
                frames=frames, **kwargs)


def network(s, t=1, *, title=None, highlights=(), muted=(), edge_highlights=(),
            groups=None, labels=None, details=None, note=None):
    graph = s["rounds"][min(max(1, t) - 1, len(s["rounds"]) - 1)]
    nodes = []
    for a in range(s["n"]):
        item = dict(id=str(a), label=(labels or {}).get(a, str(a)),
                    leader=a in s["leaders"], highlight=a in highlights,
                    muted=a in muted, group=(groups or {}).get(a, 0))
        if details and a in details:
            item["detail"] = details[a]
        nodes.append(item)
    result = dict(title=title or s.get("name", "Communication graph"), nodes=nodes,
                  edges=[dict(source=str(e["source"]), target=str(e["target"]),
                              multiplicity=e["multiplicity"], kind="communication",
                              highlight=(e["source"], e["target"]) in edge_highlights)
                         for e in graph["edges"]])
    if note:
        result["note"] = note
    return result


def partition(snapshot, level):
    return sorted((v for v in snapshot["nodes"] if v["level"] == level),
                  key=lambda v: (not v["leader"], min(v["fiber"])))


def accepted_counts(snapshot, observer=0):
    """Reconstruct the tested candidate values, rather than assuming them."""
    agent = snapshot["agents"][observer]
    audit = agent["audit"]
    assert audit["status"] == "accepted"
    visible = set(agent["visible_nodes"])
    counts = {item["node"]: Fraction(item["value"]) for item in audit["solution"]}
    for r in range(audit["anchor"] - 1, -1, -1):
        for u in partition(snapshot, r):
            if u["id"] in visible:
                counts[u["id"]] = sum((counts[v["id"]] for v in partition(snapshot, r + 1)
                                        if v["parent"] == u["id"] and v["id"] in visible), Fraction(0))
    for v in snapshot["nodes"]:
        if v["id"] in counts:
            assert counts[v["id"]] == len(v["fiber"])
    return counts


def partition_network(snapshot, level, *, credit=False, inside=None, title=None):
    classes = partition(snapshot, level)
    nodes = []
    for i, v in enumerate(classes):
        a = len(v["fiber"])
        detail = f"{a} agent{'s' if a != 1 else ''}"
        if credit:
            detail += f" · credit {a - 1}"
        if inside is not None:
            detail += " · inside" if set(v["fiber"]) <= inside else " · crosses S"
        members = v["fiber"]
        label = "{" + ",".join(map(str, members)) + "}" if len(members) <= 2 else f"{min(members)}…{max(members)}"
        nodes.append(dict(id=str(v["id"]), label=label,
                          detail=detail, leader=v["leader"], group=i % 6,
                          highlight=inside is not None and set(v["fiber"]) <= inside))
    return dict(title=title or f"History level {level}", nodes=nodes, edges=[],
                note="Each node is a fiber, not a physical agent.")


def _flat():
    s = scenario(4, [0], [dict(edges=[edge(a, b) for x in (1, 2, 3)
                                    for a, b in ((0, x), (x, 0))])],
                 variant="core", name="Flat star: one leader, three leaves")
    trace = simulate(s)
    snap = trace["snapshots"][-1]
    assert trace["termination_round"] == 7
    level0, level1 = partition(snap, 0), partition(snap, 1)
    assert sorted(len(v["fiber"]) for v in level1) == [1, 3]
    assert all(sum(w["parent"] == v["id"] for w in level1) == 1 for v in level0)
    assert {v["id"] for v in level1} <= set(snap["agents"][0]["visible_nodes"])
    status, solution = solve_exact([[-3, 1], [3, -1], [1, 0]], [0, 0, 1], 2)
    assert status == "unique" and solution == [Fraction(1), Fraction(3)]
    audit = snap["agents"][0]["audit"]
    assert audit["status"] == "accepted" and sorted(x["value"] for x in audit["solution"]) == ["1", "3"]

    def quotient(solved=False, flow=False):
        return dict(title="Full, flat level", nodes=[
            dict(id="L", label="L", detail="1 leader" if solved else "leader class",
                 leader=True, x=.25, y=.5, highlight=solved),
            dict(id="N", label="N", detail="3 nonleaders" if solved else "nonleader class",
                 x=.75, y=.5, highlight=solved)], edges=[
                     dict(source="L", target="N", label="1 message", kind="red", highlight=flow),
                     dict(source="N", target="L", label="3 messages", kind="red", highlight=flow)],
            note="Red labels count messages per receiving agent.")
    tree = dict(title="No class splits", nodes=[
        dict(id="L0", label="L", leader=True, x=.25, y=.22),
        dict(id="N0", label="N", x=.75, y=.22),
        dict(id="L1", label="L", leader=True, x=.25, y=.78),
        dict(id="N1", label="N", x=.75, y=.78)], edges=[
            dict(source="L0", target="L1", kind="black"),
            dict(source="N0", target="N1", kind="black")], note="Black edges connect a class to its next-round class.")
    return example(1, "Flat level", "lem:flat-anonymities", "execution",
        "A full level without splits lets flow balance recover the class sizes.",
        "The star supplies a concrete full, flat level. Uniqueness is checked using only flow and the known leader count; the total is checked afterwards. The general lemma applies to every full, flat level.",
        ["All round graphs are strongly connected.", "Level 1 is full and flat in the final observer view.",
         "Exact flow plus leader equations have the unique solution (1, 3), before any total constraint.",
         "The oracle accepts 4 at round 7."], [
            frame("Four agents, two kinds of memory", "The three leaves have identical memories.",
                  [network(s, highlights=(1, 2, 3)), quotient()], [("Known leaders", 1), ("Memory classes", 2)]),
            frame("A flat transition", "Each old class has exactly one child: no class splits.", [tree, quotient()],
                  [("Old classes", 2), ("New classes", 2)]),
            frame("Count the same messages twice", "One leader sends three messages; each leaf receives one.",
                  [network(s, edge_highlights=((0, 1), (0, 2), (0, 3))), quotient(flow=True)],
                  [("Leader class", 1), ("Leaf class", 3)]),
            frame("The leader count fixes the scale", "Flow determines the proportions. One known leader fixes the sizes.",
                  [quotient(solved=True, flow=True)], [("Leader size", 1), ("Nonleader size", 3), ("Total", 4)]),
        ], scenario=s)


def _credit_refinement():
    s = scenario(6, [0], [dict(edges=cycle_edges(range(6)))], variant="core", name="Credit on a directed cycle")
    trace = simulate(s)
    snap = trace["snapshots"][-1]
    assert snap["agents"][0]["audit"]["status"] == "accepted"
    values = accepted_counts(snap)
    parent = next(v for v in partition(snap, 0) if not v["leader"])
    children = [v for v in partition(snap, 1) if v["parent"] == parent["id"]]
    assert sorted(len(v["fiber"]) for v in children) == [1, 4]
    assert len(parent["fiber"]) - 1 == 4
    assert sum(len(v["fiber"]) - 1 for v in children) == 3
    assert min(len(parent["fiber"]) - 1, values[parent["id"]]) == 4
    assert sum(min(len(v["fiber"]) - 1, values[v["id"]]) for v in children) == 3
    # A second, flat example illustrates equality with positive credit.
    flat = scenario(4, [0], [dict(edges=[edge(a, b) for x in (1, 2, 3)
                                       for a, b in ((0, x), (x, 0))])],
                    variant="core", name="Positive credit preserved on a flat star")
    flat_snap = simulate(flat)["snapshots"][-1]
    assert flat_snap["agents"][0]["audit"]["status"] == "accepted"
    accepted_counts(flat_snap)
    old = next(v for v in partition(flat_snap, 0) if not v["leader"])
    same = [v for v in partition(flat_snap, 1) if v["parent"] == old["id"]]
    assert len(same) == 1 and same[0]["fiber"] == old["fiber"] == [1, 2, 3]
    reserve = dict(title="Reserve one representative", nodes=[
        dict(id=str(i), label=str(i), highlight=i != 1, detail="reserved" if i == 1 else "1 credit",
             x=.12 + (i - 1) * .19, y=.5) for i in range(1, 6)], edges=[],
        note="Proof bookkeeping with the true candidate 6.")
    split = dict(title="The nonleader class splits", nodes=[
        dict(id="old", label="{1…5}", detail="5 agents · credit 4", x=.5, y=.2),
        dict(id="one", label="{1}", detail="1 agent · credit 0", x=.25, y=.78),
        dict(id="four", label="{2…5}", detail="4 agents · credit 3", x=.75, y=.78, highlight=True)],
        edges=[dict(source="old", target="one", kind="black"), dict(source="old", target="four", kind="black")],
        note="Every new class needs its own reserved representative.")
    stable = dict(title="Equality at a flat transition", nodes=[
        dict(id="old", label="1…3", detail="3 agents · credit 2", x=.5, y=.22),
        dict(id="new", label="1…3", detail="3 agents · credit 2", x=.5, y=.78, highlight=True)],
        edges=[dict(source="old", target="new", kind="black")], note="Same fiber; same candidate size; one child.")
    return example(2, "Credit under refinement", "lem:credit-refinement-split", "execution",
        "Splitting a class can only spend credit: each child needs a representative.",
        "The split uses candidate m=6 on a directed cycle; the equality example uses candidate m=4 on a star. Credits use observer-only true fiber sizes and candidate sizes from complete accepted audits, propagated backwards. Both examples satisfy the Step 1–4 hypotheses; the general inequality follows from disjoint refinement.",
        ["The accepted candidate is 6.", "The five-agent nonleader class splits into sizes 1 and 4.",
         "Credit falls from 4 to 0+3.", "On the star, one child preserves the three-agent fiber and its credit 2."], [
            frame("A class of five agents", "These nonleaders begin with the same memory.",
                  [network(s, highlights=range(1, 6)), partition_network(snap, 0, credit=True)],
                  [("Candidate", 6), ("Nonleader credit", 4)]),
            frame("One representative is reserved", "The remaining four agents can carry credit.", [reserve],
                  [("Agents", 5), ("Reserved", 1), ("Credit", 4)]),
            frame("A split spends credit", "Two child classes now need two representatives.", [split],
                  [("Before", 4), ("After", 3), ("Lost", 1)]),
            frame("Equality leaves no room for a split", "On this star, equal credit preserves all three leaves in one child class.",
                  [network(flat, highlights=(1, 2, 3)), stable], [("Children", 1), ("Credit", 2), ("Fiber", "unchanged")]),
        ], scenario=s, scenarios=[flat])


def _minimum_ratio():
    s = scenario(4, [0], [dict(edges=[edge(a, b) for x in (1, 2, 3)
                                    for a, b in ((0, x), (x, 0))])],
                 variant="core", name="Minimum-ratio closure on a star")
    actual = [Fraction(1), Fraction(3)]
    trial = [Fraction(1), Fraction(2)]
    ratios = [a / x for a, x in zip(actual, trial)]
    assert ratios == [1, Fraction(3, 2)]
    assert 3 * trial[0] != trial[1]
    assert strong_connected(s["n"], s["rounds"][0]["edges"])
    assert sum(int(e["multiplicity"]) for e in s["rounds"][0]["edges"]
               if e["source"] == 0 and e["target"] != 0) == 3
    status, answer = solve_exact([[-3, 1], [1, 0]], [0, 1], 2)
    assert status == "unique" and answer == actual
    assert [a / x for a, x in zip(actual, answer)] == [1, 1]
    trial_graph = dict(title="Trial assignment — not an accepted audit", nodes=[
        dict(id="L", label="L", leader=True, detail="size 1 / candidate 1", x=.25, y=.5, highlight=True),
        dict(id="N", label="N", detail="size 3 / candidate 2", x=.75, y=.5)],
        edges=[dict(source="L", target="N", label="3 out, only 2 counted", kind="red", highlight=True)],
        note="The leader class has the smallest true-to-candidate ratio.")
    all_graph = deepcopy(trial_graph)
    all_graph.update(title="Valid assignment: every class closes", note="All classes have ratio 1; the known leader count fixes this common ratio.")
    all_graph["nodes"][1].update(detail="size 3 / candidate 3", highlight=True)
    all_graph["edges"][0]["label"] = "3 out, 3 counted"
    return example(3, "Minimum-ratio closure", "lem:minimum-ratio-closure-split", "construction",
        "A closed smallest-ratio set cannot stop at a proper part of a strongly connected network.",
        "The first assignment is a deliberately invalid trial, not a C-engine decision. It illustrates the escaping-edge obstruction in the proof. The valid assignment is checked exactly and makes all classes minimum-ratio classes. The lemma also requires the stated parent/child fiber equality and checked flow equations.",
        ["The star is strongly connected and three arcs leave the trial minimum-ratio set.",
         "Trial ratios are 1 and 3/2, and the leader flow equation fails.",
         "The unique valid candidate sizes are 1 and 3, with common ratio 1."], [
            frame("Try a proper smallest-ratio set", "Suppose only the leader class has the smallest ratio.",
                  [trial_graph], [("Leader ratio", "1"), ("Leaf ratio", "1.5")]),
            frame("An edge must leave", "Strong connectivity forces communication out of every proper nonempty set.",
                  [network(s, highlights=(0,), edge_highlights=((0, 1), (0, 2), (0, 3))), trial_graph],
                  [("Arcs leaving the set", 3)]),
            frame("The escaping edge breaks balance", "The trial counts only two destinations for three outgoing messages.",
                  [trial_graph], [("Outgoing", 3), ("Counted by trial", 2), ("Result", "flow mismatch")]),
            frame("Closure reaches the whole network", "With the checked flow equations, no larger-ratio or hidden class can lie beyond the set.",
                  [all_graph, network(s, highlights=range(4))], [("Common ratio", 1), ("Represented agents", 4)]),
        ], scenario=s)


def _credit_loss():
    s = scenario(6, [0], [dict(edges=cycle_edges(range(6)))], variant="core", name="Credit loss until a flat level")
    trace = simulate(s)
    snap = trace["snapshots"][-1]
    assert snap["agents"][0]["audit"]["status"] == "accepted"
    values = accepted_counts(snap)
    phi = [sum(min(len(v["fiber"]) - 1, values[v["id"]]) for v in partition(snap, r)) for r in range(7)]
    assert phi == [4, 3, 2, 1, 0, 0, 0]
    frames = []
    for level in (0, 1, 2, 4, 5):
        classes = partition(snap, level)
        groups = {a: i for i, v in enumerate(classes) for a in v["fiber"]}
        title = "Each split spends credit" if level in (1, 2) else "Credit before refinement" if level == 0 else "No credit remains" if level == 4 else "Equality at the true candidate"
        caption = ("The leader and nonleader classes begin with four units of credit." if level == 0 else
                   "A new memory class needs one more reserved representative." if level in (1, 2) else
                   "All six agents now have distinct memories." if level == 4 else
                   "The next level preserves credit. Here the candidate is the true size: six.")
        frames.append(frame(title, caption, [network(s, groups=groups), partition_network(snap, level, credit=True)],
                            [("History level", level), ("Classes", len(classes)), ("Total credit", phi[level])]))
    return example(4, "Credit loss", "lem:credit-loss-split", "execution",
        "Credit never increases; preserving it under the checked equations forces the correct size.",
        "The illustrated credit values use the true candidate m=6 from a complete accepted audit. The stable transition is an example of the equality conclusion, not an empirical proof of it. In the general proof, minimum-ratio closure and leader accounting turn equality into m=n.",
        ["The accepted audit has m=n=6.", "Exact total credits at levels 0..6 are 4,3,2,1,0,0,0.",
         "Every level refines the previous one and the last two displayed partitions are identical."],
        frames, scenario=s)


def _tail_exposure():
    s = scenario(5, [0], [dict(edges=cycle_edges(range(5)))], variant="core", name="Backward causal support")
    snap = simulate(s, max_rounds=4, passive=True)["snapshots"][-1]
    support = {4: {0}}
    for r in range(4, 0, -1):
        targets = support[r]
        support[r - 1] = targets | {e["source"] for e in s["rounds"][0]["edges"] if e["target"] in targets}
    assert [len(support[r]) for r in (4, 3, 2, 1, 0)] == [1, 2, 3, 4, 5]
    visible = set(snap["agents"][0]["visible_nodes"])
    for r in range(5):
        union = set().union(*(set(v["fiber"]) for v in partition(snap, r) if v["id"] in visible))
        assert support[r] <= union and len(union) >= min(5, 4 - r + 1)
    frames = []
    for r in (4, 3, 2, 0):
        predecessors = {(e["source"], e["target"]) for e in s["rounds"][0]["edges"]
                        if r < 4 and e["target"] in support[min(4, r + 1)]}
        frames.append(frame("Look backwards from agent 0" if r == 4 else "The causal support expands" if r else "Every agent can affect the view",
                            "Start with the observer at round four." if r == 4 else
                            "Each backward step adds an outside predecessor, until the whole network is included." if r else
                            "Four backward steps expose all five agents in this cycle.",
                            [network(s, title=f"Causal support at level {r}", highlights=support[r],
                                     muted=set(range(5)) - support[r], edge_highlights=predecessors,
                                     note="Highlights show causal support; a visible fiber can contain additional agents.")],
                            [("Observer round", 4), ("History level", r), ("Supported agents", len(support[r]))]))
    return example(5, "Tail exposure", "lem:tail-exposure", "execution",
        "Tracing influence backwards reveals at least one new agent per round until the network is exhausted.",
        "This directed cycle attains the causal-support growth bound exactly. Highlights show physical causal support, which is contained in the union of visible fibers; the two sets need not be equal in other networks.",
        ["The backward supports have sizes 1,2,3,4,5.", "Every support is contained in the observer's visible fibers at that level.",
         "The visible-fiber union satisfies the lemma's lower bound at every level."], frames, scenario=s)


def _forward_fibers():
    s = scenario(5, [0], [dict(edges=cycle_edges(range(5)))], variant="core", name="Fibers trapped inside a proper subset")
    snap = simulate(s, max_rounds=3, passive=True)["snapshots"][-1]
    inside = {0, 1, 2}
    counts = []
    for level in range(3):
        contained = [v for v in partition(snap, level) if set(v["fiber"]) <= inside]
        counts.append(sum(not v["leader"] for v in contained))
        tails = set().union(*(set(v["fiber"]) for v in contained))
        escaping = [e for e in s["rounds"][0]["edges"] if e["source"] in tails and e["target"] not in inside]
        if level < 2:
            assert not escaping
        else:
            assert [(e["source"], e["target"]) for e in escaping] == [(2, 3)]
    assert counts == [0, 1, 2]
    frames = []
    for level in (0, 1, 2):
        frames.append(frame("Fix a proper set containing the leader" if level == 0 else "Another nonleader fiber enters the set",
                            "At first, the nonleader fiber crosses the boundary of S." if level == 0 else
                            "The leader's message separates agent 1 from the outside agents." if level == 1 else
                            "One more round isolates agent 2. Both nonleader slots in S are now used.",
                            [network(s, highlights=inside, muted={3, 4}, title="S = {0, 1, 2}",
                                     edge_highlights=((level - 1, level),) if level else ()),
                             partition_network(snap, level, inside=inside)],
                            [("History level", level), ("Nonleader fibers inside S", counts[level]), ("Available slots", 2)]))
    frames.append(frame("The assumption cannot last another round", "Agent 2 now belongs to an inside fiber, and its next message leaves S.",
                        [network(s, highlights=inside, muted={4}, edge_highlights=((2, 3),), title="Round 3 crosses the boundary"),
                         partition_network(snap, 2, inside=inside)],
                        [("Rounds satisfying the hypothesis", 2), ("Size of S minus leaders", 2)]))
    return example(6, "Fibers inside a proper subset", "lem:forward-fibers", "execution",
        "If already-contained fibers cannot send outside, each round must isolate a new nonleader fiber inside.",
        "On this fixed cycle, S={0,1,2} contains its one leader. The hypothesis holds for exactly two rounds and fails in round 3, attaining h=|S|−ell. Fibers and S are external proof information.",
        ["S is proper and contains all leaders.", "The no-outgoing-arc hypothesis holds in rounds 1 and 2.",
         "Contained nonleader-fiber counts are 0,1,2.", "In round 3 the contained fiber {2} sends to agent 3 outside S."],
        frames, scenario=s)


def _short_audit():
    s = scenario(5, [0, 1], [dict(edges=cycle_edges(range(5)))], variant="sharp", name="Two leaders: the shorter audit")
    trace = simulate(s)
    assert trace["termination_round"] == 8
    expected = {2: (2, "nonleader_visible"), 4: (3, "missing_child"),
                6: (4, "node_limit"), 8: (5, "accepted")}
    frames = []
    for t, (m, reason) in expected.items():
        snap = trace["snapshots"][t]
        audit = snap["agents"][0]["audit"]
        assert (audit["candidate"], audit["reason"]) == (m, reason)
        visible = set(snap["agents"][0]["visible_nodes"])
        def visible_level(r):
            return [v for v in partition(snap, r) if v["id"] in visible]
        evidence_nodes, evidence_edges = [], []
        if t == 2:
            current = visible_level(0)
            assert any(not v["leader"] for v in current)
            for v in current:
                evidence_nodes.append(dict(id=str(v["id"]), label="L" if v["leader"] else "N",
                    leader=v["leader"], highlight=not v["leader"], detail="leaders" if v["leader"] else "nonleaders visible"))
            evidence_title = "Level 0 contains a nonleader class"
            evidence_note = "A nonleader class alone rules out n = ell."
        elif t == 4:
            old, new = visible_level(1), visible_level(2)
            missing = [v for v in old if not any(w["parent"] == v["id"] for w in new)]
            assert len(missing) == 1 and missing[0]["fiber"] == [2]
            for row, nodes in enumerate((old, new)):
                for index, v in enumerate(nodes):
                    evidence_nodes.append(dict(id=str(v["id"]), label="{" + ",".join(map(str, v["fiber"])) + "}",
                        leader=v["leader"], highlight=v in missing,
                        detail="no visible child" if v in missing else f"level {row + 1}",
                        x=.18 + index * .32, y=.25 + row * .5))
            old_ids = {v["id"] for v in old}
            evidence_edges = [dict(source=str(v["parent"]), target=str(v["id"]), kind="black")
                              for v in new if v["parent"] in old_ids]
            evidence_title = "A visible parent has no visible child"
            evidence_note = "Fiber labels are observer knowledge; black edges are ancestry."
        elif t == 6:
            current = visible_level(2)
            assert len(current) == 5 > m
            evidence_nodes = [dict(id=str(v["id"]), label="{" + str(v["fiber"][0]) + "}",
                leader=v["leader"], highlight=True, detail="distinct class") for v in current]
            evidence_title = "Level 2 already contains five classes"
            evidence_note = "Five nonempty classes cannot fit into four agents."
        if t == 8:
            assert all(a["halted"] and a["output"] == 5 for a in snap["agents"])
            assert audit["anchor"] == audit["final_level"] == 4
            assert all(v["value"] == "1" for v in audit["solution"])
            current = visible_level(4)
            values = {v["node"]: v["value"] for v in audit["solution"]}
            descendants = {v["node"]: v["count"] for v in audit["descendants"]}
            assert len(current) == 5 and all(descendants[v["id"]] == 1 for v in current)
            evidence_nodes = [dict(id=str(v["id"]), label="{" + str(v["fiber"][0]) + "}",
                leader=v["leader"], highlight=True, detail=f"size {values[v['id']]} · 1 descendant") for v in current]
            evidence_title = "The solved anchor accounts for all five"
            evidence_note = "At the final level each anchor node counts itself as one descendant."
        title, caption = {
            2: ("A nonleader is already visible", "The special all-leaders test rejects two."),
            4: ("Three agents are not enough", "The visible history has a missing child: reject the candidate."),
            6: ("Four agents are not enough", "The view already contains more than four classes at one level."),
            8: ("All five agents halt together", "With two leaders, the full audit succeeds one round before the core bound."),
        }[t]
        frames.append(frame(title, caption,
                            [network(s, highlights=(0,), title=f"Agent 0's audit at round {t}",
                                     details={a: "output 5" for a in range(5)} if t == 8 else None),
                             dict(title=evidence_title, nodes=evidence_nodes, edges=evidence_edges, note=evidence_note)],
                            [("Round", t), ("Candidate", m), ("Decision", "accept" if t == 8 else "reject")], round=t))
    return example(7, "Short audit", "lem:short-audit", "execution",
        "With at least two leaders, every wrong size is rejected and the correct size is accepted one round earlier.",
        "This is an actual sharp-algorithm trace for n=5 and ell=2. The displayed rejection reasons are agent 0's local decisions. All agents halt at round 8. The general proof uses tail exposure and the bound on fibers inside a proper subset.",
        ["Agent 0 rejects candidates 2,3,4 with the displayed reasons.",
         "At round 4, the visible level-1 fiber {2} has no visible child at level 2.",
         "At round 6, all five level-2 classes are visible, exceeding candidate 4.",
         "The accepted anchor and final level are both 4, with size and descendant count 1 at every node.",
         "Every agent outputs 5 and halts at round 8 = 2n−2."], frames, scenario=s)


def _two_center():
    U, W, z, zp, ell = [0, 1], [2, 3], 0, 3, 2
    scenarios = []
    for c in (ell, 1):
        edges = two_center(U, W, z, zp, ell, c)
        assert strong_connected(4, edges)
        assert all(e["source"] != e["target"] for e in edges)
        for u in U:
            if u != z:
                incoming = [e for e in edges if e["target"] == u]
                assert [(e["source"], e["multiplicity"]) for e in incoming] == [(zp, "1")]
                assert sum(int(e["multiplicity"]) for e in edges if e["source"] == u) == ell // c
        for w in W:
            incoming = [e for e in edges if e["target"] == w]
            assert [(e["source"], e["multiplicity"]) for e in incoming] == [(z, str(c))]
            assert sum(int(e["multiplicity"]) for e in edges if e["source"] == w) == ell
        scenarios.append(scenario(4, U, [dict(edges=edges)], variant="core", name=f"Two-center graph, c={c}"))
    s, unit = scenarios
    labels = {0: "z", 1: "u", 2: "w", 3: "z′"}
    return example(8, "Two-center graph", "lem:two-center-graph", "construction",
        "Two centers keep the graph strongly connected while tightly controlling what the other agents receive.",
        "U={z,u}, W={w,z′}, ell=2. Both allowed multiplicities c=2 and c=1 are checked. This is the graph gadget used by the lower-bound pair, not a claim that these four agents already have matching histories.",
        ["Both c=1 and c=2 graphs are loopless and strongly connected.",
         "The noncenter u receives only one message from z′ and has outdegree ell/c.",
         "Every W agent receives c messages from z and has outdegree ell."], [
            frame("Two groups, two centers", "Choose z in U and z′ in W.",
                  [network(s, labels=labels, highlights=(z, zp), groups={0: 0, 1: 0, 2: 1, 3: 1}, title="U = {z, u}; W = {w, z′}")],
                  [("Leaders", 2), ("Parallel copies c", 2)]),
            frame("Everyone can reach everyone", "Every other agent reaches z directly; z reaches U through z′.",
                  [network(s, labels=labels, edge_highlights=((1, 0), (2, 0), (3, 0), (0, 3), (3, 1)), title="Strong connectivity")],
                  [("Self-loops", 0), ("Strongly connected", "yes")]),
            frame("Many arcs, one sender's memory", "Each W agent receives two copies of z's old memory.",
                  [network(s, labels=labels, highlights=W, edge_highlights=((0, 2), (0, 3)), title="c = 2")],
                  [("Copies received by each W agent", 2), ("Each W outdegree", 2)]),
            frame("Switch the allowed multiplicity", "With c = 1, W receives one copy and u's outdegree becomes two.",
                  [network(unit, labels=labels, highlights=(1,), edge_highlights=((1, 0), (0, 2), (0, 3)), title="c = 1")],
                  [("Copies received by each W agent", 1), ("u outdegree", 2)]),
        ], scenario=s, scenarios=[unit])


def _lower_bound():
    left, right, observer, other, depth = lowerbound_pair(4, 2)
    assert depth == 5 and observer == other == 1
    lt = simulate(left, max_rounds=depth + 1, passive=True)["snapshots"]
    rt = simulate(right, max_rounds=depth + 1, passive=True)["snapshots"]
    matches = []
    for a, b in zip(lt, rt):
        sa, sb = node_signatures(a), node_signatures(b)
        matches.append(sa[a["agents"][observer]["bottom"]] == sb[b["agents"][other]["bottom"]])
    assert matches == [True] * 6 + [False]
    for s in (left, right):
        assert s["repeat_last"]
        for graph in s["rounds"]:
            assert strong_connected(s["n"], graph["edges"])
            assert all(e["source"] != e["target"] and int(e["multiplicity"]) <= 2 for e in graph["edges"])
            assert max(sum(int(e["multiplicity"]) for e in graph["edges"] if e["source"] == a) for a in range(s["n"])) <= 4
        final = s["rounds"][-1]["edges"]
        assert len(final) == s["n"]
        assert all(sum(e["source"] == a for e in final) == 1 and sum(e["target"] == a for e in final) == 1 for a in range(s["n"]))
    titles = {1: "The same start in different-sized networks", 2: "Hide differences behind a matching old message",
              3: "The second phase preserves the observers", 5: "Repeat one fixed final cycle", 6: "The first difference finally arrives"}
    captions = {1: "Both networks have two leaders, but one has an extra nonleader.",
                2: "A new center sends its old matching memory before learning its new information.",
                3: "The designated leaders still see identical histories.",
                5: "The relay delays the difference: the leader views still match through round five.",
                6: "At round six the leader views diverge. Before then, the sizes were indistinguishable."}
    frames = []
    for t in (1, 2, 3, 5, 6):
        graphs = []
        for s, observer_id in ((left, observer), (right, other)):
            graphs.append(network(s, t, highlights=(observer_id,), labels={observer_id: "x"},
                                  title=f"{s['n']} agents · 2 leaders", details={observer_id: "observer"},
                                  note="Final cycle repeated unchanged" if t >= 4 else None))
        frames.append(frame(titles[t], captions[t], graphs,
                            [("Round", t), ("Observer histories", "identical" if matches[t] else "different")], round=t))
    result = example(17, "Different sizes, identical leader views", "thm:several-leader-vista", "construction",
        "Four and five agents can keep designated leaders indistinguishable through round five.",
        "This appendix construction uses n=4, ell=2 and one relay on each side. The two passive full-history traces are compared by complete canonical recursive signatures, not by numeric node IDs. The fixed final cycle is included and repeated; the first difference is at round 6. This illustrates Theorem 4 rather than an additional lemma.",
        ["All graphs are loopless and strongly connected, with multiplicity at most 2 and outdegree at most 4.",
         "Both scenarios repeat their final directed cycle.",
         "Complete designated-leader signatures agree at every round 0..5 and differ at round 6."],
        frames, scenario=left, scenarios=[right])
    result["id"] = "lower-bound"
    result["section"] = "Bonus: termination lower bound"
    return result


def build_examples():
    examples = [_flat(), _credit_refinement(), _minimum_ratio(), _credit_loss(),
                _tail_exposure(), _forward_fibers(), _short_audit(), _two_center(), _lower_bound()]
    for value in examples:
        for s in [value["scenario"], *value.get("scenarios", [])]:
            for graph in s["rounds"]:
                assert strong_connected(s["n"], graph["edges"])
    return examples


if __name__ == "__main__":
    import json
    print(json.dumps(build_examples(), indent=2))
