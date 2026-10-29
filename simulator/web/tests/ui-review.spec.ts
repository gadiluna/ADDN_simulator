import { expect, test } from '@playwright/test';

test('random controls remain usable at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Dynamic Network' }).selectOption('random');
  for (const control of [
    page.getByRole('spinbutton', { name: 'Number of agents' }),
    page.getByRole('spinbutton', { name: 'Number of leaders' }),
    page.getByRole('button', { name: 'Generate random network' }),
  ]) await expect(control).toBeInViewport({ ratio: 1 });
  await page.getByRole('spinbutton', { name: 'Number of agents' }).fill('3');
  await page.getByRole('spinbutton', { name: 'Number of leaders' }).fill('3');
  await page.getByRole('button', { name: 'Generate random network' }).click();
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  for (let round = 1; round <= 5; round++) {
    await page.getByRole('button', { name: 'Advance one round' }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible();
});

test('Space opens and closes disclosures without starting playback', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('img', { name: 'Directed communication network' }).press('Enter');
  const math = page.getByText('Mathematical details', { exact: true });
  await math.press('Space');
  await expect(page.locator('.math-details')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Play execution', exact: true })).toBeVisible();
  await expect(page.locator('.math-waiting')).toBeVisible();
  for (let round = 1; round <= 5; round++) {
    await page.getByRole('button', { name: 'Advance one round' }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  const structure = page.locator('.math-step[data-step="1"]');
  const check = structure.locator('summary');
  // Core's earlier m=2 rejection may have automatically opened this section.
  if (await structure.getAttribute('open') !== null) await check.click();
  await check.press('Space');
  await expect(structure).toHaveAttribute('open', '');
  await expect(structure.locator('.math-step-evidence')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play execution', exact: true })).toBeVisible();
  await check.press('Space');
  await expect(structure).not.toHaveAttribute('open');
  await math.press('Space');
  await expect(page.locator('.math-details')).not.toHaveAttribute('open');
  await expect(page.getByTestId('round-number')).toHaveText('05');
  // Playback shortcuts still work when a graph, rather than a control, has focus.
  const graph = page.getByRole('img', { name: 'Directed communication network' });
  await graph.press('Space');
  await expect(page.getByRole('button', { name: 'Pause execution', exact: true })).toBeVisible();
  await graph.press('Space');
  await expect(page.getByRole('button', { name: 'Play execution', exact: true })).toBeVisible();
});

test('secondary graph and mathematical text meets normal-text contrast', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  for (let round = 1; round <= 11; round++) {
    await page.getByRole('button', { name: 'Advance one round' }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await page.getByRole('img', { name: 'Directed communication network' }).press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'Agent 1', exact: true })).toBeVisible();
  await page.getByText('Mathematical details', { exact: true }).click();
  for (const summary of await page.locator('.math-step > summary').all()) await summary.click();
  await expect(page.locator('.math-step')).toHaveCount(5);
  const measurements = await page.locator('.round-counter span, .local-heading, .agent-type, .agent-properties > div > span, .math-metadata dt, .math-step summary, .math-step-number, .math-status, .math-step-evidence p, .math-solution-check, .math-context, .math-evidence-label').evaluateAll(elements => {
    const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => channels(color).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return elements.map(element => {
      let ancestor: Element | null = element;
      let background = 'rgb(255, 255, 255)';
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') { background = candidate; break; }
        ancestor = ancestor.parentElement;
      }
      const fg = luminance(getComputedStyle(element).color), bg = luminance(background);
      return { text: element.textContent, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
    });
  });
  expect(measurements.length).toBeGreaterThan(10);
  for (const measurement of measurements) expect(measurement.contrast, measurement.text ?? '').toBeGreaterThanOrEqual(4.5);
});
