#!/usr/bin/env node
/**
 * regress — the fingerprint of a scripted game against yesterday's
 * (`METHODOLOGY.md`: regress, not match — no original here, only the
 * last build of the remake).
 *
 * The worker (`app/gameWorker.js`) runs headless under Node for a number of
 * ticks with a **scripted input** — a seeded random walk of joystick
 * segments as `tools/traceship.py` makes them, fire taps and holds, the
 * space bar — through READY, the level, deaths, the restart from the
 * checkpoint and, with a long enough run, the next level (R-052: the
 * generator is seeded, so the game is the same every time). The time is
 * the tick counter, never the clock. The fingerprint is taken from the
 * **video memory**, not the canvas: every 25th frame the screen RAM, the
 * colour RAM, the VIC registers and the sprite shapes are hashed, and the
 * events of the rules (`death`, `ready`, `checkpoint` …) are listed with
 * their frames. `tools/regress/reference.json` holds the last accepted
 * fingerprint; a difference is the exit code.
 *
 *     tools/regress.mjs                  # compare with the reference
 *     tools/regress.mjs --update         # accept today's fingerprint
 *     tools/regress.mjs --frames 6000 --seed 7 --level 1 --print
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const update = args.includes('--update');
const print = args.includes('--print');
const frames = +opt('--frames', 4000);
const seed = +opt('--seed', 0xC0DE);
const level = +opt('--level', 1);
const every = +opt('--every', 25);
const ref = new URL('./regress/reference.json', import.meta.url);

const source = readFileSync(new URL('../app/gameWorker.js', import.meta.url), 'utf8');
const scripts = ['levelScroll', 'sidPlayer', 'ship', 'enemies', 'levelCode', 'gameRules'].map(n => [n, readFileSync(new URL(`../app/${n}.js`, import.meta.url), 'utf8')]);
const data = {};
for (const n of ['levels', 'ship', 'sprites', 'enemies', 'texts', 'charsets', 'music']) { data[n] = JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8')); }
const panel = {screen: new Array(240).fill(0), color: new Array(240).fill(0)};
{
  const tpl = data.texts.panel.codes, colors = data.texts.panel.colors.values;
  const from = parseInt(data.texts.panel.screen.slice(1, 5), 16)-0xCC00-19*40;
  for (let i = 0; i < tpl.length; i++) { panel.screen[from+i] = tpl[i]; panel.color[from+i] = (tpl[i] < colors.length ? colors[tpl[i]] : 0) & 15; }
}

/** mulberry32: a seeded source for the script (METHODOLOGY: never Math.random) */
function seeded(s) {
  return function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** the segments (pressed bits, frames) as `traceship.make_script`: taps and holds of fire, taps of space */
function makeScript(s, total) {
  const rnd = seeded(s), UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, FIRE = 16, SPACE = 32;
  const pick = (a) => a[Math.floor(rnd()*a.length)];
  const int = (a, b) => a+Math.floor(rnd()*(b-a+1));
  const segs = [[0, 12]];
  let n = 12;
  while (n < total) {
    const r = rnd();
    let bits, len;
    if (r < 0.45) { bits = pick([0, UP, DOWN, LEFT, RIGHT, UP | LEFT, UP | RIGHT, DOWN | LEFT, DOWN | RIGHT]); len = int(3, 24); }
    else if (r < 0.75) { bits = pick([0, UP, DOWN, LEFT, RIGHT]) | FIRE; len = int(1, 4); }
    else if (r < 0.88) { bits = pick([0, UP, DOWN]) | FIRE; len = int(30, 160); }
    else if (r < 0.95) { bits = SPACE | pick([0, 0, LEFT, RIGHT]); len = int(1, 3); }
    else { bits = 0; len = int(8, 40); }
    segs.push([bits, len]);
    n += len;
  }
  return segs;
}

const out = [];
const sandbox = {postMessage: (m) => out.push(m), setTimeout, clearTimeout, Date, console, Uint8Array,
                 self: null, location: {search: ''}, importScripts: () => {}};
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const [name, src] of scripts) { vm.runInContext(src, sandbox, {filename: name+'.js'}); }
vm.runInContext(source, sandbox, {filename: 'gameWorker.js'});
sandbox.onmessage({data: {message: 'init', seed, level, levels: data.levels.levels, panel, ship: data.ship, sprites: data.sprites, enemies: data.enemies, charsets: data.charsets, music: data.music}});

