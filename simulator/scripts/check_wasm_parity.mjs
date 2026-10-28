#!/usr/bin/env node
// Compare every snapshot of the shared C engine across native and Wasm builds.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const sim = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engine = process.env.COUNTING_NATIVE_ENGINE || resolve(sim, 'c/build/counting');
const modulePath = process.env.COUNTING_WASM_MODULE || resolve(sim, 'c/build-wasm/engine.mjs');
const factory = (await import(pathToFileURL(modulePath))).default;
const module = await factory({
  wasmBinary: readFileSync(modulePath.replace(/\.mjs$/, '.wasm')),
  print: () => {},
});
let paths = process.argv.slice(2);
if (!paths.length) {
  const fixtures = resolve(sim, 'tests/fixtures');
  paths = existsSync(fixtures) ? readdirSync(fixtures).filter(p => p.endsWith('.json')).map(p => resolve(fixtures, p)) : [];
}
if (!paths.length) throw new Error('Provide scenario JSON files, or export tests/fixtures first.');

function snapshot(handle) {
  const pointer = module.ccall('sim_snapshot', 'number', ['number'], [handle]);
  if (!pointer) throw new Error('sim_snapshot failed');
  try { return JSON.parse(module.UTF8ToString(pointer)); }
  finally { module.ccall('sim_free_string', null, ['number'], [pointer]); }
}

function createRun(scenario) {
  // Scenario JSON can exceed Wasm's fixed stack used by ccall string arguments.
  const bytes = new TextEncoder().encode(JSON.stringify(scenario));
  const pointer = module._malloc(bytes.byteLength + 1);
  if (!pointer) throw new Error('Not enough memory to load this scenario.');
  try {
    // Allocation may grow memory and replace HEAPU8.
    module.HEAPU8.set(bytes, pointer);
    module.HEAPU8[pointer + bytes.byteLength] = 0;
    return module.ccall('sim_create', 'number', ['number'], [pointer]);
  } finally { module._free(pointer); }
}

for (const path of paths) {
  const scenario = JSON.parse(readFileSync(path, 'utf8'));
  const native = spawnSync(engine, ['run', resolve(path), '--trace'], {encoding:'utf8', maxBuffer:256*1024*1024});
  assert.equal(native.status, 0, native.stderr || native.stdout);
  const expected = JSON.parse(native.stdout);
  const handle = createRun(scenario);
  if (!handle) throw new Error(module.UTF8ToString(module.ccall('sim_last_error', 'number', [], [])));
  const snapshots = [];
  try {
    snapshots.push(snapshot(handle));
    for (let t=0; !snapshots.at(-1).complete && t<2*scenario.n; t++) {
      const status = module.ccall('sim_step', 'number', ['number'], [handle]);
      if (status < 0) throw new Error(`sim_step returned ${status}`);
      const state = snapshot(handle);
      assert.ok(state.round > snapshots.at(-1).round, 'Step made no progress');
      snapshots.push(state);
    }
    assert.deepEqual(snapshots, expected.snapshots, `Native/Wasm mismatch: ${path}`);
    assert.ok(snapshots.at(-1).complete, 'Execution did not terminate');
  } finally { module.ccall('sim_destroy', null, ['number'], [handle]); }
  console.log(`PASS ${path} (${snapshots.length-1} rounds)`);
}
console.log(`Native/Wasm parity: ${paths.length} scenarios passed.`);
