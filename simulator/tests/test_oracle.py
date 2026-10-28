"""Focused unit, lower-bound, mutation-sensitivity and metamorphic checks."""

from copy import deepcopy
from fractions import Fraction
import unittest

from fixtures import (deterministic_scenarios, edge, lowerbound_pair,
                      random_scenario, relabel, scenario, strong_connected,
                      tiny_exhaustive)
from oracle import (audit, check_invariants, compare_results, node_signatures,
                    simulate, solve_exact)


def flat_fixture(p=1, q=1, s=1, r=1):
    return [
        dict(id=0, level=-1, leader=False, parent=None, outdegree="0", incoming=[]),
        dict(id=1, level=0, leader=True, parent=0, outdegree="0", incoming=[]),
        dict(id=2, level=0, leader=False, parent=0, outdegree="0", incoming=[]),
        dict(id=3, level=1, leader=True, parent=1, outdegree=str(p),
             incoming=[dict(source=2, multiplicity=str(s))] if s else []),
        dict(id=4, level=1, leader=False, parent=2, outdegree=str(r),
             incoming=[dict(source=1, multiplicity=str(q))] if q else []),
    ]


def synthetic_audits():
    """All audit branches with ancestry-closed synthetic visible prefixes.

    These unit inputs need not be realizable strongly connected executions;
    actual-network correctness is covered separately by differential campaigns.
    """
    base = flat_fixture()
    yield "accepted", dict(nodes=base, visible_nodes=list(range(5)), candidate=2, final_level=1, ell=1)
    leaderless = deepcopy(base)
    leaderless[4]["incoming"] = [dict(source=2, multiplicity="1")]
    yield "leader_missing", dict(nodes=leaderless, visible_nodes=[0, 2, 4], candidate=2, final_level=1, ell=1)
    yield "node_limit", dict(nodes=base, visible_nodes=list(range(5)), candidate=1, final_level=1, ell=1)
    missing = deepcopy(base[:4])
    yield "missing_child", dict(nodes=missing, visible_nodes=list(range(4)), candidate=2, final_level=1, ell=1)
    split = deepcopy(base)
    split.append(dict(id=5, level=1, leader=True, parent=1, outdegree="1", incoming=[]))
    yield "no_flat", dict(nodes=split, visible_nodes=list(range(6)), candidate=3, final_level=1, ell=1)
    for reason, parameters, candidate in (
            ("inconsistent", (1, 1, 1, 2), 2),
            ("non_unique", (0, 0, 0, 0), 2),
            ("non_integer", (1, 2, 1, 2), 2),
            ("non_positive", (0, 1, 0, 1), 2),
            ("wrong_total", (1, 1, 1, 1), 3)):
        yield reason, dict(nodes=flat_fixture(*parameters), visible_nodes=list(range(5)),
                           candidate=candidate, final_level=1, ell=1)
    backward = flat_fixture(p=2)
    backward.extend([
        dict(id=5, level=2, leader=True, parent=3, outdegree="1", incoming=[dict(source=4, multiplicity="1")]),
        dict(id=6, level=2, leader=False, parent=4, outdegree="1", incoming=[dict(source=3, multiplicity="1")]),
    ])
    yield "backward_flow", dict(nodes=backward, visible_nodes=list(range(7)), candidate=2, final_level=2, ell=1)
    suffix = flat_fixture(p=2, q=1, s=2, r=1)
    suffix.extend([
        dict(id=5, level=2, leader=True, parent=3, outdegree="1", incoming=[dict(source=4, multiplicity="1")]),
        dict(id=6, level=2, leader=True, parent=3, outdegree="1", incoming=[dict(source=4, multiplicity="2")]),
        dict(id=7, level=2, leader=False, parent=4, outdegree="1", incoming=[dict(source=3, multiplicity="1")]),
    ])
    yield "suffix", dict(nodes=suffix, visible_nodes=list(range(8)), candidate=3, final_level=2, ell=1)


class ExactArithmeticTests(unittest.TestCase):
    def test_rank_consistency_and_large_exact_coefficients(self):
        huge = 2 ** 200 + 17
        self.assertEqual(solve_exact([[huge, 1], [0, 3]], [huge + 1, 3], 2),
                         ("unique", [Fraction(1), Fraction(1)]))
        self.assertEqual(solve_exact([[1, 2], [2, 4]], [3, 6], 2)[0], "non_unique")
        self.assertEqual(solve_exact([[1, 2], [2, 4]], [3, 7], 2)[0], "inconsistent")
        self.assertEqual(solve_exact([[2]], [1], 1), ("unique", [Fraction(1, 2)]))

    def test_all_audit_rejection_paths(self):
        for reason, value in synthetic_audits():
            with self.subTest(reason=reason):
                result = audit(value["nodes"], value["visible_nodes"],
                               value["candidate"], value["final_level"], value["ell"])
                self.assertEqual(result["reason"], reason)


