#!/usr/bin/env node
// Capture the real presentation UI, then encode portable H.264 slide clips.
// Usage: node scripts/record-presentation.mjs [http://127.0.0.1:4180/] [lemma-01]
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '../presentation');
const output = resolve(root, 'recordings');
const base = process.argv[2] ?? 'http://127.0.0.1:4180/';
const requested = process.argv[3];
const data = JSON.parse(await readFile(resolve(web, 'public/presentation/examples.json'), 'utf8'));
const examples = data.examples.filter(example => !requested || requested.split(',').includes(example.id));
if (!examples.length) throw new Error(`Unknown illustration ${requested}`);
await mkdir(resolve(output, '.raw'), { recursive: true });
await mkdir(resolve(output, 'stills'), { recursive: true });

function command(program, args) {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept() : reject(new Error(`${program}: ${error}`)));
  });
}
function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  // Sequential capture avoids background-tab throttling and video frame loss.
  for (const example of examples) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: resolve(output, '.raw'), size: { width: 1920, height: 1080 } } });
    const created = performance.now();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(base);
    url.searchParams.set('presentation', '1');
    url.searchParams.set('lemma', example.id);
    url.searchParams.set('recording', '1');
    await page.goto(url.href);
    const stage = page.getByTestId('presentation-stage');
    await stage.waitFor();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.mouse.move(1919, 1079);
    await page.waitForTimeout(250);
    const offset = (performance.now() - created) / 1000;
    const captions = [];
    let elapsed = 0;
    for (const [index, frame] of example.frames.entries()) {
      const frameStarted = performance.now();
      if (index) await page.keyboard.press('ArrowRight');
      await page.waitForFunction(expected => document.querySelector('[data-testid="presentation-stage"]')?.getAttribute('data-frame') === String(expected), index);
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(output, 'stills', `${example.id}-${String(index + 1).padStart(2, '0')}.png`) });
      captions.push(`${index + 1}\n${stamp(elapsed)} --> ${stamp(elapsed + frame.duration)}\n${frame.caption}\n`);
      elapsed += frame.duration;
      await page.waitForTimeout(Math.max(0, frame.duration * 1000 - (performance.now() - frameStarted)));
    }
    if (errors.length) throw new Error(`${example.id}: ${errors.join('; ')}`);
    const video = page.video();
    await context.close();
    const raw = await video.path();
    const file = resolve(output, `${example.id}.mp4`);
    await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(offset), '-i', raw, '-t', String(elapsed), '-an', '-vf', 'fps=30,tpad=stop_mode=clone:stop_duration=1,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart', file]);
    await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', resolve(output, 'stills', `${example.id}-01.png`), '-frames:v', '1', '-q:v', '3', resolve(output, `${example.id}.jpg`)]);
    await writeFile(resolve(output, `${example.id}.srt`), captions.join('\n'));
    await rm(raw);
    results.push({ id: example.id, file: `${example.id}.mp4`, title: example.title, seconds: elapsed, width: 1920, height: 1080, caption_file: `${example.id}.srt`, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
    console.log(`RECORDED ${example.id}: ${elapsed}s, 1920×1080`);
  }
} finally {
  await browser.close();
}
const manifestPath = resolve(output, 'manifest.json');
let previous = [];
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')).clips; } catch {}
const combined = [...previous.filter(clip => !results.some(result => result.id === clip.id)), ...results]
  .sort((a, b) => data.examples.findIndex(e => e.id === a.id) - data.examples.findIndex(e => e.id === b.id));
await writeFile(manifestPath, JSON.stringify({ schema_version: 1, paper_sha256: data.paper_sha256, format: 'H.264 / MP4, 30 fps, no audio, English captions burned into the image', clips: combined }, null, 2) + '\n');
console.log(`Saved ${results.length} clips to ${output}`);
