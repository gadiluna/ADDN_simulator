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

for (const n of [1, 2, 12, 128]) {
  test(`seeded random network is reproducible and connected in every round for n=${n}`, () => {
    const seed = '9007199254740993123456789';
    const scenario = randomScenario(n, seed);
    expect(scenario).toEqual(randomScenario(n, seed));
    expect(scenario.n).toBe(n);
    expect(scenario.seed).toBe(seed);
    expect(scenario.variant).toBe('sharp');
    expect(scenario.leaders.length).toBeGreaterThan(0);
    expect(scenario.rounds.length).toBeGreaterThan(0);
    expect(validateScenario(JSON.parse(JSON.stringify(scenario)))).toEqual(scenario);
    for (const round of scenario.rounds) {
      expect(allVerticesReachable(n, round.edges)).toBe(true);
    }
  });
}

test('random generation changes with its seed, preserves the chosen schedule, and rejects invalid populations', () => {
  expect(randomScenario(12, '1729').rounds).not.toEqual(randomScenario(12, '1730').rounds);
  expect(randomScenario(12, '1729', 'core').variant).toBe('core');
  for (const n of [0, 129, 1.5, Number.NaN]) expect(() => randomScenario(n, '1729')).toThrow('integer from 1 to 128');
  const topology = randomScenario(12, '1729').rounds;
  for (const count of [1, 3, 12]) {
    const scenario = randomScenario(12, '1729', 'sharp', count);
    expect(scenario.leaders).toHaveLength(count);
    expect(scenario.rounds).toEqual(topology);
    expect(scenario).toEqual(randomScenario(12, '1729', 'sharp', count));
    expect(validateScenario(scenario)).toEqual(scenario);
  }
  expect(randomScenario(1, '1729', 'sharp', 1).leaders).toEqual([0]);
  for (const count of [0, 13, 1.5, Number.NaN]) expect(() => randomScenario(12, '1729', 'sharp', count)).toThrow('Leader count must be an integer');
});

test('both lower-bound presets reproduce the independent appendix fixtures including the final cycle', () => {
  const fixtureDirectory = fileURLToPath(new URL('../../tests/', import.meta.url));
  const python = process.env.COUNTING_PYTHON || 'python3';
  const reference = JSON.parse(execFileSync(python, ['-c', 'import json; from fixtures import lowerbound_pair; print(json.dumps(lowerbound_pair(6, 2)[:2]))'], {
    cwd: fixtureDirectory,
    encoding: 'utf8',
  })) as Scenario[];
  const ignoreDisplayName = ({ name: _name, ...scenario }: Scenario) => scenario;
  for (const [index, id] of ['lower-bound', 'lower-bound-companion'].entries()) {
    const scenario = presets.find(preset => preset.id === id)?.scenario;
    expect(scenario, `Missing ${id} preset`).toBeDefined();
    expect(ignoreDisplayName(scenario!)).toEqual(ignoreDisplayName(reference[index]));
    expect(validateScenario(scenario)).toEqual(scenario);
    const final = scenario!.rounds.at(-1)!.edges;
    expect(final).toHaveLength(scenario!.n);
    expect(new Set(final.map(edge => edge.source)).size).toBe(scenario!.n);
    expect(new Set(final.map(edge => edge.target)).size).toBe(scenario!.n);
    expect(scenario!.repeat_last).toBe(true);
  }
});
