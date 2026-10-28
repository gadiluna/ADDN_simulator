import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAuditDetails } from '../src/audit-details';
import type { Audit, ViewNode } from '../src/types';

interface AuditInput {
  schema_version: 1;
  nodes: ViewNode[];
  visible_nodes: number[];
  candidate: number;
  final_level: number;
  ell: number;
}

interface OracleFixture {
  reason: string;
  input: AuditInput;
  expected: Audit;
}

const engineBuilt = existsSync(new URL('../public/engine.mjs', import.meta.url)) && existsSync(new URL('../public/engine.wasm', import.meta.url));

// Reuse the independent Python oracle's rejection fixtures instead of deriving
// expected verdicts from the presentation model being tested.
const fixtures: OracleFixture[] = JSON.parse(execFileSync('python3', ['-c', `
import json
from test_oracle import synthetic_audits
from oracle import audit
print(json.dumps([
    dict(reason=reason, input=dict(schema_version=1, **value),
         expected=audit(value['nodes'], value['visible_nodes'], value['candidate'],
                        value['final_level'], value['ell']))
    for reason, value in synthetic_audits()
]))
`], { cwd: fileURLToPath(new URL('../../tests/', import.meta.url)), encoding: 'utf8' }));

async function engineAudits(page: Page, inputs: AuditInput[]): Promise<Audit[]> {
  await page.goto('/');
  return page.evaluate(async values => {
    const moduleURL = new URL('/engine.mjs', location.href).href;
    const factory = (await import(/* @vite-ignore */ moduleURL)).default;
    const engine = await factory();
    return values.map(value => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const inputPointer = engine._malloc(bytes.byteLength + 1);
      if (!inputPointer) throw new Error('Could not allocate the audit input.');
      let resultPointer = 0;
      try {
        engine.HEAPU8.set(bytes, inputPointer);
        engine.HEAPU8[inputPointer + bytes.byteLength] = 0;
        resultPointer = engine.ccall('sim_audit_json', 'number', ['number'], [inputPointer]);
        if (!resultPointer) throw new Error(engine.UTF8ToString(engine.ccall('sim_last_error', 'number', [], [])));
        return JSON.parse(engine.UTF8ToString(resultPointer));
      } finally {
        if (resultPointer) engine.ccall('sim_free_string', null, ['number'], [resultPointer]);
        engine._free(inputPointer);
      }
    });
  }, inputs);
}

function details(input: AuditInput, audit: Audit) {
  return buildAuditDetails({
    audit, round: 2 * input.candidate - 1, ell: input.ell, variant: 'core',
    nodes: input.nodes, visibleNodes: input.visible_nodes,
  });
}

const failedStep: Record<string, number> = {
  leader_missing: 1, node_limit: 1, missing_child: 1, no_flat: 1,
  inconsistent: 3, non_unique: 3, non_integer: 3, non_positive: 3, wrong_total: 3,
  backward_flow: 4, suffix: 5,
};

const failedSolutionCheck: Record<string, number> = {
  inconsistent: 1, non_unique: 1, non_integer: 2, non_positive: 3, wrong_total: 4,
};

test('the five-stage evidence agrees with the real Wasm engine and independent oracle on every audit branch', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const audits = await engineAudits(page, fixtures.map(fixture => fixture.input));
  for (const [index, fixture] of fixtures.entries()) {
    const audit = audits[index];
    expect(audit, fixture.reason).toEqual(fixture.expected);
    const evidence = details(fixture.input, audit);
    expect(evidence.kind, fixture.reason).toBe('five-step');
    const stop = failedStep[fixture.reason] ?? 6;
    expect(evidence.steps.map(step => step.status), fixture.reason).toEqual(
      [1, 2, 3, 4, 5].map(number => number < stop ? 'passed' : number === stop ? 'failed' : 'not-reached'),
    );
    // The candidate total must remain a postcondition. Appending it to the
    // anchor equations would incorrectly make the non_unique fixture unique.
    expect(evidence.equations.map(({ terms, rhs }) => ({ terms, rhs })), fixture.reason).toEqual(audit.equations);
    expect(evidence.solution.values, fixture.reason).toEqual(audit.solution);
    const solutionStop = stop < 3 ? 0 : failedSolutionCheck[fixture.reason] ?? 5;
    expect(['unique', 'integral', 'positive', 'total'].map(key => evidence.solution[key as 'unique' | 'integral' | 'positive' | 'total'].status), fixture.reason).toEqual(
      [1, 2, 3, 4].map(number => solutionStop === 0 || number > solutionStop ? 'not-reached' : number === solutionStop ? 'failed' : 'passed'),
    );
    expect(evidence.descendants.map(row => ({ node: row.node, count: Number(row.count) })), fixture.reason).toEqual(audit.descendants);
  }
});

