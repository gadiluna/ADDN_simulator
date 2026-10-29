"""Small network generators, including the explicit appendix lower bounds."""

from copy import deepcopy
from itertools import product
import random


def edge(source, target, multiplicity=1):
    return dict(source=source, target=target, multiplicity=str(multiplicity))


def scenario(n, leaders, rounds, variant="sharp", name=None, repeat_last=True, seed=None):
    value = dict(schema_version=1, n=n, leaders=list(leaders), variant=variant,
                 rounds=rounds, repeat_last=repeat_last)
    if name is not None:
        value["name"] = name
    if seed is not None:
        value["seed"] = str(seed)
    return value


def strong_connected(n, edges):
    for reverse in (False, True):
        adjacency = [[] for _ in range(n)]
        for e in edges:
            if int(e["multiplicity"]) > 0:
                a, b = e["source"], e["target"]
                adjacency[b if reverse else a].append(a if reverse else b)
        seen, stack = {0}, [0]
        while stack:
            for v in adjacency[stack.pop()]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        if len(seen) != n:
            return False
    return True


def path_edges(n, loop=False):
    edges = [edge(a, b) for a in range(n - 1) for b in (a + 1,)]
    edges += [edge(b, a) for a in range(n - 1) for b in (a + 1,)]
    if loop:
        edges.append(edge(n - 1, n - 1))
    return edges


def cycle_edges(order):
    order = list(order)
    return [edge(a, order[(i + 1) % len(order)]) for i, a in enumerate(order)]


