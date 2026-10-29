import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { presets, validateScenario } from '../src/scenarios';

const engineBuilt = existsSync(new URL('../public/engine.mjs', import.meta.url)) && existsSync(new URL('../public/engine.wasm', import.meta.url));
const artifacts = fileURLToPath(new URL('../../results/minimal-ui/', import.meta.url));
mkdirSync(artifacts, { recursive: true });

async function openOptions(page: Page) {
  const button = page.getByRole('button', { name: 'Options', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
async function optionAction(page: Page, name: string) {
  await openOptions(page);
  await page.getByRole('button', { name, exact: true }).click();
}
async function inspectAgent(page: Page) {
  await page.getByRole('img', { name: 'Directed communication network' }).press('Enter');
  await expect(page.getByRole('complementary', { name: 'Agent inspector' })).toBeVisible();
}

test('scenario validation preserves exact multiplicities and rejects invalid topology', () => {
  const scenario = structuredClone(presets[0].scenario);
  scenario.rounds[0].edges[0].multiplicity = '9007199254740993123456789';
  expect(validateScenario(scenario).rounds[0].edges[0].multiplicity).toBe('9007199254740993123456789');
  expect(() => validateScenario({ ...scenario, leaders: [0, 0] })).toThrow('duplicate');
  expect(() => validateScenario({ ...scenario, rounds: [{ edges: [] }] })).toThrow('strongly connected');
  expect(validateScenario(presets[3].scenario).rounds[0].edges).toEqual([]);
});

test('scenario editor validates data and exported JSON can be reimported', async ({ page }) => {
  await page.goto('/');
  await optionAction(page, 'Edit scenario');
  await page.getByRole('button', { name: 'Full scenario JSON' }).click();
  const json = page.getByRole('textbox', { name: 'Scenario JSON' });
  await json.fill('{"schema_version": 2}');
  await page.getByRole('button', { name: 'Apply scenario' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'schema_version must be 1' })).toBeVisible();
  await expect(page.locator('.editor-hint')).toContainText('Imported networks run the core algorithm (§4.1).');
  await json.fill(JSON.stringify({ ...presets[3].scenario, variant: 'sharp' }));
  await page.getByRole('button', { name: 'Apply scenario' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const picker = page.getByRole('combobox', { name: 'Example scenario' });
  await expect(picker).toHaveValue('custom');
  await expect(picker.locator('option:checked')).toHaveText('One agent, no edges');
  const pending = page.waitForEvent('download');
  await optionAction(page, 'Export scenario');
  const download = await pending;
  expect(download.suggestedFilename()).toBe('counting-scenario.json');
  const path = await download.path();
  if (!path) throw new Error('The scenario download was not saved.');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(presets[3].scenario);
  await page.getByLabel('Import scenario file').setInputFiles(path);
  await expect(picker.locator('option:checked')).toHaveText('One agent, no edges');
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ scenario: presets[1].scenario })) });
  await expect(picker.locator('option:checked')).toHaveText('Bidirected path');
});

