#!/usr/bin/env node
/**
 * matchscreen — one frame of the original composed by the library, against VICE's pixels.
 *
 * The acceptance tool of M1. It takes a frame recorded by `tools/mkscreen.py`
 * (memory at the top of the playfield, the VIC-II registers, and **every
 * store** to the VIC-II and the sprite pointers during the frame with its
 * raster line and cycle), lets **svision** compose it — `C64TextRAM` with
 * the fine scroll, the 38-column window and splits inside a line, then
 * `C64Sprites` with the multiplexer's stores, then the border — and compares
 * it **pixel by pixel** with the picture VICE drew of the same frame.
 *
 * Colours are compared as indices, not RGB (VICE and the library have their
 * own palettes; the VICE palette is found from its `.vpl` files).
 *
 * The store of a register lands on a raster line and a cycle; the library
 * takes a pixel line and x. The conversion is two numbers measured here, not
 * assumed: `--cycle0` (the cycle whose store first shows at x 0) and
 * `--sprite-cycle` (from which cycle a sprite store counts from the next
 * line). `--fit` tries the range and reports the best.
 *
 *     tools/matchscreen.mjs --data build/screen3000.json
 *     tools/matchscreen.mjs --data data/screen.json --fit
 *     tools/matchscreen.mjs --dir build/screens      # every frame of a sweep (mkscreen.py --sweep)
 */
