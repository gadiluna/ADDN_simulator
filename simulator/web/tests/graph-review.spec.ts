import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { Core } from 'cytoscape';
import { existsSync } from 'node:fs';
import { networkPositions } from '../src/graph-layout';
import type { Scenario } from '../src/types';

const engineBuilt = existsSync(new URL('../public/engine.mjs', import.meta.url)) && existsSync(new URL('../public/engine.wasm', import.meta.url));

// Cytoscape associates its instance with the host; inspect the rendered graph,
// including its camera, without exposing testing hooks in application code.
async function graphState(graph: Locator) {
  return graph.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      width: cy.width(), height: cy.height(), zoom: cy.zoom(),
      nodes: cy.nodes().map(node => ({ id: node.id(), label: node.data('label') as string, fill: node.style('background-color'), border: node.style('border-style'), position: node.position(), box: node.renderedBoundingBox({ includeLabels: true, includeOverlays: false, includeUnderlays: false }) })),
      edges: cy.edges().map(edge => ({ id: edge.id(), source: edge.source().id(), target: edge.target().id(), muted: edge.hasClass('context-edge'), black: edge.hasClass('black'), red: edge.hasClass('red'), label: edge.data('label') as string })),
    };
  });
}

test('every supported population has separated initial node positions', () => {
  for (let n = 1; n <= 128; n++) {
    const positions = networkPositions({ n });
    expect(positions).toHaveLength(n);
    let minimumDistance = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const distance = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
      minimumDistance = Math.min(minimumDistance, distance);
    }
    expect(minimumDistance, `${n} agents need space for their nodes and focus halos`).toBeGreaterThanOrEqual(72);
  }
});

test('the renamed bidirected path keeps consecutive agents adjacent', () => {
  const positions = networkPositions({ n: 7, name: 'Bidirected path' });
  expect(positions).toEqual(networkPositions({ n: 7, name: 'A bidirected path' }));
  for (let i = 1; i < positions.length; i++) {
    const dx = Math.abs(positions[i].x - positions[i - 1].x);
    const dy = Math.abs(positions[i].y - positions[i - 1].y);
    expect(dx === 0 || dy === 0).toBe(true);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(170);
  }
});

for (const n of [32, 128]) test(`${n} agents fit without overlaps and retain every edge while focusing connections`, async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const scenario: Scenario = {
    schema_version: 1, name: `Layout regression ${n}`, variant: 'sharp', n, leaders: [0], repeat_last: true,
    rounds: [{ edges: [
      ...Array.from({ length: n }, (_, source) => [1, 5, 13].map(offset => ({ source, target: (source + offset) % n, multiplicity: '1' }))).flat(),
      { source: 0, target: 1, multiplicity: '9007199254740993123456789' },
    ] }],
  };
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scenario)) });
  if (engineBuilt) await expect(page.locator('.engine-status')).toHaveText('Ready');
  const graph = page.getByRole('img', { name: 'Directed communication network', exact: true });
  await expect.poll(async () => (await graphState(graph)).nodes.length).toBe(n);
  await page.getByRole('button', { name: 'Fit graph to view', exact: true }).click();
  const initial = await graphState(graph);
  for (const node of initial.nodes) {
    expect(node.box.x1).toBeGreaterThanOrEqual(0);
    expect(node.box.y1).toBeGreaterThanOrEqual(0);
    expect(node.box.x2).toBeLessThanOrEqual(initial.width);
    expect(node.box.y2).toBeLessThanOrEqual(initial.height);
  }
  const overlaps: string[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = initial.nodes[i].box, b = initial.nodes[j].box;
    if (!(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1)) overlaps.push(`${initial.nodes[i].id}, ${initial.nodes[j].id}`);
  }
  expect(overlaps).toEqual([]);
  expect(initial.edges).toHaveLength(n * 3);
  expect(initial.edges.find(edge => edge.id === 'e0-1')?.label).toBe('×9007199254740993123456790');
  expect(initial.edges.filter(edge => edge.muted).length).toBeGreaterThan(0);
  expect(initial.edges.every(edge => edge.muted === (edge.source !== 'a0' && edge.target !== 'a0'))).toBe(true);
  const showAll = page.getByRole('button', { name: 'Show all connections', exact: true });
  await showAll.click();
  await expect(showAll).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await graphState(graph)).edges.filter(edge => edge.muted).length).toBe(0);
  expect((await graphState(graph)).edges).toHaveLength(initial.edges.length);
  await showAll.click();
  await graph.press('ArrowDown');
  await expect.poll(async () => (await graphState(graph)).edges.every(edge => edge.muted === (edge.source !== 'a1' && edge.target !== 'a1'))).toBe(true);
  expect((await graphState(graph)).nodes.map(node => node.position)).toEqual(initial.nodes.map(node => node.position));

  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Close agent details', exact: true }).click();
  await page.getByRole('button', { name: 'Fit graph to view', exact: true }).click();
  const narrow = await graphState(graph);
  expect(narrow.nodes.every(node => node.box.x1 >= 0 && node.box.x2 <= narrow.width && node.box.y1 >= 0 && node.box.y2 <= narrow.height)).toBe(true);
  await expect(showAll).toBeInViewport({ ratio: 1 });
});