test('lower bounds and random networks still run and replay exported scenarios', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Example scenario' });
  await expect(picker.locator('option:checked')).toHaveText('Alternating');
  await picker.selectOption('lower-bound');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await picker.selectOption('lower-bound-companion');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await expect(page.getByTestId('round-number')).toHaveText('00');
  await picker.selectOption('random');
  await page.getByRole('spinbutton', { name: 'Number of agents' }).fill('9');
  await page.getByRole('spinbutton', { name: 'Number of leaders' }).fill('3');
  await page.getByRole('button', { name: 'Generate random network' }).click();
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  const exportScenario = async () => {
    const pending = page.waitForEvent('download');
    await optionAction(page, 'Export scenario');
    const path = await (await pending).path();
    if (!path) throw new Error('The scenario download was not saved.');
    return { path, scenario: JSON.parse(readFileSync(path, 'utf8')) };
  };
  const first = await exportScenario();
  expect(first.scenario.n).toBe(9);
  expect(first.scenario.leaders).toHaveLength(3);
  expect(first.scenario.seed).toEqual(expect.any(String));
  expect(validateScenario(first.scenario)).toEqual(first.scenario);
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await page.getByLabel('Import scenario file').setInputFiles(first.path);
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await expect(page.getByTestId('round-number')).toHaveText('00');
  expect((await exportScenario()).scenario).toEqual(first.scenario);
  await picker.selectOption('random');
  await page.getByRole('spinbutton', { name: 'Number of agents' }).fill('9');
  await page.getByRole('button', { name: 'Generate random network' }).click();
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  expect((await exportScenario()).scenario.seed).not.toBe(first.scenario.seed);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: `${artifacts}/random-desktop.png`, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('random population controls fit on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Example scenario' }).selectOption('random');
  const count = page.getByRole('spinbutton', { name: 'Number of agents' });
  const leaders = page.getByRole('spinbutton', { name: 'Number of leaders' });
  const generate = page.getByRole('button', { name: 'Generate random network' });
  await expect(count).toBeInViewport({ ratio: 1 });
  await expect(leaders).toBeInViewport({ ratio: 1 });
  await expect(generate).toBeInViewport({ ratio: 1 });
  await leaders.fill('12');
  await count.fill('3');
  await expect(leaders).toHaveValue('3');
  await expect(leaders).toHaveAttribute('max', '3');
  await leaders.fill('0');
  await generate.click();
  expect(await leaders.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  await leaders.fill('4');
  await generate.click();
  expect(await leaders.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
  await leaders.fill('3'); await generate.click();
  if (engineBuilt) await expect(page.locator('.engine-status')).toHaveText('Ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/random-mobile.png`, animations: 'disabled' });
  if (engineBuilt) {
    for (let round = 1; round <= 5; round++) {
      await page.getByRole('button', { name: 'Advance one round' }).click();
      await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
    }
    await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible();
    await inspectAgent(page);
    await expect(page.locator('.output-value')).toHaveText('3');
  }
});

test('options hide secondary controls and close with Escape or an outside click', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Edit scenario' })).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).not.toBeVisible();
  await openOptions(page);
  await expect(page.getByRole('button', { name: 'Edit scenario' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('450');
  await page.getByRole('checkbox', { name: 'Observer overlay' }).check();
  await page.getByRole('button', { name: 'Options', exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Observer knowledge · unavailable to the algorithm', { exact: true })).toBeVisible();
  await openOptions(page);
  await page.getByRole('heading', { name: 'Counting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await optionAction(page, 'Help & legend');
  const help = page.getByRole('dialog', { name: 'Simulation help' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Leader', { exact: true })).toBeVisible();
  await expect(page.locator('.graph-legend')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(help).not.toBeVisible();
});

test('missing engine is reported without fabricated execution data', async ({ page }) => {
  await page.route('**/engine.mjs', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Engine unavailable');
  await expect(page.getByRole('alert')).toContainText('Engine unavailable');
  await expect(page.getByRole('button', { name: 'Advance one round' })).toBeDisabled();
  await expect(page.getByTestId('round-number')).toHaveText('00');
});

test('real engine replays rounds and opens local history and math only when inspecting', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  const next = page.getByRole('button', { name: 'Advance one round' });
  await next.click(); await expect(page.getByTestId('round-number')).toHaveText('01');
  await next.click(); await expect(page.getByTestId('round-number')).toHaveText('02');
  await page.locator('#timeline').fill('0');
  await expect(page.getByTestId('round-number')).toHaveText('00');
  await next.click(); await expect(page.getByTestId('round-number')).toHaveText('01');
  await inspectAgent(page);
  await expect(page.getByRole('img', { name: 'Local history view graph' })).toBeVisible();
  await page.getByRole('img', { name: 'Directed communication network' }).press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'Agent 1', exact: true })).toBeVisible();
  await page.getByText('Mathematical details', { exact: true }).click();
  await expect(page.locator('.math-waiting')).toBeVisible();
  await expect(page.locator('.math-step')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Example scenario' }).selectOption('singleton');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await expect(page.getByRole('complementary', { name: 'Agent inspector' })).not.toBeVisible();
  await next.click();
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  await inspectAgent(page);
  await expect(page.locator('.output-value')).toHaveText('1');
});

test('mobile workspace and agent drawer have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  if (engineBuilt) await expect(page.locator('.engine-status')).toHaveText('Ready');
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/mobile.png`, animations: 'disabled' });
  if (engineBuilt) {
    await inspectAgent(page);
    await expect(page.getByRole('button', { name: 'Close agent details' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('img', { name: 'Local history view graph' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Play execution' }).click();
    await page.getByRole('button', { name: 'Pause execution' }).click();
    await page.screenshot({ path: `${artifacts}/mobile-inspector.png`, animations: 'disabled' });
  }
});

test('a finite sequence ends as incomplete without requesting a nonexistent round', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine before this integration test.');
  await page.goto('/');
  const scenario = { ...structuredClone(presets[1].scenario), repeat_last: false };
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'finite.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scenario)) });
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Advance one round' }).click();
  await expect(page.getByTestId('round-number')).toHaveText('01');
  await expect(page.getByText('Execution incomplete: the topology sequence is exhausted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Advance one round' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play execution' })).toBeDisabled();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('playback uses core for presets and legacy imports, exports core traces, and restarts cleanly', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await openOptions(page);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('160');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Play execution' }).click();
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('round-number')).toHaveText('11');
  await inspectAgent(page);
  await expect(page.locator('.output-value')).toHaveText('6');
  const legacyScenario = { ...structuredClone(presets[0].scenario), variant: 'sharp' };
  await page.getByLabel('Import scenario file').setInputFiles({ name: 'legacy-sharp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyScenario)) });
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  const notice = page.getByRole('status').filter({ hasText: 'Imported network now runs the core algorithm (§4.1).' });
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss import notice' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('round-number')).toHaveText('00');
  await page.getByRole('button', { name: 'Play execution' }).click();
  await expect(page.getByText('COMPLETE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('round-number')).toHaveText('11');
  const exportDownload = page.waitForEvent('download');
  await optionAction(page, 'Export recorded trace');
  const tracePath = await (await exportDownload).path();
  if (!tracePath) throw new Error('The recorded trace was not saved.');
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  expect(trace.scenario).toEqual({ ...legacyScenario, variant: 'core' });
  expect(trace.snapshots).toHaveLength(12);
  for (const snapshot of trace.snapshots) {
    expect(snapshot.variant).toBe('core');
    expect(snapshot.complete).toBe(snapshot.round === 11);
    for (const agent of snapshot.agents) {
      expect(agent.halted).toBe(snapshot.round === 11);
      if (snapshot.round >= 3 && snapshot.round % 2 === 1) {
        expect(agent.audit.candidate).toBe((snapshot.round + 1) / 2);
        expect(agent.audit.final_level).toBe(agent.audit.candidate);
      } else expect(agent.audit.status).toBe('idle');
    }
  }
  const scenarioDownload = page.waitForEvent('download');
  await optionAction(page, 'Export scenario');
  const scenarioPath = await (await scenarioDownload).path();
  if (!scenarioPath) throw new Error('The scenario was not saved.');
  expect(JSON.parse(readFileSync(scenarioPath, 'utf8'))).toEqual(trace.scenario);
  await page.getByRole('button', { name: 'Restart execution' }).click();
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await expect(page.getByTestId('round-number')).toHaveText('00');
  await expect(page.locator('#timeline')).toHaveAttribute('max', '0');
  expect(errors).toEqual([]);
});

test('minimal desktop keeps the large canvas and playback in one viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  if (engineBuilt) await expect(page.locator('.engine-status')).toHaveText('Ready');
  for (const name of ['Core', 'Sharp', 'Network', 'Local view', 'Both', 'Agent details', 'Previous round']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.agent-strip, .graph-legend, .header-caption, .live-tag')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Agent inspector' })).not.toBeVisible();
  const network = page.getByRole('img', { name: 'Directed communication network' });
  const play = page.getByRole('button', { name: 'Play execution' });
  await expect(network).toBeInViewport({ ratio: 1 });
  await expect(play).toBeInViewport({ ratio: 1 });
  const bounds = await network.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(600);
  expect(bounds!.width).toBeGreaterThanOrEqual(1200);
  const metrics = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    buttons: [...document.querySelectorAll('button')].filter(button => button.getClientRects().length > 0 && getComputedStyle(button).visibility !== 'hidden').map(button => ({ label: button.getAttribute('aria-label') || button.textContent?.trim(), fontSize: parseFloat(getComputedStyle(button).fontSize) })),
  }));
  expect(metrics.document).toEqual(metrics.viewport);
  expect(metrics.buttons.filter(button => button.fontSize < 13)).toEqual([]);
  await page.screenshot({ path: `${artifacts}/desktop.png`, animations: 'disabled' });
  writeFileSync(`${artifacts}/layout-metrics.json`, JSON.stringify({ ...metrics, graphBounds: bounds }, null, 2));
});

test('inspected history follows new rounds and preserves manual camera controls', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  await inspectAgent(page);
  const history = page.getByRole('img', { name: 'Local history view graph' });
  for (let round = 1; round <= 5; round++) {
    await page.getByRole('button', { name: 'Advance one round' }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const followed = await history.screenshot({ path: `${artifacts}/history-round3-auto.png`, animations: 'disabled' });
  await page.screenshot({ path: `${artifacts}/inspector-round3.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Fit graph to view', exact: true }).nth(1).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const fitted = await history.screenshot({ path: `${artifacts}/history-round3-fit.png`, animations: 'disabled' });
  const compareInk = async (left: Buffer, right: Buffer) => history.evaluate(async (element, encoded) => {
    const host = element.getBoundingClientRect();
    const controls = element.parentElement!.querySelector('.graph-tools')!.getBoundingClientRect();
    const decode = async (source: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [a, b] = await Promise.all([decode(encoded.left), decode(encoded.right)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('History viewport changed during camera comparison.');
    const mask = (image: typeof a) => {
      const result = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const cssX = host.x + x * host.width / image.width;
        const cssY = host.y + y * host.height / image.height;
        // The toolbar overlaps the canvas; its hover/focus colour is not graph geometry.
        if (cssX >= controls.left - 2 && cssX <= controls.right + 2 && cssY >= controls.top - 2 && cssY <= controls.bottom + 2) continue;
        const index = y * image.width + x, rgba = index * 4;
        result[index] = Math.min(image.pixels[rgba], image.pixels[rgba + 1], image.pixels[rgba + 2]) < 170 ? 1 : 0;
      }
      return result;
    };
    const ma = mask(a), mb = mask(b);
    const unmatched = (source: Uint8Array, target: Uint8Array) => {
      let total = 0, missing = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        if (!source[y * a.width + x]) continue;
        total++;
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < a.width && ny >= 0 && ny < a.height && target[ny * a.width + nx]) { found = true; break; }
        }
        if (!found) missing++;
      }
      return { total, missing };
    };
    const forward = unmatched(ma, mb), reverse = unmatched(mb, ma);
    return { forward, reverse, unmatchedRatio: (forward.missing + reverse.missing) / Math.max(1, forward.total + reverse.total) };
  }, { left: left.toString('base64'), right: right.toString('base64') });
  const camera = await compareInk(followed, fitted);
  // A 1px matching radius tolerates subpixel rasterisation; larger camera changes fail.
  expect(camera.unmatchedRatio, 'Automatic history framing must match explicit Fit within one pixel.').toBeLessThanOrEqual(0.01);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).nth(1).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const zoomed = await history.screenshot({ animations: 'disabled' });
  const negativeControl = await compareInk(fitted, zoomed);
  expect(negativeControl.unmatchedRatio, 'The camera check must detect a real 25% zoom change.').toBeGreaterThan(0.05);
  await page.getByRole('button', { name: 'Fit graph to view', exact: true }).nth(1).click();
  writeFileSync(`${artifacts}/history-camera-comparison.json`, JSON.stringify({ camera, negativeControl }, null, 2) + '\n');
  await expect(page.getByRole('button', { name: 'Play execution' })).toBeInViewport({ ratio: 1 });
  expect(errors).toEqual([]);
});
