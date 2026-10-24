#!/usr/bin/env node
/**
 * runworker — the worker's protocol without a browser.
 *
 * The worker is a classic script (`importScripts`), loaded here through
 * `app/svision/tools/classicScript.cjs`'s sandbox the way the game runs it:
 * `init` with a seed, `start`, frames, `input`, `random`, `stop` — checking
 * that the answers are right, that the clock gives whole frames, and that
 * **the same seed gives the same sequence** (a regression has nothing to
 * hold a fingerprint on without it, `app/WORKER-PROTOCOL.md`). From M5 the
 * game begins in READY (`mode` 'ready'), fire starts the level after the
 * countdown, and the ticks are driven by hand (`tick()` of the sandbox) so
 * that the checks do not wait on the clock.
 *
 *     tools/runworker.mjs [--frames 25]
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const args = process.argv.slice(2);
const frames = +(args[args.indexOf('--frames')+1] || 25) || 25;
const source = readFileSync(new URL('../app/gameWorker.js', import.meta.url), 'utf8');
const scripts = ['levelScroll', 'sidPlayer', 'ship', 'enemies', 'levelCode', 'gameRules'].map(n => [n, readFileSync(new URL(`../app/${n}.js`, import.meta.url), 'utf8')]);
const enemiesData = JSON.parse(readFileSync(new URL('../data/enemies.json', import.meta.url), 'utf8'));
const levels = JSON.parse(readFileSync(new URL('../data/levels.json', import.meta.url), 'utf8'));
const shipData = JSON.parse(readFileSync(new URL('../data/ship.json', import.meta.url), 'utf8'));
const spritesData = JSON.parse(readFileSync(new URL('../data/sprites.json', import.meta.url), 'utf8'));
const texts = JSON.parse(readFileSync(new URL('../data/texts.json', import.meta.url), 'utf8'));
const charsets = JSON.parse(readFileSync(new URL('../data/charsets.json', import.meta.url), 'utf8'));
const music = JSON.parse(readFileSync(new URL('../data/music.json', import.meta.url), 'utf8'));
// the panel as app/levelLoader.js composes it (the template of $17BF)
const panel = {screen: new Array(240).fill(0), color: new Array(240).fill(0)};
{
  const tpl = texts.panel.codes, colors = texts.panel.colors.values;
  const from = parseInt(texts.panel.screen.slice(1, 5), 16)-0xCC00-19*40;
  for (let i = 0; i < tpl.length; i++) { panel.screen[from+i] = tpl[i]; panel.color[from+i] = (tpl[i] < colors.length ? colors[tpl[i]] : 0) & 15; }
}

let checks = 0, differences = 0;
function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    differences++;
    console.log(`  DIFF ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** a worker in a sandbox: its `postMessage` collects, its `onmessage` is called, its `tick` is ours to call */
function makeWorker() {
  const out = [];
  const sandbox = {postMessage: (m) => out.push(m), setTimeout, clearTimeout, Date, console, Uint8Array,
                   self: null, location: {search: ''}, importScripts: () => {}};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [name, src] of scripts) { vm.runInContext(src, sandbox, {filename: name+'.js'}); }
  vm.runInContext(source, sandbox, {filename: 'gameWorker.js'});
  return {send: (m) => sandbox.onmessage({data: m}), tick: () => sandbox.tick(), out,
          frames: () => out.filter(m => m.message === 'frame'), last: () => { const f = out.filter(m => m.message === 'frame'); return f[f.length-1]; }};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- init, random, determinism
const a = makeWorker(), b = makeWorker(), c = makeWorker();
a.send({message: 'init', seed: 12345});
b.send({message: 'init', seed: 12345});
c.send({message: 'init', seed: 54321});
check('init answers ready with the seed', a.out[0], {message: 'ready', seed: 12345, level: 0});
const draw = (w) => { for (let i = 0; i < 16; i++) w.send({message: 'random'}); return w.out.filter(m => m.message === 'random').map(m => m.value); };
const ra = draw(a), rb = draw(b), rc = draw(c);
check('random answers 16 times', ra.length, 16);
check('random is a byte', ra.every(v => Number.isInteger(v) && v >= 0 && v < 256), true);
check('the same seed gives the same sequence', ra, rb);
check('another seed gives another sequence', JSON.stringify(ra) !== JSON.stringify(rc), true);

// --- the clock: whole frames, numbered from 1, the input carried
const w = makeWorker();
w.send({message: 'init', seed: 7});
w.send({message: 'input', joystick: 0x6F, space: true});
w.send({message: 'start'});
await sleep(frames*20 + 10);
w.send({message: 'stop'});
const got = w.frames();
check('the clock ticks (about 50 Hz)', got.length >= frames-2 && got.length <= frames+2, true);
check('frames are numbered 1, 2, 3, …', got.map(m => m.frame), got.map((_, i) => i+1));
check('a frame carries the joystick byte and the space bar', [got[0].joystick, got[0].space], [0x6F, true]);
const stopped = got.length;
await sleep(100);
check('stop stops the clock', w.frames().length, stopped);

