import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAuditDetails } from '../src/audit-details';
import type { Audit, Variant, ViewNode } from '../src/types';

interface Fixture {
  reason: string;
  nodes: ViewNode[];
  visible_nodes: number[];
  candidate: number;
  final_level: number;
  ell: number;
  audit: Audit;
}
const fixtures: Fixture[] = JSON.parse(execFileSync(process.env.COUNTING_PYTHON || 'python3', ['-c', `
import json
from test_oracle import synthetic_audits, flat_fixture
from oracle import audit
values = list(synthetic_audits())
huge = 2**200 + 17
values.append(('huge_total', dict(nodes=flat_fixture(huge,1,huge,1), visible_nodes=list(range(5)), candidate=3, final_level=1, ell=1)))
values.append(('huge_fraction', dict(nodes=flat_fixture(1,huge,1,huge), visible_nodes=list(range(5)), candidate=2, final_level=1, ell=1)))
print(json.dumps([dict(reason=reason, **value, audit=audit(value['nodes'],value['visible_nodes'],value['candidate'],value['final_level'],value['ell'])) for reason,value in values]))
`], { cwd: fileURLToPath(new URL('../../tests/', import.meta.url)), encoding: 'utf8' }));
function fixture(reason: string): Fixture { return structuredClone(fixtures.find(value => value.reason === reason)!); }
function explain(value: Fixture) {
  return buildAuditDetails({ audit: value.audit, nodes: value.nodes, visibleNodes: value.visible_nodes, round: 2 * value.candidate - 1, ell: value.ell, variant: 'core' });
}
const empty: Audit = { candidate: null, final_level: null, anchor: null, status: 'idle', reason: 'waiting', solution: [], equations: [], descendants: [] };
const failedSteps: Record<string, number> = { leader_missing: 1, node_limit: 1, missing_child: 1, no_flat: 1, inconsistent: 3, non_unique: 3, non_integer: 3, non_positive: 3, wrong_total: 3, backward_flow: 4, suffix: 5 };

