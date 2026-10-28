#!/usr/bin/env python3
"""Deterministic, bounded native searches with reproducible failure bundles."""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import platform
import random
import resource
import signal
import subprocess
import sys
import tempfile
import time

SIM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIM / "tests"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    tmp.replace(path)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_paper_title(path):
    """Read a balanced LaTeX title, ignoring comments and escaped braces."""
    path = Path(path)
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    index = 0
    while index < len(text):
        if text[index] == "%":
            newline = text.find("\n", index)
            index = len(text) if newline < 0 else newline + 1
        elif text[index] == "\\":
            end = index + len("\\title")
            if text.startswith("\\title", index) and (end == len(text) or not text[end].isalpha()):
                while end < len(text) and text[end].isspace():
                    end += 1
                if end < len(text) and text[end] == "{":
                    depth, cursor, title = 1, end + 1, []
                    while cursor < len(text):
                        char = text[cursor]
                        if char == "%":
                            newline = text.find("\n", cursor)
                            cursor = len(text) if newline < 0 else newline + 1
                            continue
                        if char == "\\":
                            title.append(text[cursor:cursor + 2])
                            cursor += 2
                            continue
                        if char == "{":
                            depth += 1
                        elif char == "}":
                            depth -= 1
                            if depth == 0:
                                return " ".join("".join(title).split())
                        title.append(char)
                        cursor += 1
                    return None
            index += 2
        else:
            index += 1
    return None


def total_memory():
    if sys.platform == "darwin":
        try:
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], stderr=subprocess.DEVNULL))
        except (subprocess.SubprocessError, OSError):
            # Sandboxed macOS can deny this read; keep a conservative budget.
            return 1024**3
    try:
        physical = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        for path in (Path("/sys/fs/cgroup/memory.max"), Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")):
            try:
                value = path.read_text().strip()
                if value.isdecimal() and int(value) > 0:
                    physical = min(physical, int(value))
            except OSError:
                pass
        return physical
    except (ValueError, OSError):
        return 2 * 1024**3


def cap_worker(memory_bytes):
    # Applied in a separate worker process before invoking the native child.
    if sys.platform != "darwin":
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        value = min(memory_bytes, hard) if hard != resource.RLIM_INFINITY else memory_bytes
        resource.setrlimit(resource.RLIMIT_AS, (value, value))


def run_native(engine, case, trace=False, timeout=30):
    with tempfile.TemporaryDirectory(prefix="counting-case-") as directory:
        path = Path(directory) / "scenario.json"
        path.write_text(json.dumps(case))
        started = time.monotonic()
        try:
            result = subprocess.run([str(engine), "run", str(path), "--trace" if trace else "--summary"],
                                    capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"ok": False, "kind": "timeout", "message": f"Native case exceeded {timeout}s",
                    "elapsed_seconds": time.monotonic() - started}
        try:
            actual = json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"ok": False, "kind": "invalid_output", "stdout": result.stdout[-10000:],
                    "stderr": result.stderr[-10000:], "exit_code": result.returncode}
        failure = actual.get("failure")
        ok = result.returncode == 0 and actual.get("status") == "complete" and failure is None
        kind = "pass" if ok else (failure or {}).get("kind", "native_failure")
        n, ell = case["n"], len(case["leaders"])
        expected_round = 2*n-1 if case["variant"] == "core" else n if n == ell else 2*n-1 if ell == 1 else 2*n-2
        if ok and actual.get("outputs") != [n] * n:
            ok, kind = False, "wrong_output"
        if ok and actual.get("termination_round") != expected_round:
            ok, kind = False, "wrong_termination_round"
        return {"ok": ok, "kind": kind,
                "actual": actual, "stderr": result.stderr[-10000:], "exit_code": result.returncode,
                "elapsed_seconds": time.monotonic() - started}


