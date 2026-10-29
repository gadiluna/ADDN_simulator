import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { presets, randomScenario, validateScenario } from '../src/scenarios';
import type { Edge, Scenario } from '../src/types';

function allVerticesReachable(n: number, edges: Edge[]): boolean {
  const adjacent: number[][] = Array.from({ length: n }, () => []);
  for (const edge of edges) adjacent[edge.source].push(edge.target);
  // Check reachability from every vertex, independently of the generator's cycle.
  for (let source = 0; source < n; source++) {
    const reached = new Set([source]);
    const pending = [source];
    while (pending.length) {
      for (const target of adjacent[pending.pop()!]) {
        if (!reached.has(target)) { reached.add(target); pending.push(target); }
      }
    }
    if (reached.size !== n) return false;
  }
  return true;
}

test('every preset uses core and importing a legacy sharp topology preserves its data without mutating it', () => {
  for (const preset of presets) expect(preset.scenario.variant, preset.id).toBe('core');
  const legacy: Scenario = { ...structuredClone(presets[0].scenario), variant: 'sharp', seed: '9007199254740993123456789' };
  legacy.rounds[0].edges[0].multiplicity = '9007199254740993123456789';
  const original = structuredClone(legacy);
  const expected = { ...original, variant: 'core' };
  expect(validateScenario(legacy)).toEqual(expected);
  expect(validateScenario({ scenario: legacy, diagnostics: { variant: 'sharp' } })).toEqual(expected);
  expect(legacy).toEqual(original);
  expect(() => validateScenario({ ...legacy, variant: 'unknown' })).toThrow(/variant/);
});

for (const n of [1, 2, 12, 128]) {
  test(`seeded random network is reproducible and connected in every round for n=${n}`, () => {
    const seed = '9007199254740993123456789';
    const scenario = randomScenario(n, seed);
    expect(scenario).toEqual(randomScenario(n, seed));
    expect(scenario.n).toBe(n);
    expect(scenario.seed).toBe(seed);
    expect(scenario.variant).toBe('core');
    expect(scenario.leaders.length).toBeGreaterThan(0);
    expect(scenario.rounds.length).toBeGreaterThan(0);
    expect(validateScenario(JSON.parse(JSON.stringify(scenario)))).toEqual(scenario);
    for (const round of scenario.rounds) {
      expect(allVerticesReachable(n, round.edges)).toBe(true);
    }
  });
}

test('random generation changes with its seed, uses the core schedule, and rejects invalid populations', () => {
  expect(randomScenario(12, '1729').rounds).not.toEqual(randomScenario(12, '1730').rounds);
  expect(randomScenario(12, '1729').variant).toBe('core');
  for (const n of [0, 129, 1.5, Number.NaN]) expect(() => randomScenario(n, '1729')).toThrow('integer from 1 to 128');
  const topology = randomScenario(12, '1729').rounds;
  for (const count of [1, 3, 12]) {
    const scenario = randomScenario(12, '1729', count);
    expect(scenario.leaders).toHaveLength(count);
    expect(scenario.rounds).toEqual(topology);
    expect(scenario).toEqual(randomScenario(12, '1729', count));
    expect(validateScenario(scenario)).toEqual(scenario);
  }
  expect(randomScenario(1, '1729', 1).leaders).toEqual([0]);
  for (const count of [0, 13, 1.5, Number.NaN]) expect(() => randomScenario(12, '1729', count)).toThrow('Leader count must be an integer');
});

for (const pair of [
  { n: 6, ell: 2, common: 9, ids: ['lower-bound', 'lower-bound-companion'] },
  { n: 4, ell: 1, common: 6, ids: ['one-leader-bound', 'one-leader-companion'] },
  { n: 4, ell: 4, common: 3, ids: ['all-leader-bound', 'all-leader-companion'] },
]) {
  test(`appendix pair n=${pair.n}, ℓ=${pair.ell} matches independent fixtures and designated leaders' vistas`, () => {
    const selected = pair.ids.map(id => {
      const preset = presets.find(item => item.id === id);
      expect(preset, `Missing ${id} preset`).toBeDefined();
      return preset!;
    });
    const fixtureDirectory = fileURLToPath(new URL('../../tests/', import.meta.url));
    const python = process.env.COUNTING_PYTHON || 'python3';
    // Compare graphs with independent fixtures, then reconstruct the actual web
    // scenarios' vistas through the first differing round using the Python oracle.
    const reference = JSON.parse(execFileSync(python, ['-c', `
import json, sys
from fixtures import lowerbound_pair
from oracle import simulate, node_signatures
left, right, x, y, common = lowerbound_pair(int(sys.argv[1]), int(sys.argv[2]))
signatures = []
for value, designated in zip(json.load(sys.stdin), (x, y)):
    result = simulate(value, max_rounds=common + 1, passive=True)
    signatures.append([node_signatures(snap)[snap["agents"][designated]["bottom"]]
                       for snap in result["snapshots"]])
print(json.dumps(dict(scenarios=[left, right], designated=[x, y], common=common,
                     signatures=signatures)))
`, String(pair.n), String(pair.ell)], {
      cwd: fixtureDirectory,
      encoding: 'utf8',
      input: JSON.stringify(selected.map(preset => preset.scenario)),
    })) as { scenarios: Scenario[]; designated: number[]; common: number; signatures: string[][] };
    const coreTopology = ({ name: _name, variant: _variant, ...scenario }: Scenario) => scenario;
    for (const [index, preset] of selected.entries()) {
      const scenario = preset.scenario;
      expect(coreTopology(scenario)).toEqual(coreTopology(reference.scenarios[index]));
      expect(validateScenario(scenario)).toEqual(scenario);
      expect(preset.designatedAgent).toBe(reference.designated[index]);
      expect(scenario.leaders).toContain(preset.designatedAgent);
      expect(scenario.repeat_last).toBe(true);
      if (pair.ell > 1 && pair.n > pair.ell) {
        const final = scenario.rounds.at(-1)!.edges;
        expect(final).toHaveLength(scenario.n);
        expect(new Set(final.map(edge => edge.source)).size).toBe(scenario.n);
        expect(new Set(final.map(edge => edge.target)).size).toBe(scenario.n);
      }
    }
    expect(reference.common).toBe(pair.common);
    expect(reference.signatures[0]).toHaveLength(pair.common + 2);
    expect(reference.signatures[1]).toHaveLength(pair.common + 2);
    for (let round = 0; round <= pair.common; round++) {
      expect(reference.signatures[0][round], `Common vista at round ${round}`).toBe(reference.signatures[1][round]);
    }
    expect(reference.signatures[0][pair.common + 1]).not.toBe(reference.signatures[1][pair.common + 1]);
  });
}