import '../app/svision/tools/nodeEnv.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { decodePNG, encodeRGBAPNG } from '../app/svision/tools/retro/png.mjs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { C64TextRAM } = await import('../app/svision/js/platform/canvas2D/c64/c64TextRAM.js');
const { C64Color } = await import('../app/svision/js/platform/canvas2D/c64/c64Color.js');
const { ScreenLoader } = await import('../app/screenLoader.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
if (opt('--dir')) {
  // one process per frame, the same tool, and the sum
  const dir = opt('--dir');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
  let frames = 0, diffs = 0, stores = 0;
  for (const f of files) {
    const path = `${dir}/${f}`;
    let out;
    try { out = execFileSync(process.execPath, [new URL(import.meta.url).pathname, '--data', path], {encoding: 'utf8'}); }
    catch (e) { out = e.stdout; }
    const n = +(/differences: (\d+)/.exec(out) || [0, -1])[1];
    const w = JSON.parse(readFileSync(path, 'utf8')).writes.length;
    console.log(`${f.padEnd(14)} stores ${String(w).padStart(4)}   differences ${n}`);
    frames++; diffs += n; stores += w;
  }
  console.log(`\n${frames} frames, ${frames*64000} pixels, ${stores} stores, ${diffs} differences`);
  process.exit(diffs ? 1 : 0);
}
const dataPath = opt('--data', 'data/screen.json');
const verbose = args.includes('--verbose');
const WIDTH = 320, HEIGHT = 200;
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const shotPath = opt('--shot', data.screenshot);

const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const loader = new ScreenLoader(data);

/** the frame composed by the application's own loader and the library */
function compose(cycle0, spriteCycle) {
  const frame = loader.build({cycle0, spriteCycle});
  const pixels = new Uint32Array(WIDTH*HEIGHT);
  frame.textRAM.paint32(pixels, frame.font, LE, {cursor: false, border: false});
  frame.sprites.paint32(pixels, LE);
  frame.textRAM.paintBorder32(pixels, LE);
  const lookup = C64TextRAM.lookup(LE);
  const index = new Map(Array.from(lookup, (v, i) => [v, i]));
  return Uint8Array.from(pixels, (p) => index.get(p));
}

// ------------------------------------------------------------------- VICE
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const shot = decodePNG(readFileSync(shotPath));
const vplDir = '/usr/share/vice/C64';
const palettes = [{name: 'C64Color', colors: Array.from({length: 16}, (_, i) => {
  const h = C64Color.color(i).replace('#', ''); return [0, 2, 4].map(o => parseInt(h.slice(o, o+2), 16)); })}]
  .concat(readdirSync(vplDir).filter(f => f.endsWith('.vpl')).map(f => ({name: f,
    colors: readFileSync(`${vplDir}/${f}`, 'utf8').split('\n').map(l => l.replace(/#.*$/, '').trim())
      .filter(Boolean).map(l => l.split(/\s+/).slice(0, 3).map(v => parseInt(v, 16))).slice(0, 16)})))
  .filter(p => p.colors.length === 16 && p.colors.every(c => c.every(Number.isInteger)));
let shotIdx = null, palName = null;
for (const pal of palettes) {
  const map = new Map(pal.colors.map((c, i) => [hex(...c), i]));
  const out = new Uint8Array(shot.width*shot.height);
  let ok = true;
  for (let i = 0; i < out.length && ok; i++) {
    const v = map.get(hex(shot.rgba[i*4], shot.rgba[i*4+1], shot.rgba[i*4+2]));
    if (v === undefined) ok = false; else out[i] = v;
  }
  if (ok) { shotIdx = out; palName = pal.name; break; }
}
if (!shotIdx) { console.error('no palette maps the picture'); process.exit(2); }

function window(ours) {
  let best = null;
  for (let dy = 25; dy <= 45; dy++) for (let dx = 24; dx <= 40; dx++) {
    if (dx+WIDTH > shot.width || dy+HEIGHT > shot.height) continue;
    let bad = 0;
    for (let y = 0; y < HEIGHT; y += 2) for (let x = 0; x < WIDTH; x += 2)
      if (shotIdx[(dy+y)*shot.width+dx+x] !== ours[y*WIDTH+x]) bad++;
    if (!best || bad < best.bad) best = {dx, dy, bad};
  }
  return best;
}
function diff(ours, win) {
  const bad = [];
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++)
    if (ours[y*WIDTH+x] !== shotIdx[(win.dy+y)*shot.width+win.dx+x]) bad.push([x, y]);
  return bad;
}

let cycle0 = +opt('--cycle0', ScreenLoader.CYCLE0), spriteCycle = +opt('--sprite-cycle', ScreenLoader.SPRITE_CYCLE);
if (args.includes('--fit')) {
  let best = null;
  for (let c0 = 8; c0 <= 24; c0++) for (let sc = 0; sc <= 64; sc += 2) {
    const ours = compose(c0, sc);
    const n = diff(ours, window(ours)).length;
    if (!best || n < best.n) best = {c0, sc, n};
  }
  console.log(`fit: cycle0 ${best.c0}, sprite-cycle ${best.sc}: ${best.n} differences`);
  cycle0 = best.c0; spriteCycle = best.sc;
}
const ours = compose(cycle0, spriteCycle);
const win = window(ours);
const bad = diff(ours, win);
console.log(`frame:   ${dataPath} (${data.source})`);
console.log(`picture: ${shotPath} ${shot.width}x${shot.height}, palette ${palName}, window +${win.dx}+${win.dy}`);
console.log(`stores:  ${data.writes.length} during the frame; cycle0 ${cycle0}, sprite-cycle ${spriteCycle}`);
console.log(`\nchecks: ${WIDTH*HEIGHT}   differences: ${bad.length}`);
if (bad.length && verbose) {
  const cells = new Map();
  for (const [x, y] of bad) { const k = `${x>>3},${y>>3}`; cells.set(k, (cells.get(k) || 0)+1); }
  console.log('worst cells (column,row -> pixels):');
  for (const [k, n] of [...cells].sort((a, b) => b[1]-a[1]).slice(0, 20)) console.log(`  ${k}  ${n}`);
  const rows = new Map();
  for (const [x, y] of bad) rows.set(y, (rows.get(y) || 0)+1);
  console.log('lines:', [...rows].sort((a, b) => a[0]-b[0]).slice(0, 40).map(([y, n]) => `${y}:${n}`).join(' '));
}
if (opt('--png')) {
  const pal = Array.from({length: 16}, (_, i) => { const h = C64Color.color(i).replace('#', '');
    return [0, 2, 4].map(o => parseInt(h.slice(o, o+2), 16)); });
  const rgba = new Uint8Array(WIDTH*HEIGHT*4);
  ours.forEach((c, i) => { rgba.set(pal[c], i*4); rgba[i*4+3] = 255; });
  writeFileSync(opt('--png'), encodeRGBAPNG(WIDTH, HEIGHT, rgba));
}
process.exit(bad.length ? 1 : 0);