def two_center(U, W, z, zp, ell, c):
    return ([edge(z, w, c) for w in W] + [edge(zp, u) for u in U]
            + [edge(u, z, ell // c) for u in U if u != z]
            + [edge(w, z, ell) for w in W if w != zp])


def lowerbound_pair(n, ell):
    """Return (smaller, larger, observer_left, observer_right, common_depth).

    For several leaders this follows Appendix Termination Lower Bounds, including
    its final directed cycle.
    """
    assert 1 <= ell <= n
    if n == ell:
        return (scenario(n, range(n), [dict(edges=path_edges(n))], name="all-leader-path"),
                scenario(n + 1, range(n), [dict(edges=path_edges(n + 1))], name="extended-leader-path"),
                0, 0, n - 1)
    if ell == 1:
        return (scenario(n, [0], [dict(edges=path_edges(n, True))], name="one-leader-loop-path"),
                scenario(n + 1, [0], [dict(edges=path_edges(n + 1, True))], name="extended-loop-path"),
                0, 0, 2 * n - 2)
    g = n - ell - 1
    leaders = list(range(ell))
    x, y, yp = ell - 1, ell, 2 * ell - 1
    left_relays = list(range(ell + 1, n))
    right_relays = list(range(2 * ell, n + ell - 1))
    Wleft, Wright = [y], list(range(ell, 2 * ell))
    left, right = [], []
    if g:
        le = cycle_edges(left_relays + [y])
        re = cycle_edges(right_relays + Wright)
        le += [edge(u, left_relays[0]) for u in leaders] + [edge(left_relays[0], u) for u in leaders]
        re += [edge(u, right_relays[0]) for u in leaders] + [edge(right_relays[0], u) for u in leaders]
        left.extend(deepcopy(dict(edges=le)) for _ in range(g))
        right.extend(deepcopy(dict(edges=re)) for _ in range(g))

    def relay_fanout(edges, sender, relays):
        if not relays:
            return edges
        edges = [e for e in edges if not (e["source"] == sender and e["target"] in leaders)]
        edges += [edge(a, b, ell) for a, b in zip([sender] + relays, relays)]
        edges += [edge(relays[-1], u) for u in leaders]
        return edges

    for t in range(ell - 1):
        le = [edge(u, y) for u in leaders] + [edge(y, u) for u in leaders]
        re = two_center(leaders, Wright, t, yp, ell, ell)
        left.append(dict(edges=relay_fanout(le, y, left_relays)))
        right.append(dict(edges=relay_fanout(re, yp, right_relays)))
    for t in range(ell - 1):
        le = two_center(leaders, Wleft, t, y, ell, 1)
        re = two_center(Wright, leaders, ell + t, x, ell, 1)
        left.append(dict(edges=relay_fanout(le, y, left_relays)))
        right.append(dict(edges=relay_fanout(re, ell + t, right_relays)))
    left.append(dict(edges=cycle_edges([x] + list(range(ell - 1)) + [y] + left_relays)))
    right.append(dict(edges=cycle_edges([x] + list(range(ell - 1)) + list(range(ell, 2 * ell - 1)) + [yp] + right_relays)))
    return (scenario(n, leaders, left, name=f"several-leader-lower-left-n{n}-l{ell}"),
            scenario(n + ell - 1, leaders, right, name=f"several-leader-lower-right-n{n}-l{ell}"),
            x, x, 2 * n - 3)


def deterministic_scenarios(max_n=12):
    for n in range(1, max_n + 1):
        families = {
            "path": path_edges(n),
            "loop-path": path_edges(n, True),
            "cycle": cycle_edges(range(n)),
            "star": [edge(a, b) for v in range(1, n) for a, b in ((0, v), (v, 0))],
            "complete": [edge(a, b) for a in range(n) for b in range(n)],
            "huge-multiplicity": [edge(a, (a + 1) % n, 2 ** 80 + 7) for a in range(n)],
        }
        for ell in range(1, n + 1):
            for family, edges in families.items():
                for variant in ("core", "sharp"):
                    yield scenario(n, range(ell), [dict(edges=edges)], variant=variant,
                                   name=f"{family}-n{n}-l{ell}-{variant}")
            if ell < n:
                smaller, larger, *_ = lowerbound_pair(n, ell)
                for item in (smaller, larger):
                    for variant in ("core", "sharp"):
                        copy = deepcopy(item)
                        copy["variant"] = variant
                        copy["name"] += "-" + variant
                        yield copy


def random_scenario(n, ell, seed, horizon=None, variant="sharp", max_multiplicity=8):
    rng = random.Random(seed)
    horizon = horizon or 2 * n - 1
    rounds = []
    for _ in range(horizon):
        order = list(range(n))
        rng.shuffle(order)
        entries = {(a, order[(i + 1) % n]): rng.randint(1, max_multiplicity)
                   for i, a in enumerate(order)}
        for _ in range(rng.randint(n, 4 * n)):
            pair = rng.randrange(n), rng.randrange(n)
            entries[pair] = entries.get(pair, 0) + rng.randint(1, max_multiplicity)
        rounds.append(dict(edges=[edge(a, b, k) for (a, b), k in sorted(entries.items())]))
    return scenario(n, rng.sample(range(n), ell), rounds, variant,
                    name=f"random-n{n}-l{ell}-{seed}", seed=seed)


def binary_graphs(n):
    for mask in range(1 << (n * n)):
        edges = [edge(a, b) for a in range(n) for b in range(n) if mask & (1 << (a * n + b))]
        if strong_connected(n, edges):
            yield dict(edges=edges)


def tiny_exhaustive():
    for n in (1, 2):
        graphs = list(binary_graphs(n))
        for sequence in product(graphs, repeat=2 * n - 1):
            for leader_mask in range(1, 1 << n):
                leaders = [x for x in range(n) if leader_mask & (1 << x)]
                for variant in ("core", "sharp"):
                    yield scenario(n, leaders, list(sequence), variant,
                                   name=f"exhaustive-n{n}-mask{leader_mask}", repeat_last=False)


def relabel(value, permutation):
    result = deepcopy(value)
    result["leaders"] = [permutation[x] for x in result["leaders"]]
    for graph in result["rounds"]:
        for e in graph["edges"]:
            e["source"], e["target"] = permutation[e["source"]], permutation[e["target"]]
    return result
