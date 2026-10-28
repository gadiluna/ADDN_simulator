import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { presets, randomScenario } from '../src/scenarios';
import type { EngineRequest, EngineResponse, Scenario } from '../src/types';

const engineBuilt = existsSync(new URL('../public/engine.mjs', import.meta.url)) && existsSync(new URL('../public/engine.wasm', import.meta.url));

async function runWorker(page: Page, requests: EngineRequest[]): Promise<EngineResponse[]> {
  await page.goto('/');
  return page.evaluate(async requests => {
    const worker = new Worker('/src/engine.worker.ts', { type: 'module' });
    const responses: EngineResponse[] = [];
    try {
      for (const request of requests) {
        responses.push(await new Promise<EngineResponse>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = event => reject(new Error(event.message));
          worker.postMessage(request);
        }));
      }
      return responses;
    } finally { worker.terminate(); }
  }, requests);
}

test('the exported heap view stays current when a scenario allocation grows Wasm memory', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  await page.goto('/');
  const result = await page.evaluate(async scenario => {
    const moduleURL = new URL('/engine.mjs', location.href).href;
    const factory = (await import(/* @vite-ignore */ moduleURL)).default;
    const engine = await factory();
    const previousHeap: Uint8Array = engine.HEAPU8;
    const previousBytes = previousHeap.byteLength;
    // Force growth with a bounded allocation, independent of current free space.
    if (previousBytes > 64 * 1024 * 1024) throw new Error('Unexpected initial Wasm memory size.');
    const pointer = engine._malloc(previousBytes + 1);
    if (!pointer) throw new Error('The memory-growth test allocation failed.');
    let handle = 0;
    let snapshotPointer = 0;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(scenario));
      engine.HEAPU8.set(bytes, pointer);
      engine.HEAPU8[pointer + bytes.byteLength] = 0;
      handle = engine.ccall('sim_create', 'number', ['number'], [pointer]);
      if (!handle) throw new Error(engine.UTF8ToString(engine.ccall('sim_last_error', 'number', [], [])));
      snapshotPointer = engine.ccall('sim_snapshot', 'number', ['number'], [handle]);
      return {
        viewChanged: engine.HEAPU8 !== previousHeap,
        memoryGrew: engine.HEAPU8.byteLength > previousBytes,
        currentBytes: engine.HEAPU8.byteLength,
        snapshot: JSON.parse(engine.UTF8ToString(snapshotPointer)),
      };
    } finally {
      if (snapshotPointer) engine.ccall('sim_free_string', null, ['number'], [snapshotPointer]);
      if (handle) engine.ccall('sim_destroy', null, ['number'], [handle]);
      engine._free(pointer);
    }
  }, presets[3].scenario);
  expect(result).toMatchObject({ viewChanged: true, memoryGrew: true, snapshot: { n: 1, round: 0 } });
  expect(result.currentBytes).toBeLessThan(100 * 1024 * 1024);
});

test('the real worker loads and restarts a 128-agent scenario larger than the Wasm stack', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  // This seed reproduces the scenario that originally failed during sim_create.
  const scenario = randomScenario(128, '3219519529');
  expect(new TextEncoder().encode(JSON.stringify(scenario)).byteLength).toBeGreaterThan(3 * 1024 * 1024);
  const responses = await runWorker(page, [
    { id: 1, command: 'load', scenario },
    { id: 2, command: 'step' },
    { id: 3, command: 'load', scenario },
    { id: 4, command: 'step' },
    { id: 5, command: 'dispose' },
    { id: 6, command: 'step' },
  ]);
  for (const [index, round] of [0, 1, 0, 1].entries()) {
    expect(responses[index].ok, JSON.stringify(responses[index].ok ? { id: responses[index].id } : responses[index])).toBe(true);
    expect(responses[index]).toMatchObject({ id: index + 1, ok: true, snapshot: { n: 128, round } });
    const response = responses[index];
    if (response.ok) expect(response.snapshot?.agents).toHaveLength(128);
  }
  expect(responses[4]).toEqual({ id: 5, ok: true });
  expect(responses[5]).toEqual({ id: 6, ok: false, error: 'Load a scenario before advancing a round.' });
});

test('the worker reports an invalid replacement and can load a valid scenario afterward', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const scenario = presets[3].scenario;
  const invalid = { ...scenario, schema_version: 2 } as unknown as Scenario;
  const responses = await runWorker(page, [
    { id: 1, command: 'load', scenario },
    { id: 2, command: 'load', scenario: invalid },
    { id: 3, command: 'step' },
    { id: 4, command: 'load', scenario },
    { id: 5, command: 'step' },
    { id: 6, command: 'dispose' },
  ]);
  expect(responses[0]).toMatchObject({ id: 1, ok: true, snapshot: { round: 0 } });
  expect(responses[1]).toEqual({ id: 2, ok: false, error: 'schema_version must be 1' });
  expect(responses[2]).toEqual({ id: 3, ok: false, error: 'Load a scenario before advancing a round.' });
  expect(responses[3]).toMatchObject({ id: 4, ok: true, snapshot: { round: 0 } });
  expect(responses[4]).toMatchObject({ id: 5, ok: true, snapshot: { round: 1, complete: true } });
  expect(responses[5]).toEqual({ id: 6, ok: true });
});

test('a serialization failure clears the old handle and leaves the worker usable', async ({ page }) => {
  test.skip(!engineBuilt, 'Build the actual C/WebAssembly engine.');
  const scenario = presets[3].scenario;
  // Structured cloning accepts BigInt, but JSON serialization must reject it.
  const invalid = { ...scenario, seed: 1n } as unknown as Scenario;
  const responses = await runWorker(page, [
    { id: 1, command: 'load', scenario },
    { id: 2, command: 'load', scenario: invalid },
    { id: 3, command: 'step' },
    { id: 4, command: 'dispose' },
    { id: 5, command: 'load', scenario },
    { id: 6, command: 'step' },
    { id: 7, command: 'dispose' },
  ]);
  expect(responses[0]).toMatchObject({ id: 1, ok: true, snapshot: { round: 0 } });
  expect(responses[1]).toMatchObject({ id: 2, ok: false, error: expect.stringMatching(/BigInt/i) });
  expect(responses[2]).toEqual({ id: 3, ok: false, error: 'Load a scenario before advancing a round.' });
  expect(responses[3]).toEqual({ id: 4, ok: true });
  expect(responses[4]).toMatchObject({ id: 5, ok: true, snapshot: { round: 0 } });
  expect(responses[5]).toMatchObject({ id: 6, ok: true, snapshot: { round: 1, complete: true } });
  expect(responses[6]).toEqual({ id: 7, ok: true });
});
