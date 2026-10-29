import type { Edge, Scenario } from './types';

function cycleEdges(n: number, reverse = false): Edge[] {
  return Array.from({ length: n }, (_, i) => ({
    source: i,
    target: (i + (reverse ? n - 1 : 1)) % n,
    multiplicity: '1',
  }));
}

function edge(source: number, target: number, multiplicity = 1): Edge {
  return { source, target, multiplicity: String(multiplicity) };
}

function orderedCycleEdges(order: number[]): Edge[] {
  return order.map((source, i) => edge(source, order[(i + 1) % order.length]));
}

/** Appendix's several-leader pair, with the fixed final cycle repeated forever. */
function lowerBoundPair(): [Scenario, Scenario] {
  const n = 6, ell = 2, g = n - ell - 1;
  const leaders = [0, 1], x = 1, y = 2, yp = 3;
  const leftRelays = [3, 4, 5], rightRelays = [4, 5, 6];
  const leftNonleaders = [y], rightNonleaders = [2, 3];
  const left: Scenario['rounds'] = [], right: Scenario['rounds'] = [];
  const leftInitial = [
    ...orderedCycleEdges([...leftRelays, y]),
    ...leaders.map(u => edge(u, leftRelays[0])),
    ...leaders.map(u => edge(leftRelays[0], u)),
  ];
  const rightInitial = [
    ...orderedCycleEdges([...rightRelays, ...rightNonleaders]),
    ...leaders.map(u => edge(u, rightRelays[0])),
    ...leaders.map(u => edge(rightRelays[0], u)),
  ];
  for (let r = 0; r < g; r++) {
    left.push({ edges: leftInitial.map(e => ({ ...e })) });
    right.push({ edges: rightInitial.map(e => ({ ...e })) });
  }
  const twoCenter = (U: number[], W: number[], z: number, zp: number, c: number): Edge[] => [
    ...W.map(w => edge(z, w, c)),
    ...U.map(u => edge(zp, u)),
    ...U.filter(u => u !== z).map(u => edge(u, z, ell / c)),
    ...W.filter(w => w !== zp).map(w => edge(w, z, ell)),
  ];
  const relayFanout = (edges: Edge[], sender: number, relays: number[]): Edge[] => [
    ...edges.filter(e => !(e.source === sender && leaders.includes(e.target))),
    ...relays.map((target, i) => edge(i === 0 ? sender : relays[i - 1], target, ell)),
    ...leaders.map(u => edge(relays[relays.length - 1], u)),
  ];
  for (let t = 0; t < ell - 1; t++) {
    const star = [...leaders.map(u => edge(u, y)), ...leaders.map(u => edge(y, u))];
    left.push({ edges: relayFanout(star, y, leftRelays) });
    right.push({ edges: relayFanout(twoCenter(leaders, rightNonleaders, t, yp, ell), yp, rightRelays) });
  }
  for (let t = 0; t < ell - 1; t++) {
    left.push({ edges: relayFanout(twoCenter(leaders, leftNonleaders, t, y, 1), y, leftRelays) });
    right.push({ edges: relayFanout(twoCenter(rightNonleaders, leaders, ell + t, x, 1), ell + t, rightRelays) });
  }
  left.push({ edges: orderedCycleEdges([x, 0, y, ...leftRelays]) });
  right.push({ edges: orderedCycleEdges([x, 0, 2, yp, ...rightRelays]) });
  const scenario = (order: number, rounds: Scenario['rounds']): Scenario => ({
    schema_version: 1, name: `Lower bound · ${order} agents`, variant: 'core',
    n: order, leaders: [...leaders], rounds, repeat_last: true,
  });
  return [scenario(n, left), scenario(n + ell - 1, right)];
}

const [lowerBound, lowerBoundCompanion] = lowerBoundPair();

/** The appendix's path pairs, with the same known leader count in both networks. */
function pathLowerBoundPair(n: number, ell: number): [Scenario, Scenario] {
  const leaders = Array.from({ length: ell }, (_, i) => i);
  const oneLeader = ell === 1;
  const scenario = (order: number): Scenario => ({
    schema_version: 1,
    name: `${oneLeader ? 'One-leader bound' : order === n ? 'All-leader bound' : 'All-leader companion'} · ${order} agents`,
    variant: 'core', n: order, leaders: [...leaders], repeat_last: true,
    rounds: [{ edges: [
      ...Array.from({ length: order - 1 }, (_, i) => edge(i, i + 1)),
      ...Array.from({ length: order - 1 }, (_, i) => edge(i + 1, i)),
      ...(oneLeader ? [edge(order - 1, order - 1)] : []),
    ] }],
  });
  return [scenario(n), scenario(n + 1)];
}

