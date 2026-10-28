"""Focused checks for reproducible paired native campaign coverage."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import io
from itertools import islice
import json
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from campaign import random_cases, scale_cases, should_sample
import campaign


def small_scenario(n, ell, seed, variant, max_multiplicity):
    """Record generator parameters without allocating hundreds of round graphs."""
    return dict(n=n, leaders=list(range(ell)), seed=str(seed), variant=variant,
                rounds=[dict(edges=[dict(source=0, target=0,
                                         multiplicity=str(max_multiplicity))])])


class CampaignCoverageTests(unittest.TestCase):
    def test_scale_reaches_2048_with_connected_changing_graphs_and_matching_variants(self):
        from fixtures import strong_connected
        sharp, core = list(islice(scale_cases(20261022, 2048), 2))
        self.assertEqual(sharp["n"], 2048)
        self.assertEqual(len(sharp["rounds"]), 64)
        self.assertTrue(sharp["repeat_last"])
        expected = deepcopy(sharp)
        expected["variant"] = "core"
        self.assertEqual(core, expected)
        previous = None
        for graph in sharp["rounds"]:
            self.assertTrue(strong_connected(2048, graph["edges"]))
            stride = graph["edges"][0]["target"]
            self.assertNotEqual(stride, previous)
            previous = stride

    def test_scale_leader_patterns_are_reproducible(self):
        first = list(islice(scale_cases(20261022, 16), 6))
        self.assertEqual(first, list(islice(scale_cases(20261022, 16), 6)))
        self.assertEqual([len(case["leaders"]) for case in first], [16, 16, 8, 8, 4, 4])

    def test_real_pairs_share_scenario_and_seed(self):
        values = list(islice(random_cases(20261017), 6))
        for offset in range(0, len(values), 2):
            sharp, core = values[offset:offset + 2]
            with self.subTest(pair=offset // 2):
                self.assertEqual((sharp["variant"], core["variant"]), ("sharp", "core"))
                expected = deepcopy(sharp)
                expected["variant"] = "core"
                self.assertEqual(core, expected)
                self.assertEqual(sharp["seed"], str(20261017 + offset // 2))
                self.assertIsNot(sharp["rounds"], core["rounds"])
                self.assertIsNot(sharp["leaders"], core["leaders"])

    def test_reproducibility_and_resume_by_index(self):
        with patch("fixtures.random_scenario", side_effect=small_scenario):
            first = list(islice(random_cases(20261017), 128))
            second = list(islice(random_cases(20261017), 128))
            resumed = list(islice(random_cases(20261017), 75, 128))
            changed_seed = list(islice(random_cases(20261018), 128))
        self.assertEqual(first, second)
        self.assertEqual(first[75:], resumed)
        self.assertNotEqual(first, changed_seed)

    def test_stress_and_huge_coefficients_are_not_coupled(self):
        with patch("fixtures.random_scenario", side_effect=small_scenario):
            values = list(islice(random_cases(20261017), 1024))
        combinations = set()
        stress_count = 0
        for pair_index, value in enumerate(values[::2]):
            stress = value["n"] > 64
            huge = int(value["rounds"][0]["edges"][0]["multiplicity"]) > 2**53
            combinations.add((stress, huge))
            self.assertEqual(stress, pair_index % 16 == 15)
            self.assertTrue(65 <= value["n"] <= 128 if stress else 1 <= value["n"] <= 64)
            stress_count += stress
        self.assertEqual(stress_count, 32)
        self.assertEqual(combinations, {(False, False), (False, True), (True, False), (True, True)})

    def test_leader_boundaries_cover_ordinary_and_stress_networks(self):
        with patch("fixtures.random_scenario", side_effect=small_scenario):
            values = list(islice(random_cases(20261017), 160))
        seen = {False: set(), True: set()}
        for pair_index, value in enumerate(values[::2]):
            n, ell = value["n"], len(value["leaders"])
            self.assertTrue(1 <= ell <= n)
            boundary = pair_index % 5
            if boundary < 4:
                expected = (1, min(2, n), max(1, n - 1), n)[boundary]
                self.assertEqual(ell, expected)
                seen[n > 64].add(boundary)
        self.assertEqual(seen, {False: {0, 1, 2, 3}, True: {0, 1, 2, 3}})

    def test_oracle_sampling_preserves_pairs_with_both_baseline_offsets(self):
        for baseline in (0, 6124):
            for n in (1, 16, 17, 24, 32, 33, 64, 128):
                sampled = 0
                for pair_index in range(32):
                    first = baseline + 2 * pair_index
                    sharp = should_sample(dict(n=n, variant="sharp"), first)
                    core = should_sample(dict(n=n, variant="core"), first + 1)
                    with self.subTest(baseline=baseline, n=n, pair=pair_index):
                        self.assertEqual(sharp, core)
                    sampled += sharp
                self.assertEqual(sampled, 32 if n <= 16 else 2 if n <= 32 else 0)


class CampaignMetadataTests(unittest.TestCase):
    def test_title_uses_balanced_braces_and_ignores_commented_commands(self):
        with tempfile.TemporaryDirectory(prefix="counting-title-test-") as directory:
            paper = Path(directory) / "paper.tex"
            paper.write_text("% \\title{Discarded}\n"
                             "\\title{Counting {with leaders} and \\{braces\\}:\n"
                             "exact termination}\n", encoding="utf-8")
            self.assertEqual(campaign.read_paper_title(paper),
                             "Counting {with leaders} and \\{braces\\}: exact termination")
            paper.write_text("\\title{unfinished", encoding="utf-8")
            self.assertIsNone(campaign.read_paper_title(paper))
            self.assertIsNone(campaign.read_paper_title(paper.with_name("absent.tex")))

    def test_metadata_tracks_title_without_fingerprinting_manuscript(self):
        with tempfile.TemporaryDirectory(prefix="counting-metadata-test-") as directory:
            root = Path(directory)
            sim = root / "simulator"
            sim.mkdir()
            engine = sim / "counting"
            engine.write_text("unchanged executable\n", encoding="utf-8")
            paper = root / "paper.tex"
            paper.write_text("\\title{Counting}\nFirst text.\n", encoding="utf-8")
            with patch("campaign.SIM", sim):
                before = campaign.metadata(engine)
                paper.write_text("\\title{Counting}\nRevised text.\n", encoding="utf-8")
                after = campaign.metadata(engine)
                self.assertEqual(before, after)
                self.assertEqual(after["paper_title"], "Counting")
                self.assertEqual({key for key in after if key.endswith("sha256")},
                                 {"engine_sha256", "generator_sha256"})
                paper.unlink()
                (root / "experiment-manifest.json").write_text(
                    json.dumps({"paper_title": "Packaged Counting"}), encoding="utf-8")
                self.assertEqual(campaign.metadata(engine)["paper_title"], "Packaged Counting")


class CampaignSchedulingTests(unittest.TestCase):
    def run_campaign(self, check_case, *, workers=2, maximum=4, cpu_count=128, population=33,
                     extra_args=(), resume_changes=None):
        """Run the real scheduler with lightweight concurrent worker jobs."""
        created = []

        def executor_factory(max_workers, initializer=None, initargs=()):
            created.append(max_workers)
            # Do not apply process memory limits inside this test process.
            return ThreadPoolExecutor(max_workers=max_workers)

        def generated(_seed):
            index = 0
            while True:
                yield dict(n=population, leaders=[0], variant="core", case_index=index,
                           rounds=[], repeat_last=True)
                index += 1

        meta = dict(engine_sha256="test-engine", paper_title="Counting",
                    generator_sha256="test-generator")
        old_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            with tempfile.TemporaryDirectory(prefix="counting-scheduler-test-") as directory:
                root = Path(directory)
                engine = root / "counting"
                engine.write_text("unused mock executable\n")
                output = root / "results"
                with (patch("campaign.concurrent.futures.ProcessPoolExecutor", side_effect=executor_factory),
                      patch("campaign.check_case", side_effect=check_case),
                      patch("campaign.random_cases", side_effect=generated),
                      patch("campaign.metadata", return_value=meta),
                      patch("campaign.os.cpu_count", return_value=cpu_count),
                      patch("campaign.total_memory", return_value=16 * 1024**3),
                      redirect_stdout(io.StringIO())):
                    arguments = ["--engine", str(engine), "--workers", str(workers),
                                 "--max-cases", str(maximum), "--output", str(output),
                                 "--skip-baseline", "--seconds", "10", *extra_args]
                    code = campaign.main(arguments)
                    if resume_changes is not None:
                        previous = json.loads((output / "checkpoint.json").read_text())
                        previous.update(resume_changes)
                        (output / "checkpoint.json").write_text(json.dumps(previous))
                        code = campaign.main([*arguments, "--resume"])
                checkpoint = json.loads((output / "checkpoint.json").read_text())
                bundles = {p.name: json.loads((p / "result.json").read_text())
                           for p in output.glob("incomplete-*")}
                return code, checkpoint, created, bundles
        finally:
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)

    @staticmethod
    def passed(job):
        return dict(index=job[0], ok=True, kind="pass", oracle_checked=True)

    def test_c_only_never_calls_oracle_sampler_even_for_small_populations(self):
        def native_check(job):
            self.assertFalse(job[3])
            return dict(index=job[0], ok=True, kind="pass")
        with patch("campaign.should_sample", side_effect=AssertionError("Oracle must not run")):
            code, checkpoint, _, _ = self.run_campaign(native_check, population=1, extra_args=("--c-only",))
        self.assertEqual(code, 0)
        self.assertTrue(checkpoint["c_only"])
        self.assertFalse(checkpoint["oracle_enabled"])
        self.assertEqual(checkpoint["oracle_checks"], 0)
        self.assertEqual(checkpoint["coverage"]["oracle_variants"], dict(core=0, sharp=0))

    def test_requested_64_workers_use_half_of_128_cpus(self):
        code, checkpoint, created, _ = self.run_campaign(self.passed, workers=64, maximum=1)
        self.assertEqual(code, 0)
        self.assertEqual(created, [64])
        self.assertEqual(checkpoint["workers"], 64)
        self.assertEqual(checkpoint["next_case"], 1)
        self.assertEqual(checkpoint["status"], "complete")
        self.assertEqual(checkpoint["coverage"]["variants"], dict(core=1, sharp=0))

    def test_resume_accepts_changed_manuscript_title(self):
        code, checkpoint, _, _ = self.run_campaign(
            self.passed, maximum=1, resume_changes={"paper_title": "Earlier title"})
        self.assertEqual(code, 0)
        self.assertEqual(checkpoint["paper_title"], "Counting")
        self.assertEqual(checkpoint["next_case"], 1)

    def test_resume_still_rejects_changed_executable_or_generator(self):
        for key in ("engine_sha256", "generator_sha256"):
            with self.subTest(key=key), patch("sys.stderr", new_callable=io.StringIO) as error:
                with self.assertRaises(SystemExit) as raised:
                    self.run_campaign(self.passed, maximum=1, resume_changes={key: "changed"})
                self.assertEqual(raised.exception.code, 2)
                self.assertIn(key + " changed", error.getvalue())

    def test_idle_worker_starts_next_case_before_slow_first_case_finishes(self):
        third_started = threading.Event()
        observed = {}

        def check(job):
            index = job[0]
            if index == 0:
                observed["next_started_before_first_finished"] = third_started.wait(2)
            elif index == 2:
                third_started.set()
            return self.passed(job)

        code, checkpoint, _, _ = self.run_campaign(check)
        self.assertTrue(observed["next_started_before_first_finished"])
        self.assertEqual(code, 0)
        self.assertEqual(checkpoint["next_case"], 4)
        self.assertEqual(checkpoint["oracle_checks"], 4)

    def test_out_of_order_resource_failure_preserves_contiguous_checkpoint(self):
        first_started = threading.Event()
        failure_returned = threading.Event()

        def check(job):
            index = job[0]
            if index == 0:
                first_started.set()
                if not failure_returned.wait(2):
                    raise AssertionError("second case did not run concurrently")
                time.sleep(0.04)
            elif index == 1:
                if not first_started.wait(2):
                    raise AssertionError("first case did not start")
                failure_returned.set()
                return dict(index=index, ok=False, kind="oracle_timeout", message="injected timeout")
            return self.passed(job)

        code, checkpoint, _, bundles = self.run_campaign(check)
        self.assertEqual(code, 2)
        self.assertEqual(checkpoint["status"], "incomplete")
        self.assertEqual(checkpoint["stop_reason"], "oracle_timeout")
        self.assertEqual(checkpoint["next_case"], 1)
        self.assertEqual(checkpoint["oracle_checks"], 1)
        self.assertEqual(checkpoint["coverage"]["variants"], dict(core=1, sharp=0))
        self.assertEqual(checkpoint["coverage"]["oracle_variants"], dict(core=1, sharp=0))
        self.assertEqual(checkpoint["coverage"]["populations"]["33-64"], 1)
        self.assertEqual(list(bundles), ["incomplete-00000001"])
        self.assertEqual(bundles["incomplete-00000001"]["index"], 1)


if __name__ == "__main__":
    unittest.main()
