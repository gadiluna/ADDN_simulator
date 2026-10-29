/// <reference lib="webworker" />
import type { EngineRequest, EngineResponse, Scenario, Snapshot } from './types';

interface ExactModule {
  ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): number;
  UTF8ToString(pointer: number): string;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPU8: Uint8Array;
}

let modulePromise: Promise<ExactModule> | undefined;
let handle = 0;

async function getEngine(): Promise<ExactModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL(`${import.meta.env.BASE_URL}engine.mjs`, self.location.origin).href;
      const factory = (await import(/* @vite-ignore */ url)).default;
      return await factory({ locateFile: (path: string) => new URL(path, url).href });
    })().catch((error: unknown) => {
      modulePromise = undefined;
      throw new Error(`The exact WebAssembly engine could not be loaded. Build the browser engine first (see simulator/README.md), then reload this page. ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return modulePromise;
}

function lastError(engine: ExactModule): string {
  const ptr = engine.ccall('sim_last_error', 'number', [], []);
  return ptr ? engine.UTF8ToString(ptr) : 'The exact engine rejected this operation.';
}

function snapshot(engine: ExactModule): Snapshot {
  const ptr = engine.ccall('sim_snapshot', 'number', ['number'], [handle]);
  if (!ptr) throw new Error(lastError(engine));
  try { return JSON.parse(engine.UTF8ToString(ptr)) as Snapshot; }
  finally { engine.ccall('sim_free_string', null, ['number'], [ptr]); }
}

function createRun(engine: ExactModule, scenario: Scenario): number {
  // ccall's string conversion uses the fixed Wasm stack; scenarios can exceed it.
  // The interactive simulator implements §4.1, also for legacy sharp networks.
  const bytes = new TextEncoder().encode(JSON.stringify({ ...scenario, variant: 'core' }));
  const pointer = engine._malloc(bytes.byteLength + 1);
  if (!pointer) throw new Error('Not enough memory to load this scenario.');
  try {
    // malloc may grow memory, so read the refreshed heap view after allocating.
    engine.HEAPU8.set(bytes, pointer);
    engine.HEAPU8[pointer + bytes.byteLength] = 0;
    return engine.ccall('sim_create', 'number', ['number'], [pointer]);
  } finally { engine._free(pointer); }
}

function destroyRun(engine: ExactModule): void {
  const previousHandle = handle;
  handle = 0;
  if (previousHandle) engine.ccall('sim_destroy', null, ['number'], [previousHandle]);
}

// Serialize requests: Emscripten initialization is asynchronous and one handle owns the run.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const engine = await getEngine();
      if (request.command === 'dispose') {
        destroyRun(engine);
        self.postMessage({ id: request.id, ok: true } satisfies EngineResponse);
        return;
      }
      if (request.command === 'load') {
        destroyRun(engine);
        handle = createRun(engine, request.scenario);
        if (!handle) throw new Error(lastError(engine));
      } else {
        if (!handle) throw new Error('Load a scenario before advancing a round.');
        const result = engine.ccall('sim_step', 'number', ['number'], [handle]);
        if (result < 0) throw new Error(lastError(engine));
      }
      self.postMessage({ id: request.id, ok: true, snapshot: snapshot(engine) } satisfies EngineResponse);
    } catch (error) {
      self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies EngineResponse);
    }
  });
};