const [oneLeaderBound, oneLeaderCompanion] = pathLowerBoundPair(4, 1);
const [allLeaderBound, allLeaderCompanion] = pathLowerBoundPair(4, 4);

export const presets: { id: string; name: string; note: string; tag: string; designatedAgent?: number; scenario: Scenario }[] = [
  {
    id: 'cycle', name: 'Alternating', note: 'Direction reverses every round.', tag: '06 AGENTS',
    scenario: { schema_version: 1, name: 'Alternating', variant: 'core', n: 6, leaders: [0, 3], rounds: Array.from({ length: 16 }, (_, i) => ({ edges: cycleEdges(6, i % 2 === 1) })), repeat_last: true, seed: '1' },
  },
  {
    id: 'path', name: 'Bidirected path', note: 'Information travels one hop at a time.', tag: '07 AGENTS',
    scenario: { schema_version: 1, name: 'Bidirected path', variant: 'core', n: 7, leaders: [0], rounds: [{ edges: Array.from({ length: 6 }, (_, i) => [{ source: i, target: i + 1, multiplicity: '1' }, { source: i + 1, target: i, multiplicity: '1' }]).flat() }], repeat_last: true },
  },
  {
    id: 'star', name: 'Rotating hub', note: 'The centre changes, the system stays connected.', tag: '08 AGENTS',
    scenario: { schema_version: 1, name: 'Rotating hub', variant: 'core', n: 8, leaders: [0, 4], rounds: Array.from({ length: 18 }, (_, r) => ({ edges: Array.from({ length: 8 }, (_, i) => i === r % 8 ? [] : [{ source: r % 8, target: i, multiplicity: '1' }, { source: i, target: r % 8, multiplicity: '1' }]).flat() })), repeat_last: true },
  },
  {
    id: 'singleton', name: 'One agent, no edges', note: 'The smallest possible counting problem.', tag: '01 AGENT',
    scenario: { schema_version: 1, name: 'One agent, no edges', variant: 'core', n: 1, leaders: [0], rounds: [{ edges: [] }], repeat_last: true },
  },
  {
    id: 'lower-bound', name: lowerBound.name!, note: 'Appendix pair: designated leader x₁ has the same vista in both networks through round 9.', tag: '06 AGENTS', designatedAgent: 1,
    scenario: lowerBound,
  },
  {
    id: 'lower-bound-companion', name: lowerBoundCompanion.name!, note: 'Appendix companion: designated leader x₁ has the same vista in both networks through round 9.', tag: '07 AGENTS', designatedAgent: 1,
    scenario: lowerBoundCompanion,
  },
  {
    id: 'one-leader-bound', name: oneLeaderBound.name!, note: 'Appendix pair with one leader and a terminal self-loop: x₀ has the same vista through round 6.', tag: '04 AGENTS', designatedAgent: 0,
    scenario: oneLeaderBound,
  },
  {
    id: 'one-leader-companion', name: oneLeaderCompanion.name!, note: 'One-leader companion with a terminal self-loop: x₀ has the same vista through round 6.', tag: '05 AGENTS', designatedAgent: 0,
    scenario: oneLeaderCompanion,
  },
  {
    id: 'all-leader-bound', name: allLeaderBound.name!, note: 'Appendix pair with four known leaders: x₀ has the same vista in both networks through round 3.', tag: '04 AGENTS', designatedAgent: 0,
    scenario: allLeaderBound,
  },
  {
    id: 'all-leader-companion', name: allLeaderCompanion.name!, note: 'Four leaders and one nonleader: designated leader x₀ has the same vista through round 3.', tag: '05 AGENTS', designatedAgent: 0,
    scenario: allLeaderCompanion,
  },
];

/** A seeded dynamic multigraph: a shuffled directed cycle guarantees connectivity. */
export function randomScenario(n: number, seed: string, leaderCount = 1): Scenario {
  if (!Number.isInteger(n) || n < 1 || n > 128) throw new Error('Agent count must be an integer from 1 to 128.');
  if (!Number.isInteger(leaderCount) || leaderCount < 1 || leaderCount > n) throw new Error('Leader count must be an integer from 1 to the number of agents.');
  // FNV-1a seed hashing and Mulberry32 use only specified 32-bit operations.
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0;
  const integer = (limit: number): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return Math.floor(((value ^ (value >>> 14)) >>> 0) / 4294967296 * limit);
  };
  const rounds = Array.from({ length: 2 * n - 1 }, () => {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = integer(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const counts = new Map<number, number>();
    const add = (source: number, target: number) => {
      const key = source * n + target;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    order.forEach((source, i) => add(source, order[(i + 1) % n]));
    const extraEdges = n + integer(n + 1);
    for (let i = 0; i < extraEdges; i++) add(integer(n), integer(n));
    return { edges: [...counts].sort(([a], [b]) => a - b).map(([key, count]) => edge(Math.floor(key / n), key % n, count)) };
  });
  const leaderOrder = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = integer(i + 1);
    [leaderOrder[i], leaderOrder[j]] = [leaderOrder[j], leaderOrder[i]];
  }
  return {
    schema_version: 1, name: `Random · ${n} agent${n === 1 ? '' : 's'}`, variant: 'core',
    n, leaders: leaderOrder.slice(0, leaderCount).sort((a, b) => a - b), rounds, repeat_last: true, seed,
  };
}

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Validate a network for the core-only viewer, including legacy sharp inputs.
 * Recorded results are discarded: the C engine produces a fresh core execution.
 */