test('the vista can be traversed and inspected entirely from the keyboard', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('Enter');
  const history = page.getByRole('img', { name: 'Vista graph', exact: true });
  await expect(history).toHaveAttribute('tabindex', '0');
  await history.focus();
  await history.press('Home');
  await expect(history).toHaveAccessibleDescription(/Root/);
  await history.press('Enter');
  const heading = page.getByRole('heading', { name: /^History node v\d+$/ });
  const rootHeading = await heading.textContent();
  await history.press('ArrowRight');
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await history.press('Enter');
  await expect(heading).not.toHaveText(rootHeading!);
  await expect(history).toBeFocused();
  await history.press('End');
  await history.press(' ');
  await expect(page.getByRole('button', { name: 'Play execution', exact: true })).toBeVisible();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await history.press('Home');
  await history.press('Enter');
  await expect(heading).toHaveText(rootHeading!);
});

test('vista labels and leader colors follow the paper while observer facts stay optional', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  await page.goto('/');
  const scenario: Scenario = {
    schema_version: 1, name: 'Paper graph conventions', variant: 'core', n: 3, leaders: [0], repeat_last: true,
    rounds: [{ edges: [
      { source: 0, target: 1, multiplicity: '2' },
      { source: 1, target: 2, multiplicity: '2' },
      { source: 2, target: 0, multiplicity: '1' },
    ] }],
  };
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'paper-graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scenario)) });
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  const network = page.getByRole('img', { name: 'Directed communication network', exact: true });
  const initial = await graphState(network);
  expect(initial.nodes.map(node => node.label)).toEqual(['x0', 'x1', 'x2']);
  expect(initial.nodes[0].fill).toBe('rgb(219,234,254)');
  expect(initial.nodes[1].fill).toBe('rgb(255,255,255)');
  expect(initial.edges.every(edge => !edge.black && !edge.red)).toBe(true);
  expect(initial.edges.find(edge => edge.source === 'a0')?.label).toBe('×2');
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await network.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'Agent 1', exact: true })).toBeVisible();
  await expect(page.locator('.agent-type')).toHaveText('Nonleader');
  await expect(page.locator('.agent-properties')).toContainText('⊥');
  const vista = page.getByRole('img', { name: 'Vista graph', exact: true });
  const history = await graphState(vista);
  expect(history.nodes.every(node => node.label === 'Root' || node.label === node.id)).toBe(true);
  expect(history.edges.filter(edge => edge.black && edge.label === '2')).toHaveLength(1);
  expect(history.edges.filter(edge => edge.red && edge.label === '2')).toHaveLength(1);
  expect(history.edges.every(edge => ['', '2'].includes(edge.label))).toBe(true);
  for (const edge of history.edges) {
    const source = history.nodes.find(node => node.id === edge.source)!;
    const target = history.nodes.find(node => node.id === edge.target)!;
    expect(source.position.y).toBeLessThan(target.position.y);
    if (source.label === 'Root') expect(edge.label).toBe('');
  }
  await vista.press('End');
  await vista.press('Enter');
  await expect(page.locator('.fiber-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Observer overlay' }).check();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.locator('.fiber-note')).toContainText('Observer only · unavailable to the agent');
  await expect(page.locator('.fiber-note .paper-fiber')).toHaveCount(2);
  await expect(page.locator('.fiber-note .paper-anonymity')).toHaveText('a');
  expect((await graphState(network)).nodes.every(node => /^x\d+\nv\d+$/.test(node.label))).toBe(true);
  expect((await graphState(vista)).nodes.every(node => node.label === 'Root' || /^v\d+\na=\d+$/.test(node.label))).toBe(true);
  for (let round = 2; round <= 5; round++) {
    await page.getByRole('button', { name: 'Advance one round' }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible();
  const halted = await graphState(network);
  expect(halted.nodes.map(node => node.fill)).toEqual(initial.nodes.map(node => node.fill));
  expect(halted.nodes.every(node => node.border === 'double')).toBe(true);

  // A zero outdegree is a real observation; the root's level-zero sentinel is not.
  await page.getByRole('combobox', { name: 'Example scenario' }).selectOption('singleton');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await network.press('Enter');
  expect((await graphState(vista)).edges.filter(edge => edge.black).map(edge => edge.label).sort()).toEqual(['', '0']);
});
