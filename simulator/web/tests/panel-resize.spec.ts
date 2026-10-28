import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Core } from 'cytoscape';

const dividerName = 'Resize network and agent panels';

async function openInspector(page: Page) {
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('Enter');
  await expect(page.getByRole('complementary', { name: 'Agent inspector' })).toBeVisible();
  return page.getByRole('separator', { name: dividerName });
}

async function width(locator: Locator) {
  return (await locator.boundingBox())!.width;
}

async function dragBy(page: Page, divider: Locator, distance: number) {
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 12 });
  await expect(page.locator('.workspace')).toHaveClass(/is-resizing/);
  await page.mouse.up();
  await expect(page.locator('.workspace')).not.toHaveClass(/is-resizing/);
}

async function expectWidth(locator: Locator, expected: number) {
  await expect.poll(async () => Math.abs(await width(locator) - expected)).toBeLessThanOrEqual(2);
}

async function expectCanvasMatches(graph: Locator) {
  // The drawing surface must resize with its panel, not just its CSS container.
  await expect.poll(() => graph.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    return Math.abs(cy.width() - element.getBoundingClientRect().width);
  })).toBeLessThanOrEqual(2);
}

test('dragging the divider resizes both graphs, preserves the split, and respects panel limits', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const divider = await openInspector(page);
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  const network = page.getByRole('img', { name: 'Directed communication network', exact: true });
  const history = page.getByRole('img', { name: 'Local history view graph', exact: true });
  const initialNetworkWidth = await width(network);
  await expectWidth(inspector, 420);
  await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
  await expect(divider).toHaveAttribute('aria-controls', 'agent-inspector');

  await dragBy(page, divider, -160);
  await expectWidth(inspector, 580);
  await expectWidth(network, initialNetworkWidth - 160);
  await expectCanvasMatches(network);
  await expectCanvasMatches(history);
  await expect(page.getByTestId('round-number')).toHaveText('00');

  await page.getByRole('button', { name: 'Close agent details', exact: true }).click();
  await expect(divider).not.toBeVisible();
  await network.press('Enter');
  await expectWidth(inspector, 580);
  await divider.dblclick();
  await expectWidth(inspector, 420);

  await dragBy(page, divider, 300);
  await expectWidth(inspector, 320);
  await dragBy(page, divider, -900);
  await expectWidth(page.getByRole('region', { name: 'Simulation workspace' }), 400);
  await expect(page.getByRole('button', { name: 'Advance one round', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Close agent details', exact: true })).toBeInViewport({ ratio: 1 });
  await expectCanvasMatches(network);
  await expectCanvasMatches(history);

  // The completion badge must not push controls or collapse the recorded timeline
  // when the network is narrowed to its smallest supported panel width.
  for (let round = 1; round <= 10; round++) {
    await page.getByRole('button', { name: 'Advance one round', exact: true }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible();
  const playback = page.locator('.playback');
  expect(await playback.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(() => width(page.getByRole('slider', { name: 'Recorded round', exact: true }))).toBeGreaterThanOrEqual(100);
  const panelBounds = (await page.getByRole('region', { name: 'Simulation workspace' }).boundingBox())!;
  for (const control of [
    page.getByRole('button', { name: 'Restart execution', exact: true }),
    page.getByRole('button', { name: 'Play execution', exact: true }),
    page.getByRole('button', { name: 'Advance one round', exact: true }),
    page.getByRole('slider', { name: 'Recorded round', exact: true }),
    page.getByText('COMPLETE', { exact: true }),
  ]) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(panelBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width + 1);
  }
});

test('the divider supports keyboard resizing without playback shortcuts and cancels a drag cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const divider = await openInspector(page);
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await divider.press('ArrowLeft');
  await expectWidth(inspector, 452);
  await divider.press('Shift+ArrowLeft');
  await expectWidth(inspector, 516);
  await divider.press('ArrowRight');
  await expectWidth(inspector, 484);
  await divider.press('Space');
  await expect(page.getByRole('button', { name: 'Play execution', exact: true })).toBeVisible();
  await expect(page.getByTestId('round-number')).toHaveText('00');
  await divider.press('Home');
  await expectWidth(inspector, 320);
  await divider.press('End');
  await expectWidth(page.getByRole('region', { name: 'Simulation workspace' }), 400);
  await divider.dblclick();

  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator('.workspace')).toHaveClass(/is-resizing/);
  await divider.dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(page.locator('.workspace')).not.toHaveClass(/is-resizing/);
  const cancelledWidth = await width(inspector);
  await page.mouse.move(box.x - 180, box.y + box.height / 2);
  await page.mouse.up();
  await expectWidth(inspector, cancelledWidth);
  await expect(page.getByTestId('round-number')).toHaveText('00');
});

test('a resized split adapts to smaller windows and retains the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const divider = await openInspector(page);
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await dragBy(page, divider, -180);
  await expectWidth(inspector, 600);

  await page.setViewportSize({ width: 900, height: 768 });
  await expectWidth(page.getByRole('region', { name: 'Simulation workspace' }), 400);
  expect(await width(inspector)).toBeLessThanOrEqual(500);
  await divider.dblclick();
  await expectWidth(inspector, 360);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).not.toBeVisible();
  await expect(inspector).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Close agent details', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Restart execution', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(divider).toBeVisible();
  await expectWidth(inspector, 420);
});