class ModelTests(unittest.TestCase):
    def test_singleton_empty_and_looped(self):
        for edges in ([], [edge(0, 0)], [edge(0, 0, 2 ** 100 + 1)]):
            self.assertTrue(strong_connected(1, edges))
            for variant in ("core", "sharp"):
                value = scenario(1, [0], [dict(edges=edges)], variant)
                result = simulate(value)
                self.assertEqual(result["termination_round"], 1)
                self.assertEqual(result["snapshots"][-1]["agents"][0]["output"], 1)
                check_invariants(result, 1, 1)

    def test_incomplete_prefix_has_no_claimed_termination(self):
        value = random_scenario(5, 2, "incomplete", horizon=1)
        value["repeat_last"] = False
        result = simulate(value)
        self.assertEqual(result["status"], "incomplete")
        self.assertIsNone(result["termination_round"])
        self.assertEqual(len(result["snapshots"]), 2)

    def test_deterministic_families(self):
        for value in deterministic_scenarios(4):
            with self.subTest(value=value["name"]):
                result = simulate(value)
                n, ell = value["n"], len(value["leaders"])
                expected = (2 * n - 1 if value["variant"] == "core" else
                            n if n == ell else 2 * n - 1 if ell == 1 else 2 * n - 2)
                self.assertEqual(result["termination_round"], expected)
                self.assertTrue(all(a["output"] == n for a in result["snapshots"][-1]["agents"]))
                check_invariants(result, n, ell)

    def test_lower_bound_equal_vistas_and_first_difference(self):
        for n in range(1, 9):
            for ell in range(1, n + 1):
                with self.subTest(n=n, ell=ell):
                    left, right, x, y, common = lowerbound_pair(n, ell)
                    for value in (left, right):
                        self.assertTrue(all(strong_connected(value["n"], g["edges"])
                                            for g in value["rounds"]))
                    a = simulate(left, max_rounds=common + 1, passive=True)
                    b = simulate(right, max_rounds=common + 1, passive=True)

                    def sig(result, t, observer):
                        snap = result["snapshots"][t]
                        return node_signatures(snap)[snap["agents"][observer]["bottom"]]

                    for t in range(common + 1):
                        self.assertEqual(sig(a, t, x), sig(b, t, y))
                    self.assertNotEqual(sig(a, common + 1, x), sig(b, common + 1, y))
                    if ell >= 2 and n > ell:
                        for value in (left, right):
                            for graph in value["rounds"]:
                                self.assertTrue(all(e["source"] != e["target"] for e in graph["edges"]))
                                self.assertLessEqual(max(int(e["multiplicity"]) for e in graph["edges"]), ell)

    def test_exhaustive_domain_size(self):
        # n=1: 2 binary graphs x 1 leader set x 2 variants = 4.
        # n=2: 4 SC binary graphs ^3 rounds x 3 leader sets x 2 =384.
        self.assertEqual(sum(1 for _ in tiny_exhaustive()), 388)


class MetamorphicAndMutationTests(unittest.TestCase):
    def test_parallel_arc_splitting_and_order(self):
        value = random_scenario(5, 2, "split-arcs")
        changed = deepcopy(value)
        for graph in changed["rounds"]:
            split = []
            for e in reversed(graph["edges"]):
                k = int(e["multiplicity"])
                if k > 1:
                    split.extend((edge(e["source"], e["target"], 1),
                                  edge(e["source"], e["target"], k - 1)))
                else:
                    split.append(e)
            graph["edges"] = split
        changed["leaders"].reverse()
        compare_results(simulate(changed), simulate(value))

    def test_agent_relabeling(self):
        value = random_scenario(7, 3, "rename-agents")
        permutation = [4, 0, 6, 2, 5, 1, 3]
        left, right = simulate(value), simulate(relabel(value, permutation))
        self.assertEqual(left["termination_round"], right["termination_round"])
        for a, b in zip(left["snapshots"], right["snapshots"]):
            sa, sb = node_signatures(a), node_signatures(b)
            for x in range(7):
                self.assertEqual(sa[a["agents"][x]["bottom"]],
                                 sb[b["agents"][permutation[x]]["bottom"]])

    def test_comparator_catches_mutations(self):
        value = random_scenario(4, 2, "mutants")
        baseline = simulate(value)
        mutants = []
        changed = deepcopy(baseline)
        changed["snapshots"][1]["nodes"][-1]["outdegree"] = "999999"
        mutants.append(changed)
        changed = deepcopy(baseline)
        changed["snapshots"][1]["agents"][0]["visible_nodes"] = []
        mutants.append(changed)
        changed = deepcopy(baseline)
        changed["snapshots"][-1]["agents"][0]["output"] = 99
        mutants.append(changed)
        changed = deepcopy(baseline)
        changed["snapshots"][-1]["agents"][0]["audit"]["status"] = "rejected"
        mutants.append(changed)
        for i, mutant in enumerate(mutants):
            with self.subTest(mutant=i), self.assertRaises(AssertionError):
                compare_results(mutant, baseline)

    def test_early_one_leader_short_audit_is_detected(self):
        # Applying the multiple-leader optimization at ell=1 is unsound.
        left, larger, _, _, _ = lowerbound_pair(2, 1)
        trace = simulate(larger, max_rounds=2, passive=True)
        snap = trace["snapshots"][2]
        a = snap["agents"][0]
        unsound = audit(snap["nodes"], a["visible_nodes"], 2, 1, 1)
        self.assertEqual(unsound["status"], "accepted")
        self.assertNotEqual(unsound["candidate"], larger["n"])
        self.assertEqual(simulate(larger)["termination_round"], 5)


if __name__ == "__main__":
    unittest.main()