// --- the game: begun in READY, a frame a tick, carried in the frame
const withGame = (level) => ({message: 'init', seed: 1, level, levels: levels.levels, panel, ship: shipData, sprites: spritesData, enemies: enemiesData, charsets, music});
const l = makeWorker();
l.send(withGame(1));
check('init with the levels answers ready with the level', l.out[0], {message: 'ready', seed: 1, level: 1});
l.tick();
const f1 = l.last();
check('a frame carries the level, 1024 bytes of screen RAM and 1000 of colour RAM', [f1.level, f1.screen.length, f1.color.length], [1, 1024, 1000]);
check('★ the game begins in READY ($088A -> $0B6C): mode ready, the chain off, the panel set over the screen', [f1.mode, f1.state, f1.vic[0x18], f1.vic[0x15]], ['ready', 'ready', 0x32, 0]);
check('★ READY: the text of $0C5B in rows 7-8 ($CD25), the playfield cleared', [f1.screen[0x125], f1.screen[0x14D], f1.screen[0]], [0x24, 0x35, 0]);
check('★ the panel carries the BEAM meter ($15D0: 22 × $1A at $CF58) and no lives yet ($0CD5 comes with the main loop)', [f1.screen[856], f1.screen[877], f1.screen[841]], [0x1A, 0x1A, 0]);
check('a frame carries the VIC registers, the sprite shapes and glyph $DD', [f1.vic.length, f1.sprites.length, f1.glyphDD.length], [0x2F, 0x300, 8]);
check('the first frame carries the high memory, with the lower set of S at $E000', [f1.high.length, f1.high.subarray(0x4000, 0x4800).some(v => v)], [0x6000, true]);
check('★ the game step after the start: the upper set copied to $C000 by $11FA', (() => { const w = makeWorker(); w.send(withGame(1)); w.send({message: 'input', joystick: 0x6F, space: false}); for (let i = 0; i < 54; i++) { w.tick(); } return w.last().high ? w.last().high.subarray(0x2000, 0x2600).some(v => v) : 'no high'; })(), true);
check('a frame carries the score, the lives and the events', [f1.score, f1.lives, f1.events.map(e => e.kind)], [0, 3, ['ready']]);
// ★ fire is read only after the countdown of 50 iterations ($0B63); the input: bit 4 clear
l.send({message: 'input', joystick: 0x6F, space: false});
for (let i = 0; i < 48; i++) { l.tick(); }
check('★ 49 iterations of READY: still READY', l.last().mode, 'ready');
l.tick();
check('★ the 50th iteration reads fire: the restart begins', l.last().events.map(e => e.kind), ['fire']);
l.send({message: 'input', joystick: 0x7F, space: false});
const kinds = [];
for (let i = 0; i < 4; i++) { l.tick(); for (const e of l.last().events) { kinds.push(e.kind); } }
const lf = l.last();
check('★ after the init\'s frames (three of them) the main loop runs: mode play', [lf.mode, lf.state, kinds], ['play', 'play', ['mainLoop']]);
check('★ the ship starts at X $3F, Y $72 in sprites 1 and 2 ($1425)', [lf.vic[2], lf.vic[3], lf.vic[4], lf.vic[5]], [0x3F, 0x72, 0x3F, 0x72+0x15]);
check('★ the sprite pointers are $4A, $44, $45 ($14EF, $147D)', Array.from(lf.screen.subarray(1016, 1019)), [0x4A, 0x44, 0x45]);
check('★ the lives in the panel ($0CD5: three $1F at $CF49)', [lf.screen[841], lf.screen[842], lf.screen[843], lf.screen[844]], [0x1F, 0x1F, 0x1F, 0]);
check('★ the first screen drawn from the map ($11A2) and the map pointer at $9A27', [lf.screen.subarray(0, 40).some(v => v !== 0), lf.pointer], [true, 0x9A27]);
check('the fine scroll counts down one every two frames from 7', (() => { const seen = []; for (let i = 0; i < 6; i++) { l.tick(); seen.push(l.last().fine); } return seen; })().length, 6);

// --- the same seed gives the same game
const m2 = makeWorker();
m2.send(withGame(1));
m2.send({message: 'input', joystick: 0x6F, space: false});
for (let i = 0; i < 60; i++) { m2.tick(); }
const l2 = makeWorker();
l2.send(withGame(1));
l2.send({message: 'input', joystick: 0x6F, space: false});
for (let i = 0; i < 60; i++) { l2.tick(); }
check('the same level gives the same frames', Array.from(l2.last().screen), Array.from(m2.last().screen));

// --- the ship moves on the joystick: right ($DC00 bit 3 clear) with the speed of 1 px a frame ($2E02)
const j = makeWorker();
j.send(withGame(1));
j.send({message: 'input', joystick: 0x6F, space: false});
for (let i = 0; i < 50; i++) { j.tick(); }                    // READY and fire
j.send({message: 'input', joystick: 0x77, space: false});     // right
for (let i = 0; i < 5; i++) { j.tick(); }                     // the init's frames: the ship step runs inside them
const xs = [];
for (let i = 0; i < 5; i++) { j.tick(); xs.push(j.last().vic[2]); }
check('the ship flies right a pixel a frame', xs.map((x, i) => x-xs[0]), [0, 1, 2, 3, 4]);
check('the ship step runs from the first frame, the game step only after the start wait ($0232)', xs[0] > 0x3F, true);

// --- a level from the developer's `?devLevel=`
const l5 = makeWorker();
l5.send(withGame(5));
check('init with level 5 answers ready with level 5', l5.out[0], {message: 'ready', seed: 1, level: 5});
l5.tick();
check('level 5 begins in READY too', l5.last().mode, 'ready');

console.log(`runworker: ${checks} checks, ${differences} differences (${stopped} frames in ${frames*20} ms)`);
process.exit(differences);