test('exact fractions, huge coefficients, backward balance and black descendants retain their mathematical witnesses', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const accepted = fixtures.find(fixture => fixture.reason === 'accepted')!.input;
  const fractionalNegative = structuredClone(accepted);
  fractionalNegative.nodes[3].outdegree = '0';
  fractionalNegative.nodes[3].incoming = [{ source: 1, multiplicity: '1' }];
  fractionalNegative.nodes[4].outdegree = '0';
  fractionalNegative.nodes[4].incoming = [{ source: 1, multiplicity: '2' }];
  const huge = structuredClone(accepted);
  const coefficient = ((1n << 200n) + 17n).toString();
  for (const node of huge.nodes.filter(node => node.level === 1)) {
    node.outdegree = coefficient;
    node.incoming[0].multiplicity = coefficient;
  }
  const backward = fixtures.find(fixture => fixture.reason === 'backward_flow')!.input;
  const suffix = fixtures.find(fixture => fixture.reason === 'suffix')!.input;
  const audits = await engineAudits(page, [fractionalNegative, huge, backward, suffix, accepted]);

  expect(audits[0]).toMatchObject({ reason: 'non_integer', solution: [{ node: 3, value: '1' }, { node: 4, value: '-1/2' }] });
  const fractions = details(fractionalNegative, audits[0]);
  expect(fractions.solution.values).toEqual(audits[0].solution);
  expect(fractions.solution.integral.status).toBe('failed');
  expect(fractions.solution.positive.status).toBe('not-reached');
  expect(fractions.solution.total.status).toBe('not-reached');

  expect(audits[1].reason).toBe('accepted');
  const exact = details(huge, audits[1]);
  expect(exact.equations.map(({ terms, rhs }) => ({ terms, rhs }))).toEqual(audits[1].equations);
  expect(exact.equations.flatMap(equation => equation.terms).some(term => term.coefficient === coefficient)).toBe(true);

  const backwardEvidence = details(backward, audits[2]);
  expect(backwardEvidence.backward.values.map(({ node, value }) => ({ node, value })).sort((a, b) => a.node - b.node)).toEqual([
    { node: 0, value: '2' }, { node: 1, value: '1' }, { node: 2, value: '1' },
    { node: 3, value: '1' }, { node: 4, value: '1' },
  ]);
  expect(backwardEvidence.backward.flows.map(({ node, left, right, passes }) => ({ node, left, right, passes }))).toEqual([
    { node: 1, left: '1', right: '2', passes: false },
    { node: 2, left: '1', right: '1', passes: true },
  ]);

  // Every suffix red edge crosses the black parent classes in this fixture.
  // Descendant counts must follow only the black tree, ignoring red ancestry.
  const suffixEvidence = details(suffix, audits[3]);
  expect(suffixEvidence.descendants.map(({ node, count, descendantNodes, passes }) => ({ node, count, descendantNodes, passes }))).toEqual([
    { node: 3, count: '2', descendantNodes: [5, 6], passes: false },
    { node: 4, count: '1', descendantNodes: [7], passes: true },
  ]);
  expect(details(accepted, audits[4]).descendants.map(({ node, count, descendantNodes }) => ({ node, count, descendantNodes }))).toEqual([
    { node: 3, count: '1', descendantNodes: [3] },
    { node: 4, count: '1', descendantNodes: [4] },
  ]);
});

test('global fibers, invisible branches and visible levels after the tested prefix cannot change local evidence', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const original = structuredClone(fixtures.find(fixture => fixture.reason === 'accepted')!.input);
  const changed = structuredClone(original);
  changed.nodes.forEach(node => { node.fiber = [99001, 99002, 99003]; });
  changed.nodes.push({ id: 5, level: 1, leader: true, parent: 1, outdegree: '987654321', incoming: [{ source: 2, multiplicity: '987654321' }], fiber: [99004] });
  changed.nodes.push({ id: 6, level: 2, leader: true, parent: 3, outdegree: '123456789', incoming: [{ source: 4, multiplicity: '123456789' }], fiber: [99005] });
  changed.visible_nodes.push(6);
  const [before, after] = await engineAudits(page, [original, changed]);
  expect(after).toEqual(before);
  expect(details(changed, after)).toEqual(details(original, before));
});