def check_case(job):
    index, engine, case, sampled, timeout = job
    def oracle_timeout(_signum, _frame):
        raise TimeoutError(f"Oracle exceeded {timeout}s")
    result = run_native(engine, case, trace=sampled, timeout=timeout)
    result.update(index=index, sampled=sampled)
    if sampled and result["ok"]:
        try:
            signal.signal(signal.SIGALRM, oracle_timeout)
            signal.setitimer(signal.ITIMER_REAL, timeout)
            from oracle import simulate, compare_results, check_invariants
            expected = simulate(case)
            check_invariants(expected, case["n"], len(case["leaders"]))
            compare_results(result["actual"], expected)
            check_invariants(result["actual"], case["n"], len(case["leaders"]))
            result["oracle_checked"] = True
        except Exception as exc:
            kind = "oracle_timeout" if isinstance(exc, TimeoutError) else "resource_exhausted" if isinstance(exc, MemoryError) else "oracle_mismatch"
            result.update(ok=False, kind=kind, message=f"{type(exc).__name__}: {exc}")
            if "expected" in locals():
                result["expected"] = expected
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
    if result["ok"]:
        # Successful traces have already been compared inside this worker. Do not
        # serialize their full DAGs across the process pool or retain them there.
        result.pop("actual", None)
        result.pop("expected", None)
    return result


def n3_cases():
    """All loopless SC round-pairs on n=3, repeated after their second round."""
    from fixtures import edge, scenario, strong_connected
    arcs = [(i, j) for i in range(3) for j in range(3) if i != j]
    graphs = []
    for mask in range(1 << len(arcs)):
        edges = [edge(i, j) for bit, (i, j) in enumerate(arcs) if mask & (1 << bit)]
        if strong_connected(3, edges):
            graphs.append(edges)
    for a, b in itertools.product(graphs, repeat=2):
        for mask in range(1, 8):
            leaders = [i for i in range(3) if mask & (1 << i)]
            for variant in ("core", "sharp"):
                yield scenario(3, leaders, [dict(edges=a), dict(edges=b)], variant=variant, repeat_last=True,
                               name="n3-loopless-two-round-prefix")


def cases(seed, mode):
    from fixtures import deterministic_scenarios, tiny_exhaustive
    yield from deterministic_scenarios(max_n=12)
    yield from tiny_exhaustive()
    if mode == "nightly":
        yield from n3_cases()
    yield from random_cases(seed)


def random_cases(seed):
    from fixtures import random_scenario
    pair_index = 0
    while True:
        pair_seed = seed + pair_index
        rng = random.Random(pair_seed)
        stress = pair_index % 16 == 15
        # Draw this independently of the stress schedule: large networks must
        # exercise both ordinary and arbitrarily large exact coefficients.
        multiplicity = 2**54 + 17 if rng.randrange(8) == 0 else 8
        n = rng.randint(65, 128) if stress else rng.randint(1, 64)
        leader_boundary = pair_index % 5
        ell = (1 if leader_boundary == 0 else min(2, n) if leader_boundary == 1
               else max(1, n - 1) if leader_boundary == 2 else n if leader_boundary == 3
               else rng.randint(1, n))
        value = random_scenario(n, ell, pair_seed, variant="sharp",
                                max_multiplicity=multiplicity)
        core = copy.deepcopy(value)
        core["variant"] = "core"
        yield value
        yield core
        pair_index += 1