export function validateScenario(input: unknown): Scenario {
  // Native failure bundles may contain the original scenario alongside diagnostics.
  const data = record(input) && 'scenario' in input ? input.scenario : input;
  if (!record(data)) fail('The scenario must be a JSON object.');
  if (data.schema_version !== 1) fail('schema_version must be 1.');
  if (data.variant !== 'core' && data.variant !== 'sharp') fail('variant must be "core" or "sharp".');
  if (!Number.isInteger(data.n) || (data.n as number) < 1 || (data.n as number) > 128) fail('n must be an integer from 1 to 128 for the interactive viewer.');
  const n = data.n as number;
  if (!Array.isArray(data.leaders) || !data.leaders.length) fail('leaders must contain at least one agent.');
  if (data.leaders.some(id => !Number.isInteger(id) || id < 0 || id >= n)) fail(`Every leader must be an agent ID from 0 to ${n - 1}.`);
  if (new Set(data.leaders).size !== data.leaders.length) fail('leaders must not contain duplicate IDs.');
  if (typeof data.repeat_last !== 'boolean') fail('repeat_last must explicitly be true or false.');
  if (data.name !== undefined && typeof data.name !== 'string') fail('name must be a string.');
  if (data.seed !== undefined && typeof data.seed !== 'string') fail('seed must be a string to preserve its exact value.');
  if (!Array.isArray(data.rounds) || data.rounds.length === 0 || data.rounds.length > 10000) fail('rounds must contain between 1 and 10,000 topologies.');
  const rounds = data.rounds.map((round: unknown, r: number) => {
    if (!record(round) || !Array.isArray(round.edges)) fail(`Round ${r + 1}: edges must be an array.`);
    if (round.edges.length > 50000) fail(`Round ${r + 1}: too many edges for the interactive viewer.`);
    const edges = round.edges.map((edge: unknown, e: number): Edge => {
      if (!record(edge)) fail(`Round ${r + 1}, edge ${e + 1}: expected an object.`);
      for (const key of ['source', 'target']) if (!Number.isInteger(edge[key]) || (edge[key] as number) < 0 || (edge[key] as number) >= n) fail(`Round ${r + 1}, edge ${e + 1}: ${key} must be an agent ID from 0 to ${n - 1}.`);
      if (typeof edge.multiplicity !== 'string' || !/^[0-9]+$/.test(edge.multiplicity) || BigInt(edge.multiplicity) <= 0n) fail(`Round ${r + 1}, edge ${e + 1}: multiplicity must be a positive decimal string, e.g. "1".`);
      return { source: edge.source as number, target: edge.target as number, multiplicity: BigInt(edge.multiplicity).toString() };
    });
    // A one-agent graph is strongly connected, including when there are no edges.
    for (const reverse of [false, true]) {
      const adjacency: number[][] = Array.from({ length: n }, () => []);
      edges.forEach(edge => adjacency[reverse ? edge.target : edge.source].push(reverse ? edge.source : edge.target));
      const reached = new Set<number>([0]);
      const queue = [0];
      for (let j = 0; j < queue.length; j++) for (const target of adjacency[queue[j]]) if (!reached.has(target)) { reached.add(target); queue.push(target); }
      if (reached.size !== n) fail(`Round ${r + 1}: the directed graph must be strongly connected.`);
    }
    return { edges };
  });
  return { schema_version: 1, variant: 'core', n, leaders: [...data.leaders] as number[], rounds, repeat_last: data.repeat_last, ...(typeof data.name === 'string' ? { name: data.name } : {}), ...(typeof data.seed === 'string' ? { seed: data.seed } : {}) };
}

export function graphAt(scenario: Scenario, round: number): Edge[] {
  if (round < scenario.rounds.length) return scenario.rounds[round].edges;
  return scenario.repeat_last ? scenario.rounds[scenario.rounds.length - 1].edges : [];
}

export function exportJSON(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
