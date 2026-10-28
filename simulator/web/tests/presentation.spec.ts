import { expect, test } from '@playwright/test';
import type { PresentationCollection } from '../src/presentation-types';

test('all lemmas have navigable illustrations and the step URL is reproducible', async ({ page }) => {
  await page.goto('/?presentation=1');
  const stage = page.getByTestId('presentation-stage');
  await expect(stage).toHaveAttribute('data-example', 'lemma-01');
  const picker = page.getByRole('combobox', { name: 'Choose lemma' });
  for (let number = 1; number <= 16; number++) {
    const id = `lemma-${String(number).padStart(2, '0')}`;
    await picker.selectOption(id);
    await expect(stage).toHaveAttribute('data-example', id);
    await expect(stage).toHaveAttribute('data-frame', '0');
    await expect(stage.getByRole('heading', { level: 1 })).not.toBeEmpty();
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(stage).toHaveAttribute('data-frame', '1');
    await expect(page).toHaveURL(new RegExp(`lemma=${id}&frame=1`));
  }
  await page.reload();
  await expect(stage).toHaveAttribute('data-example', 'lemma-16');
  await expect(stage).toHaveAttribute('data-frame', '1');
  await page.getByRole('button', { name: 'Restart illustration' }).click();
  await expect(stage).toHaveAttribute('data-frame', '0');
  await page.getByText('Proof connection and checked facts', { exact: true }).click();
  await expect(page.locator('.presentation-notes[open] li').first()).toBeVisible();
});

test('recording mode hides controls, fills 1080p, and keeps all frame content inside the slide', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const response = await request.get('/presentation/examples.json');
  expect(response.ok()).toBeTruthy();
  const data = await response.json() as PresentationCollection;
  for (const example of data.examples) {
    await page.goto(`/?presentation=1&recording=1&lemma=${example.id}`);
    const stage = page.getByTestId('presentation-stage');
    await expect(stage).toHaveAttribute('data-example', example.id);
    await expect(page.getByRole('navigation', { name: 'Presentation controls' })).toHaveCount(0);
    expect(await stage.boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    for (let frame = 0; frame < example.frames.length; frame++) {
      await expect(stage).toHaveAttribute('data-frame', String(frame));
      await expect(page.locator('.presentation-caption')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.presentation-stage-footer')).toBeInViewport({ ratio: 1 });
      const overflow = await stage.evaluate(element => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll('h1,h2,figcaption,.presentation-caption p,.presentation-metrics dt,.presentation-metrics dd,.presentation-network-note,svg text')].some(child => {
          const bounds = child.getBoundingClientRect();
          return bounds.x < box.x || bounds.right > box.right + 1 || bounds.y < box.y || bounds.bottom > box.bottom + 1;
        });
      });
      expect(overflow, `${example.id}, frame ${frame}`).toBeFalsy();
      if (frame < example.frames.length - 1) await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Home');
    await expect(stage).toHaveAttribute('data-frame', '0');
  }
});

test('playback advances by the authored duration and scenario downloads preserve the input', async ({ page, request }) => {
  const data = await (await request.get('/presentation/examples.json')).json() as PresentationCollection;
  const example = data.examples.find(item => item.scenario);
  expect(example).toBeDefined();
  await page.clock.install();
  await page.goto(`/?presentation=1&lemma=${example!.id}`);
  await expect(page.getByTestId('presentation-stage')).toHaveAttribute('data-frame', '0');
  await page.getByRole('button', { name: 'Play illustration', exact: true }).click();
  await page.clock.fastForward(example!.frames[0].duration * 1000 + 10);
  await expect(page.getByTestId('presentation-stage')).toHaveAttribute('data-frame', '1');
  await page.getByRole('button', { name: 'Pause illustration', exact: true }).click();
  await page.clock.fastForward(20_000);
  await expect(page.getByTestId('presentation-stage')).toHaveAttribute('data-frame', '1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download simulator scenario' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${example!.id}.json`);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(example!.scenario);
});

test('missing illustration data produces a useful error', async ({ page }) => {
  await page.route('**/presentation/examples.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/?presentation=1');
  await expect(page.getByRole('alert')).toHaveText('Examples could not be loaded (404).');
});

test('refinement and message edges between the same classes remain separately visible', async ({ page }) => {
  await page.goto('/?presentation=1&recording=1&lemma=lemma-13&frame=1');
  await expect(page.getByTestId('presentation-stage')).toHaveAttribute('data-example', 'lemma-13');
  const edges = page.locator('.presentation-edge[data-source="N"][data-target="B"]');
  await expect(edges).toHaveCount(2);
  const ancestry = edges.filter({ has: page.locator('path[stroke="#233247"]') });
  const message = edges.filter({ has: page.locator('path[stroke="#bb4f48"]') });
  await expect(ancestry).toHaveAttribute('data-kind', 'black');
  await expect(message).toHaveAttribute('data-kind', 'red');
  const paths = await edges.locator('path').evaluateAll(elements => elements.map(element => element.getAttribute('d')));
  expect(new Set(paths).size).toBe(2);
  await expect(ancestry.locator('path')).toBeVisible();
  await expect(message.locator('path')).toBeVisible();
});