for (const value of fixtures.filter(value => value.reason in failedSteps)) {
  test(`reports the exact first rejection and stops later stages: ${value.reason}`, () => {
    const details = explain(value);
    const failed = failedSteps[value.reason];
    expect(details.status).toBe('rejected');
    expect(JSON.stringify(details)).not.toMatch(/\bx(?:\(|_)/);
    expect(details.steps.map(step => step.status)).toEqual([1, 2, 3, 4, 5].map(number => number < failed ? 'passed' : number === failed ? 'failed' : 'not-reached'));
    expect(details.steps[failed - 1].witness).toBeTruthy();
    expect(details.witness).toBe(details.steps[failed - 1].witness);
    for (const later of details.steps.slice(failed)) expect(later.evidence).toEqual([]);
  });
}

test('no flat level is a structure rejection, and a later valid anchor is selected', () => {
  const noFlat = explain(fixture('no_flat'));
  expect(noFlat.structure.flatLevels).toEqual([]);
  expect(noFlat.witness).toContain('v1 has 2 children');
  expect(noFlat.steps[1].status).toBe('not-reached');
  const later = explain(fixture('backward_flow'));
  expect(later.structure.flatLevels).toEqual([1, 2]);
  expect(later.anchor).toBe(2);
  expect(later.steps[1].evidence[0].expression).toContain('max{1, 2} = 2');
});

test('node-limit evidence stops at the first rejected level', () => {
  const details = explain(fixture('node_limit'));
  expect(details.structure.levels).toHaveLength(2);
  expect(details.steps[0].evidence.map(line => line.label)).toEqual(['Leader in 𝓛_0', 'Level 𝓛_0']);
});

test('equation labels retain source-node provenance and total is never appended to the system', () => {
  const value = fixture('accepted');
  const details = explain(value);
  expect(details.equations.map(({ terms, rhs }) => ({ terms, rhs }))).toEqual(value.audit.equations);
  expect(details.equations.map(eq => [eq.kind, eq.parent, eq.label])).toEqual([
    ['flow', 1, 'Flow equation at 𝓛_1 for u = v1'], ['flow', 2, 'Flow equation at 𝓛_1 for u = v2'], ['leader', null, 'Leader equation at 𝓛_1'],
  ]);
  expect(details.solution.total.expression).toContain('separate post-solve check');
  expect(details.solution.total.expression).toContain('Σ_{v ∈ 𝓛_1} b(v)');
  expect(details.equations.some(eq => eq.expression.includes('b(v3)'))).toBe(true);
  expect(details.steps[2].evidence.some(line => line.label === 'Candidate anonymity b(v3)')).toBe(true);
  expect(explain(fixture('non_unique')).solution.unique.status).toBe('failed');
  expect(details.steps.every(step => step.status === 'passed')).toBe(true);
  expect(details.nextTest).toBeNull();
});

test('inconsistency and nonuniqueness have exact algebraic certificates', () => {
  const inconsistent = explain(fixture('inconsistent'));
  expect(inconsistent.solution.unique.witness).toContain('⇒ 0 = 1');
  expect(inconsistent.solution.unique.witness).toContain('[Flow equation at 𝓛_1 for u = v1]');
  expect(inconsistent.solution.unique.witness).toContain('[Leader equation at 𝓛_1]');
  const nonunique = explain(fixture('non_unique'));
  expect(nonunique.solution.unique.witness).toContain('rank(M) = 1 < 2');
  expect(nonunique.solution.unique.witness).toContain('z(v3) = 0, z(v4) = 1');
  expect(nonunique.solution.unique.witness).toContain('M·z = 0');
});

test('large integers and rational denominators remain exact in equations, solution and sum', () => {
  const huge = ((1n << 200n) + 17n).toString();
  const total = explain(fixture('huge_total'));
  expect(total.solution.values).toEqual([{ node: 3, value: '1' }, { node: 4, value: huge }]);
  expect(total.solution.total.witness).toBe(`Σ b(v) = ${(BigInt(huge) + 1n).toString()} ≠ m = 3.`);
  expect(total.equations[0].expression).toContain(huge);
  expect(JSON.stringify(total)).not.toMatch(/[0-9]e\+[0-9]/);
  const fraction = explain(fixture('huge_fraction'));
  expect(fraction.solution.values).toEqual([{ node: 3, value: '1' }, { node: 4, value: `1/${huge}` }]);
  expect(fraction.solution.integral.witness).toContain(`1/${huge} ∉ ℤ`);
  expect(fraction.solution.positive.status).toBe('not-reached');
  expect(fraction.solution.total.status).toBe('not-reached');
});

test('backward propagation exposes root and child sums, plus the exact unequal flow totals', () => {
  const details = explain(fixture('backward_flow'));
  expect(details.backward.values.find(value => value.node === 0)).toEqual({ node: 0, level: -1, value: '2', children: [{ node: 1, value: '1' }, { node: 2, value: '1' }] });
  expect(details.backward.flows.find(flow => !flow.passes)).toMatchObject({ node: 1, level: 1, left: '1', right: '2' });
  expect(details.witness).toBe('Flow equation at 𝓛_1 for u = v1: incoming total 1 ≠ outgoing total 2.');
  expect(details.descendants).toEqual([]);
  expect(details.backward.flows[0].expression).toContain('Σ_{v ∈ 𝓛_1} μ_1(v1,v)b(v)');
  expect(details.backward.flows[0].expression).toContain('Σ_{w child of v1 in 𝓛_1} d_1(w)b(w)');
  expect(details.steps[3].evidence.some(line => line.expression.includes('b(v0) = b(v1) + b(v2)'))).toBe(true);
});

test('suffix counts only black descendants and counts the anchor itself at an equal cutoff', () => {
  const suffix = explain(fixture('suffix'));
  expect(suffix.descendants).toEqual([
    { node: 3, count: '2', value: '1', passes: false, descendantNodes: [5, 6] },
    { node: 4, count: '1', value: '2', passes: true, descendantNodes: [7] },
  ]);
  expect(suffix.witness).toBe('q(v3) = 2 > b(v3) = 1 at 𝓛_2.');
  const equal = explain(fixture('accepted'));
  expect(equal.descendants.map(row => row.descendantNodes)).toEqual([[3], [4]]);
  expect(equal.steps[4].evidence[0].expression).toContain('counts itself');
});

test('observer-only fibers, invisible nodes and nodes after the cutoff cannot affect any evidence', () => {
  const original = fixture('accepted');
  const changed = structuredClone(original);
  for (const node of changed.nodes) Object.defineProperty(node, 'fiber', { get() { throw new Error('The evidence must never read observer-only fibers.'); } });
  const hidden = { id: 99 } as ViewNode;
  Object.defineProperty(hidden, 'level', { get() { throw new Error('The evidence must mask invisible nodes before reading their fields.'); } });
  changed.nodes.push(hidden);
  changed.nodes.push({ id: 100, level: 2, parent: 3, leader: true, outdegree: '999', incoming: [{ source: 4, multiplicity: '888' }], fiber: [] });
  changed.visible_nodes.push(100);
  expect(explain(changed)).toEqual(explain(original));
});

test('the engine verdict remains authoritative instead of being replaced by reconstructed diagnostics', () => {
  const value = fixture('accepted');
  // Deliberately inconsistent diagnostic fixture: an engine rejection must not
  // be converted to acceptance by this presentation-only model.
  value.audit.status = 'rejected';
  value.audit.reason = 'backward_flow';
  const details = explain(value);
  expect(details.status).toBe('rejected');
  expect(details.steps[3].status).toBe('failed');
  expect(details.steps[4].status).toBe('not-reached');
});

for (const [variant, ell, round, candidate, nextRound, finalLevel, kind] of [
  ['core', 1, 0, 1, 1, 1, 'five-step'],
  ['core', 3, 0, 3, 5, 3, 'five-step'],
  ['core', 3, 5, 4, 7, 4, 'five-step'],
  ['sharp', 1, 0, 1, 1, 0, 'all-leaders'],
  ['sharp', 1, 1, 2, 3, 2, 'five-step'],
  ['sharp', 1, 2, 2, 3, 2, 'five-step'],
  ['sharp', 3, 2, 3, 3, 0, 'all-leaders'],
  ['sharp', 3, 3, 4, 6, 3, 'five-step'],
  ['sharp', 3, 6, 5, 8, 4, 'five-step'],
] as const) {
  test(`waiting schedule ${variant}, ell=${ell}, round=${round}`, () => {
    const details = buildAuditDetails({ round, ell, variant, nodes: [], visibleNodes: [] });
    expect(details.kind).toBe('waiting');
    expect(details.steps).toEqual([]);
    expect(details.nextTest).toEqual({ round: nextRound, candidate, kind, finalLevel });
  });
}

test('all-leaders success and failure are separate from five steps, with local 𝓛_0 evidence', () => {
  const base = fixture('accepted');
  for (const accepted of [true, false]) {
    const audit: Audit = { ...empty, candidate: 2, final_level: 0, status: accepted ? 'accepted' : 'rejected', reason: accepted ? 'all_leaders' : 'nonleader_visible' };
    const details = buildAuditDetails({ audit, round: 2, ell: 2, variant: 'sharp', nodes: base.nodes, visibleNodes: accepted ? [0, 1] : [0, 1, 2] });
    expect(details.kind).toBe('all-leaders');
    expect(details.testRound).toBe(2);
    expect(details.steps).toEqual([]);
    expect(details.evidence[0].expression).toContain(accepted ? '𝓛_0: 0' : '𝓛_0: 1 (v2)');
    expect(details.nextTest).toEqual(accepted ? null : { candidate: 3, round: 4, kind: 'five-step', finalLevel: 2 });
  }
});

test('a retained successful audit reports its actual testing round and no next test', () => {
  const base = fixture('accepted');
  for (const variant of ['core', 'sharp'] as Variant[]) {
    const details = buildAuditDetails({ audit: base.audit, round: 50, ell: 1, variant, nodes: base.nodes, visibleNodes: base.visible_nodes, halted: true });
    expect(details.testRound).toBe(3);
    expect(details.nextTest).toBeNull();
  }
});