def should_sample(case, index):
    """Keep both variants of a random pair in the same oracle sample."""
    n = case["n"]
    return n <= 16 or n <= 32 and (index // 2) % 16 == 0


def scale_cases(seed, n):
    """Large regular dynamic networks with explicitly bounded graph prefixes.

    Circulant cycles keep the physical network large without requiring a JSON
    description of O(n**2) edges over the entire termination horizon. After
    64 changing topologies the last graph repeats, as stated in each scenario.
    Leader classes are periodic; these are structured stress cases, not uniform
    random graphs or an exhaustive domain.
    """
    from fixtures import edge, scenario
    strides = [s for s in range(1, n) if math.gcd(s, n) == 1] or [0]
    pair_index = 0
    while True:
        rng = random.Random(seed + pair_index)
        period = (1, 2, 4)[pair_index % 3]
        leaders = list(range(0, n, period))
        rounds = []
        last_stride = None
        for _ in range(min(64, 2 * n - 1)):
            choices = [s for s in strides if s != last_stride] or strides
            stride = rng.choice(choices)
            last_stride = stride
            count = rng.choice((1, 2, 7, 2**54 + 17))
            edges = [edge(a, (a + stride) % n, count) for a in range(n)]
            if rng.randrange(2):
                edges += [edge(a, a) for a in range(n)]
            rounds.append(dict(edges=edges))
        value = scenario(n, leaders, rounds, variant="sharp", repeat_last=True,
                         seed=seed + pair_index,
                         name=f"structured-dynamic-n{n}-period{period}-{seed + pair_index}")
        core = copy.deepcopy(value)
        core["variant"] = "core"
        yield value
        yield core
        pair_index += 1


def failure_key(result):
    return result.get("kind", "failure")


def shrink(case, engine, wanted_kind, deadline, timeout):
    """Greedy graph-preserving reduction; each accepted edit reruns the predicate."""
    from fixtures import strong_connected
    best = copy.deepcopy(case)

    def keeps_failure(candidate):
        if time.monotonic() >= deadline:
            return False
        if not all(strong_connected(candidate["n"], r["edges"] if isinstance(r, dict) else r)
                   for r in candidate["rounds"]):
            return False
        result = check_case((0, engine, candidate, wanted_kind == "oracle_mismatch", timeout))
        return not result["ok"] and failure_key(result) == wanted_kind

    # First remove physical agents, remapping only simulator IDs, never local state.
    changed = True
    while changed and best["n"] > 1 and time.monotonic() < deadline:
        changed = False
        for removed in range(best["n"] - 1, -1, -1):
            if removed in best["leaders"] and len(best["leaders"]) == 1:
                continue
            trial = copy.deepcopy(best)
            trial["n"] -= 1
            trial["leaders"] = [x - (x > removed) for x in trial["leaders"] if x != removed]
            for round_value in trial["rounds"]:
                target = round_value["edges"] if isinstance(round_value, dict) else round_value
                target[:] = [e for e in target if e["source"] != removed and e["target"] != removed]
                for e in target:
                    e["source"] -= e["source"] > removed
                    e["target"] -= e["target"] > removed
            if keeps_failure(trial):
                best, changed = trial, True
                break
    # Removing later round graphs preserves the explicit repeat-last convention.
    changed = True
    while changed and time.monotonic() < deadline:
        changed = False
        for r in range(len(best["rounds"]) - 1, -1, -1):
            if len(best["rounds"]) <= 1:
                break
            trial = copy.deepcopy(best)
            del trial["rounds"][r]
            if keeps_failure(trial):
                best, changed = trial, True
                break
    for r in range(len(best["rounds"])):
        round_value = best["rounds"][r]
        edges = round_value["edges"] if isinstance(round_value, dict) else round_value
        e = len(edges) - 1
        while e >= 0 and time.monotonic() < deadline:
            trial = copy.deepcopy(best)
            target = trial["rounds"][r]
            target = target["edges"] if isinstance(target, dict) else target
            del target[e]
            if keeps_failure(trial):
                best = trial
            e -= 1
    # Edge helpers use string multiplicities. Preserve strings while reducing.
    for r, round_value in enumerate(best["rounds"]):
        edges = round_value["edges"] if isinstance(round_value, dict) else round_value
        for e, value in enumerate(edges):
            if not isinstance(value, dict):
                continue
            key = "multiplicity" if "multiplicity" in value else "count" if "count" in value else None
            if key is None or int(value[key]) <= 1:
                continue
            trial = copy.deepcopy(best)
            target = trial["rounds"][r]
            target = target["edges"] if isinstance(target, dict) else target
            target[e][key] = "1" if isinstance(value[key], str) else 1
            if keeps_failure(trial):
                best = trial
    return best


def metadata(engine):
    cache = engine.parent / "CMakeCache.txt"
    flags = {}
    if cache.exists():
        for line in cache.read_text().splitlines():
            if line.startswith(("CMAKE_BUILD_TYPE:", "CMAKE_C_COMPILER:", "CMAKE_C_FLAGS:", "COUNTING_SANITIZERS:")):
                key, value = line.split("=", 1)
                flags[key.split(":")[0]] = value
    paper = SIM.parent / "paper.tex"
    manifest_path = SIM.parent / "experiment-manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    generator_hash = hashlib.sha256()
    for path in (Path(__file__), SIM / "tests/fixtures.py", SIM / "tests/oracle.py"):
        if path.exists():
            generator_hash.update(path.read_bytes())
    return {"paper_title": read_paper_title(paper) or manifest.get("paper_title"),
            "engine_sha256": digest(engine), "engine": str(engine), "build": flags,
            "generator_sha256": generator_hash.hexdigest(),
            "machine": platform.platform(), "python": platform.python_version()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, default=SIM / "c/build/counting")
    parser.add_argument("--mode", choices=("quick", "nightly"), default="nightly")
    parser.add_argument("--hours", type=float, default=8)
    parser.add_argument("--seconds", type=float, help="Override the wall-clock budget (smoke runs)")
    parser.add_argument("--max-cases", type=int, help="Finite bounded run; quick defaults to 512")
    parser.add_argument("--seed", type=int, default=20261016)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--case-timeout", type=float, default=30)
    parser.add_argument("--stress-timeout", type=float, default=120, help="Per-case native budget when n>64")
    parser.add_argument("--output", type=Path, default=SIM / "results/campaign")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--shrink-seconds", type=float, default=60)
    parser.add_argument("--skip-baseline", action="store_true", help="Random-only search after a separately verified baseline")
    parser.add_argument("--c-only", action="store_true", help="Run only the C simulator, with no Python oracle comparisons")
    parser.add_argument("--scale-agents", type=int, help="Structured dynamic C-only stress at a fixed population, up to 4096")
    args = parser.parse_args(argv)
    args.engine = args.engine.resolve()
    if args.scale_agents is not None and (not args.c_only or not 1 <= args.scale_agents <= 4096):
        parser.error("--scale-agents requires --c-only and a population from 1 to 4096")
    if not args.engine.is_file():
        parser.error(f"Native engine missing: {args.engine}; run scripts/build_native.sh")
    if args.hours <= 0 or (args.seconds is not None and args.seconds <= 0) or args.workers < 1 or args.case_timeout <= 0 or args.stress_timeout <= 0 or (args.max_cases is not None and args.max_cases < 1):
        parser.error("Budgets and worker count must be positive")
    maximum = args.max_cases if args.max_cases is not None else (512 if args.mode == "quick" else None)
    workers = min(args.workers, max(1, (os.cpu_count() or 2) // 2))
    memory = min(total_memory() // 2, workers * 2 * 1024**3)
    state_path = args.output / "checkpoint.json"
    meta = metadata(args.engine)
    previous = {}
    if args.resume:
        if not state_path.exists():
            parser.error("No checkpoint exists in the output directory")
        previous = json.loads(state_path.read_text())
        for key in ("engine_sha256", "generator_sha256"):
            if previous.get(key) != meta[key]:
                parser.error(f"Cannot resume: {key} changed; use a new output directory")
        if previous.get("seed") != args.seed or previous.get("mode") != args.mode or previous.get("skip_baseline", False) != args.skip_baseline:
            parser.error("Resume requires the original seed and mode")
        if previous.get("c_only", False) != args.c_only or previous.get("scale_agents") != args.scale_agents:
            parser.error("Resume requires the original C-only and scale settings")
    elif state_path.exists():
        parser.error("Output already has a checkpoint; use --resume or a new output directory")
    start_index = previous.get("next_case", 0)
    completed = start_index
    oracle_count = previous.get("oracle_checks", 0)
    started = time.monotonic()
    deadline = started + (args.seconds if args.seconds is not None else args.hours * 3600)
    interrupted = False

    def interrupt(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    coverage = previous.get("coverage", {
        "variants": {"core": 0, "sharp": 0},
        "oracle_variants": {"core": 0, "sharp": 0},
        "populations": {"1-16": 0, "17-32": 0, "33-64": 0, "65-128": 0,
                        "129-256": 0, "257-512": 0, "513-1024": 0, "1025-2048": 0, "2049-4096": 0},
        "max_n": 0,
    })
    state = {**meta, "schema_version": 1, "status": "running", "seed": args.seed, "mode": args.mode,
             "workers": workers, "memory_budget_bytes": memory,
             "scheduler": "continuous", "case_timeout_seconds": args.case_timeout,
             "stress_timeout_seconds": args.stress_timeout, "coverage": coverage,
             "skip_baseline": args.skip_baseline,
             "c_only": args.c_only, "oracle_enabled": not args.c_only,
             "scale_agents": args.scale_agents,
             "memory_limit_enforced": sys.platform != "darwin", "next_case": completed,
             "oracle_checks": oracle_count, "pid": os.getpid(),
             "started_at_utc": previous.get("started_at_utc", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))}
    write_json(state_path, state)
    generated = (scale_cases(args.seed, args.scale_agents) if args.scale_agents is not None
                 else random_cases(args.seed) if args.skip_baseline else cases(args.seed, args.mode))
    iterator = itertools.islice(enumerate(generated), start_index, None)
    failure = None
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers, initializer=cap_worker,
                                                initargs=(memory // workers,)) as executor:
        pending, ready = {}, {}
        next_submit = start_index
        last_report = 0.0
        while True:
            while (not interrupted and failure is None and time.monotonic() < deadline
                   and len(pending) < workers and next_submit < completed + 8 * workers
                   and (maximum is None or next_submit < maximum)):
                index, case = next(iterator)
                n = case["n"]
                sampled = not args.c_only and should_sample(case, index)
                timeout = max(args.case_timeout, args.stress_timeout) if n > 64 else args.case_timeout
                job = (index, args.engine, case, sampled, timeout)
                pending[executor.submit(check_case, job)] = (index, case)
                next_submit = index + 1
            if not pending:
                break
            done, _ = concurrent.futures.wait(pending, timeout=1,
                                              return_when=concurrent.futures.FIRST_COMPLETED)
            for future in sorted(done, key=lambda item: pending[item][0]):
                index, case = pending.pop(future)
                try:
                    result = future.result()
                except Exception as exc:
                    result = {"ok": False, "kind": "worker_error", "message": repr(exc)}
                if not result["ok"] and (failure is None or index < failure["index"]):
                    failure = {"case": case, "result": result, "index": index}
                # Keep only compact receipts until the contiguous prefix can be
                # committed. A resumed run must never skip an unfinished case.
                ready[index] = (result["ok"], bool(result.get("oracle_checked")),
                                case["n"], case["variant"])
            while completed in ready and ready[completed][0]:
                _, checked, n, variant = ready.pop(completed)
                oracle_count += checked
                coverage["variants"][variant] += 1
                coverage["oracle_variants"][variant] += checked
                population = next(label for limit, label in ((16, "1-16"), (32, "17-32"), (64, "33-64"), (128, "65-128"),
                                  (256, "129-256"), (512, "257-512"), (1024, "513-1024"), (2048, "1025-2048"), (4096, "2049-4096")) if n <= limit)
                coverage["populations"].setdefault(population, 0)
                coverage["populations"][population] += 1
                coverage["max_n"] = max(coverage["max_n"], n)
                completed += 1
            state.update(next_case=completed, oracle_checks=oracle_count,
                         in_flight=len(pending), buffered_results=len(ready),
                         elapsed_seconds=previous.get("elapsed_seconds", 0) + time.monotonic() - started)
            now = time.monotonic()
            if now - last_report >= 2 or not pending:
                write_json(state_path, state)
                print(json.dumps({"completed": completed, "oracle_checks": oracle_count,
                                  "in_flight": len(pending), "buffered_results": len(ready),
                                  "elapsed_seconds": round(state["elapsed_seconds"], 2)}), flush=True)
                last_report = now
    # The budget stops dispatch. A running case retains its full per-case timeout,
    # so a time-budget boundary cannot manufacture an algorithmic counterexample.
    if failure:
        resource_limited = failure_key(failure["result"]) in {"timeout", "oracle_timeout", "resource_exhausted", "worker_error"}
        bundle = args.output / f"{'incomplete' if resource_limited else 'failure'}-{failure['index']:08d}"
        write_json(bundle / "scenario.json", failure["case"])
        write_json(bundle / "result.json", failure["result"])
        write_json(bundle / "metadata.json", state)
        if resource_limited:
            completed = failure["index"]
            state.update(status="incomplete", diagnostic_bundle=str(bundle), stop_reason=failure_key(failure["result"]))
        else:
            trace = run_native(args.engine, failure["case"], trace=True, timeout=args.case_timeout)
            write_json(bundle / "native-trace.json", trace)
            minimized = shrink(failure["case"], args.engine, failure_key(failure["result"]),
                               time.monotonic() + args.shrink_seconds, args.case_timeout)
            write_json(bundle / "minimized.json", minimized)
            state.update(status="failed", failure_bundle=str(bundle), stop_reason=failure_key(failure["result"]))
    elif maximum is not None and completed >= maximum:
        state.update(status="complete", stop_reason="bounded_cases_complete")
    else:
        state.update(status="incomplete", stop_reason="interrupted" if interrupted else "time_budget")
    state["next_case"] = completed
    state["oracle_checks"] = oracle_count
    state["elapsed_seconds"] = previous.get("elapsed_seconds", 0) + time.monotonic() - started
    state["peak_children_rss_bytes"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    write_json(state_path, state)
    print(json.dumps(state, indent=2))
    return 1 if state["status"] == "failed" else 0 if state["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