const segs = makeScript(seed, frames);
let seg = 0, left = segs[0][1];
const hashes = [], events = [];
// ★ M6: the sound goes into the fingerprint too — every write into the SID of the whole run, in order
const sidHash = createHash('sha1');
let sidWrites = 0;
let last = null;
for (let f = 1; f <= frames; f++) {
  const bits = segs[seg][0];
  sandbox.onmessage({data: {message: 'input', joystick: (~bits) & 0x1F | 0x60, space: !!(bits & 32)}});
  if (--left <= 0 && seg < segs.length-1) { seg++; left = segs[seg][1]; }
  sandbox.tick();
  last = out[out.length-1];
  for (const e of last.events || []) { events.push(`${e.kind}@${e.frame}${e.a !== undefined ? '/'+e.a : ''}`); }
  for (const w of last.sid || []) { sidHash.update(Buffer.from([w[1], w[2]])); sidWrites++; }
  if (f % every === 0 || last.over) {
    const h = createHash('sha1');
    h.update(Buffer.from(last.screen)); h.update(Buffer.from(last.color)); h.update(Buffer.from(last.vic)); h.update(Buffer.from(last.sprites));
    hashes.push(`${f}:${last.mode[0]}${last.level}:${h.digest('hex').slice(0, 12)}`);
  }
  if (last.over) { break; }
}
const fingerprint = {seed, level, frames, every, ticks: last.frame, ended: last.state, score: last.score, lives: last.lives, levelReached: last.level, events, hashes,
                     sidWrites, sidHash: sidHash.digest('hex').slice(0, 12)};
if (print) { console.log(JSON.stringify(fingerprint, null, 1)); }
if (update || !existsSync(ref)) {
  mkdirSync(new URL('./regress/', import.meta.url), {recursive: true});
  writeFileSync(ref, JSON.stringify(fingerprint, null, 1)+'\n');
  console.log(`regress: reference written (${fingerprint.ticks} ticks, ${events.length} events, ${hashes.length} hashes) -> tools/regress/reference.json`);
  process.exit(0);
}
const want = JSON.parse(readFileSync(ref, 'utf8'));
let diffs = 0;
const same = (k) => JSON.stringify(fingerprint[k]) === JSON.stringify(want[k]);
for (const k of ['seed', 'level', 'frames', 'every']) { if (!same(k)) { console.log(`  the reference was made with ${k} = ${want[k]}, this run with ${fingerprint[k]}`); diffs++; } }
for (const k of ['ticks', 'ended', 'score', 'lives', 'levelReached']) { if (!same(k)) { console.log(`  ${k}: ${fingerprint[k]} (reference ${want[k]})`); diffs++; } }
// (a reference from before M6 has no sound in it: nothing to compare — `--update` adds it)
for (const k of ['sidWrites', 'sidHash']) { if (want[k] !== undefined && !same(k)) { console.log(`  the sound differs: ${k} ${fingerprint[k]} (reference ${want[k]})`); diffs++; } }
const n = Math.max(events.length, want.events.length);
for (let i = 0; i < n; i++) { if (events[i] !== want.events[i]) { console.log(`  event ${i}: ${events[i]} (reference ${want.events[i]})`); diffs++; if (diffs > 20) break; } }
const first = hashes.findIndex((h, i) => h !== want.hashes[i]);
if (first >= 0 || hashes.length !== want.hashes.length) { console.log(`  the picture differs from frame ${first >= 0 ? hashes[first].split(':')[0] : '?'} on (${hashes.length} hashes, reference ${want.hashes.length})`); diffs++; }
console.log(`regress: ${fingerprint.ticks} ticks, ${events.length} events, ${hashes.length} hashes, ${sidWrites} SID writes, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
