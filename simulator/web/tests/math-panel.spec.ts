import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomScenario } from '../src/scenarios';

async function advance(page: Page, first: number, last: number) {
  for (let round = first; round <= last; round++) {
    await page.getByRole('button', { name: 'Advance one round', exact: true }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
}
async function inspect(page: Page) {
  await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('Enter');
  await page.getByText('Mathematical details', { exact: true }).click();
}
async function openStep(page: Page, step: number) {
  const section = page.locator(`.math-step[data-step="${step}"]`);
  if (await section.getAttribute('open') === null) await section.locator('summary').click();
  return section;
}

test('core waits for 2m−1, then exposes the five paper checks and the exact rejection', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await inspect(page);
  await expect(page.locator('.math-waiting')).toBeVisible();
  await expect(page.locator('.math-next-test')).toContainText('round 3');
  await expect(page.locator('.math-step')).toHaveCount(0);

  await advance(page, 1, 2);
  await expect(page.locator('.math-waiting')).toBeVisible();
  await expect(page.locator('.math-special')).toHaveCount(0);
  await expect(page.locator('.math-next-test')).toContainText('round 3');
  await advance(page, 3, 3);
  await expect(page.locator('.math-step[data-step="1"]')).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('.math-step-title')).toHaveText([
    'Check the visible structure', 'Choose the anchor', 'Solve the anchor',
    'Propagate backward', 'Check the suffix',
  ]);
  await expect(page.locator('.math-next-test')).toContainText('round 5');
  await advance(page, 4, 4);
  await expect(page.locator('.math-waiting')).toBeVisible();
  await advance(page, 5, 5);
  const statuses = await page.locator('.math-step').evaluateAll(steps => steps.map(step => step.getAttribute('data-status')));
  expect(statuses).toEqual(['passed', 'passed', 'failed', 'not-reached', 'not-reached']);
  await expect(page.locator('.math-step[data-step="3"]')).toHaveAttribute('open', '');
  for (const check of ['unique', 'integer', 'positive']) await expect(page.locator(`.math-solution-check[data-check="${check}"]`)).toHaveAttribute('data-status', 'passed');
  const total = page.locator('.math-solution-check[data-check="total"]');
  await expect(total).toHaveAttribute('data-status', 'failed');
  await expect(total).toContainText(/2\s*\+\s*2\s*\+\s*2\s*=\s*6/);
  await expect(total).toContainText(/6\s*≠\s*(m\s*=\s*)?3/);
  await expect(page.locator('.math-step[data-step="3"]')).toContainText('Flow equation');
  await expect(page.locator('.math-step[data-step="3"]')).toContainText('Leader equation');
  await expect(total).toContainText('b(v)');
  await expect(page.locator('.math-audit')).not.toContainText(/\bx(?:\(|_)/);
});

test('accepted candidate exposes the separate total, backward checks and descendant inequalities', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await advance(page, 1, 11);
  await inspect(page);
  await expect(page.locator('.math-step[data-status="passed"]')).toHaveCount(5);
  await expect(page.locator('.math-next-test')).toHaveCount(0);
  const anchor = await openStep(page, 3);
  const total = anchor.locator('.math-solution-check[data-check="total"]');
  await expect(total).toHaveAttribute('data-status', 'passed');
  await expect(total).toContainText(/2\s*\+\s*2\s*\+\s*2\s*=\s*6/);
  await expect(anchor).toContainText('candidate number of agents');
  await expect(anchor.locator('.math-definition')).toContainText('b(v)');
  await expect(anchor).toContainText('b(v18) = 2');
  // Formula typography must keep the same symbols and exact coefficients.
  const flowRule = anchor.locator('.paper-text').filter({ hasText: 'for u ∈' });
  await expect(flowRule.locator('.paper-sum')).toHaveCount(2);
  await expect(flowRule.locator('.paper-sum-bound').first()).toContainText('v ∈ 𝓛6');
  await expect(flowRule.locator('.paper-anonymity').first()).toHaveText('b');
  await expect(flowRule).not.toContainText(/[_{}]/);
  await expect(anchor.locator('.math-definition .paper-anonymity')).toHaveText('b');
  const backward = await openStep(page, 4);
  await expect(backward).toContainText('Disjoint refinement');
  await expect(backward).toContainText(/flow/i);
  await expect(backward).toContainText('μ1(');
  await expect(backward).toContainText('d1(w)b(w)');
  await expect(backward).toContainText('b(v0)');
  await expect(backward.locator('.math-evidence-line[data-result="fail"]')).toHaveCount(0);
  await openStep(page, 5);
  await expect(page.locator('.math-descendants thead th')).toHaveText(['Node', 'q(v)', 'b(v)', 'q(v) ≤ b(v)']);
  await expect(page.locator('.math-audit')).not.toContainText(/\bx(?:\(|_)/);
  const comparisons = page.locator('.math-descendants tbody tr');
  await expect(comparisons).toHaveCount(3);
  for (const row of await comparisons.all()) {
    await expect(row).toContainText('1 ≤ 2');
    await expect(row).toContainText('Passed');
  }
  await expect(page.locator('.math-step[data-step="5"]')).toContainText('𝓛6');
  await expect(page.locator('.math-step[data-step="5"]')).toContainText(/itself/);
  await anchor.getByRole('button', { name: 'Inspect history node v18', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'History node v18', exact: true })).toBeInViewport();

  await page.setViewportSize({ width: 320, height: 740 });
  // Keep row identities stable while closing them changes the set of open rows.
  for (const section of await page.locator('.math-step').all()) {
    if (await section.getAttribute('open') !== null) await section.locator('summary').click();
  }
  await openStep(page, 5);
  await expect(page.locator('.math-descendants')).toBeVisible();
  expect(await page.locator('.inspector-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Close agent details', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Restart execution', exact: true })).toBeInViewport();
});

test('a structural rejection identifies the actual level, count and limit', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'fixed-random.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(randomScenario(12, '1'))) });
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await advance(page, 1, 3);
  // Imported scenarios initially select their leader; choose agent zero for the recorded witness.
  await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('Enter');
  for (let moved = 0; moved < 12 && await page.getByRole('heading', { name: 'Agent 0', exact: true }).count() === 0; moved++) {
    await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('ArrowDown');
  }
  await expect(page.getByRole('heading', { name: 'Agent 0', exact: true })).toBeVisible();
  await page.getByText('Mathematical details', { exact: true }).click();
  await expect(page.locator('.math-step[data-step="1"]')).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('.math-step[data-status="not-reached"]')).toHaveCount(4);
  await expect(page.locator('.math-step[data-step="1"]')).toContainText('𝓛1');
  await expect(page.locator('.math-step[data-step="1"]')).toContainText(/7\s*>\s*(m\s*=\s*)?2/);
  await expect(page.locator('.math-descendants')).toHaveCount(0);
});

test('the singleton runs the full core audit at round one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Example scenario' }).selectOption('singleton');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await advance(page, 1, 1);
  await inspect(page);
  await expect(page.locator('.math-special')).toHaveCount(0);
  await expect(page.locator('.math-step[data-status="passed"]')).toHaveCount(5);
  await expect(page.locator('.math-next-test')).toHaveCount(0);
  await expect(page.locator('.output-value')).toHaveText('1');
  await expect(page.locator('.math-metadata')).toContainText('Candidate m1');
  const suffix = await openStep(page, 5);
  await expect(suffix).toContainText('1 ≤ 1');
  await expect(suffix).toContainText('𝓛1');
});
