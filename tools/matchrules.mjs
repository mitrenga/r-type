#!/usr/bin/env node
/**
 * matchrules — the rules around a level moved by the remake, against the
 * running original: deaths, READY, the restart, the level's end, the next
 * level, GAME OVER.
 *
 * The acceptance tool of M5. For every recording of `tools/tracerules.py`
 * (`build/rules/l<level><scenario>/`) it takes the RAM at the first `$08C1`,
 * builds the level, loads the state into `app/ship.js` + `app/enemies.js`
 * + `app/gameRules.js` — the game's own code — and walks the recording's
 * stops (`samples.json`) in order:
 *
 * - a **top** stop (`$0DBA` of frame *f*): the remake brought to *f* − 1
 *   complete frames — or, inside the init of a level or a restart, to just
 *   before the nested raster-48 handler of *f* — and compared as
 *   `matchenemies.mjs` compares (the zero page, `$0200`-`$07FF`, the code's
 *   variables, `$4F00`-`$5FFF`, `$7A00`-`$99FF`, the screen, the colour RAM,
 *   the shapes, sprites 0-2 and the multiplexer's group 0 with its stale
 *   registers);
 * - a **readyFrame** stop (`$0BFF`, the *n*-th iteration of a READY): the
 *   remake after *n* − 1 iterations; an **endFrame** stop (`$0A38`, the
 *   level-end sequence) the same — compared without the multiplexer (the
 *   chain is off), with `$D016`/`$D018`/`$D022`/`$D023`;
 * - an **event** stop: the remake's next event must be the same kind at the
 *   same frame (`death`, `ready` with its text, `fire`, `restart` /
 *   `checkpoint`, `mainLoop`, `levelEnd`, `sequence`, `load`, `levelInit`,
 *   `gameOver`, `rewind`, `ending`). The recording's `levelStart` (the
 *   loader after PRESS PLAY) ends the comparison: the remake's game is over.
 *
 * ★ What is timing in the original is taken from the recording, as the
 * column shifts are (`timing.json`): the race of a death (READY at once or
 * after the 20-tick wait — from the frames of `death` and `ready`) and the
 * layout of every init (`init` entries: where the first screen stood when
 * a handler nested into it, and the main loop's raster). After the first
 * load `$0677`-`$0774` is left out: the loader's zero page lives there
 * (`$0AC9` swaps it in for the load).
 *
 *     tools/matchrules.mjs                        # all recordings in build/rules/
 *     tools/matchrules.mjs --only l1r --verbose --stop
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');

const LevelScroll = loadClassicScript(new URL('../app/levelScroll.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/sidPlayer.js', import.meta.url).pathname);   // M6: `Ship` constructs `SidPlayer`
const Ship = loadClassicScript(new URL('../app/ship.js', import.meta.url).pathname);
const Enemies = loadClassicScript(new URL('../app/enemies.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/levelCode.js', import.meta.url).pathname);
const GameRules = loadClassicScript(new URL('../app/gameRules.js', import.meta.url).pathname);
// ★ the raster-202 handler (the VIC write of group 0) nests into the state machine of band 5 at an
// unmeasured point: the registers may hold the group as it stood before any of its slot steps
const origStateMachine = Enemies.prototype.stateMachine, origSlotStep = Enemies.prototype.slotStep;
Enemies.prototype.stateMachine = function () { this.ship.groupTrail = [this.group(0)]; return origStateMachine.apply(this, arguments); };
Enemies.prototype.slotStep = function (x) { if (x < 5 && this.ship.groupTrail) { this.ship.groupTrail.push(this.group(0)); } return origSlotStep.apply(this, arguments); };

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const stopAtFirst = args.includes('--stop');
const verbose = args.includes('--verbose');
const only = opt('--only');
const dir = opt('--dir', 'build/rules');
const maxReport = +opt('--report', 12);
const maxStop = +opt('--to', 1e9);
/** `--watch 94ca-94cf,6004`: addresses printed from both sides at every compared stop (`--from`/`--to` the stops) */
const watch = [];
for (const part of (opt('--watch', '') ? opt('--watch').split(',') : [])) {
  const [a, b] = part.split('-').map(h => parseInt(h, 16));
  for (let x = a; x <= (b === undefined ? a : b); x++) watch.push(x);
}
const fromStop = +opt('--from', 0);

const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const shipData = JSON.parse(readFileSync('data/ship.json', 'utf8'));
const spritesData = JSON.parse(readFileSync('data/sprites.json', 'utf8'));
const enemiesData = JSON.parse(readFileSync('data/enemies.json', 'utf8'));

/** the sample files and the addresses they hold (`tracerules.py` SAVES) */
const FILES = [
  ['low', 0x0000, 0x0800], ['mid', 0x0977, 0x0E85], ['v1', 0x1190, 0x2498], ['v2', 0x2805, 0x3AE4],
  ['v3', 0x3B99, 0x4962], ['v4', 0x4C4B, 0x4EB7], ['v5', 0x4F00, 0x6000], ['hook', 0x6000, 0x6010],
  ['lv', 0x7A00, 0x9A00], ['bank', 0xC600, 0xD300]
];
/** ★ $0977 (the main loop's tick) is left out: the sample at $0DBA lies past the handler's `STA $0977`,
 * the remake is compared before its handler — and the wait of the main loop clears it (M5)
 */
/** the ranges of `ram` compared: [from, to) — M4's */
const RANGES = [
  [0x23, 0x35], [0x59, 0x5A], [0x64, 0x65], [0x7A, 0xCE],
  [0x0100, 0x01C0], [0x0200, 0x0314], [0x0316, 0x0400], [0x0400, 0x0800],
  [0x0B5D, 0x0B64], [0x0E69, 0x0E6B],                                       // ($0977: see below)
  [0x1190, 0x1192], [0x1A67, 0x1A68], [0x1C43, 0x1C44], [0x1CAC, 0x1CB1], [0x1DB6, 0x1DB7], [0x1EC7, 0x1EC8],
  [0x1FD8, 0x1FF1], [0x2068, 0x206A], [0x226B, 0x226C], [0x2274, 0x2275], [0x2289, 0x228A], [0x242F, 0x2498],
  [0x2805, 0x2821], [0x2C51, 0x2C52], [0x2FC2, 0x2FDB], [0x305C, 0x3061], [0x306C, 0x3071], [0x3079, 0x307D],
  [0x32C8, 0x32CA], [0x3384, 0x33A5], [0x33F1, 0x33F3], [0x3413, 0x3414], [0x348C, 0x348D], [0x34B7, 0x34B8],
  [0x36A8, 0x36A9], [0x3AD6, 0x3AE4],
  [0x3B99, 0x3B9B], [0x3D73, 0x3D74], [0x3ED5, 0x3EF0], [0x40AA, 0x40D1], [0x4114, 0x4115], [0x4284, 0x429E],
  [0x4791, 0x47A1], [0x4855, 0x4857], [0x495E, 0x4962],
  [0x4C4B, 0x4C93], [0x4EAC, 0x4EB7],
  [0x4F00, 0x6000], [0x6000, 0x6006],
  [0x7A00, 0x9A00]
];
/** bytes read back from the colour RAM: four bits */
const COLOR_BYTES = [[0x0160, 0x01C0], [0x0370, 0x037A], [0x043A, 0x0446], [0x1FE2, 0x1FE4], [0x3EE9, 0x3EED],
                     [0x40BE, 0x40C2], [0x4294, 0x4297], [0x479F, 0x47A1], [0x4C8B, 0x4C91]];
const colorMask = new Uint8Array(0xA000).fill(0xFF);
for (const [a, b] of COLOR_BYTES) { colorMask.fill(0x0F, a, b); }
/** ★ $0677-$0774: the loader's zero page, swapped in for a load ($0AC9) — not the game's state after the first load */
const LOADER_ZP = [0x0677, 0x0775];
const REGS = [0, 1, 2, 3, 4, 5, 0x15, 0x1C, 0x25, 0x26, 0x27, 0x28, 0x29];
/** ★ the registers of the flat modes, with the bits the chip gives back (unused bits read as 1) */
const FLAT_REGS = [[0x16, 0x1F], [0x18, 0xFE], [0x22, 0x0F], [0x23, 0x0F]];

let checks = 0, diffs = 0;
/** the counters, for a tool built on this one (`matchsound.mjs`) */
export function counters() { return {checks, diffs}; }

function stateOf(ram) {
  const s = {pointer: ram[0x201] | ram[0x202] << 8, fine: ram[0x20C], counter: ram[0x36A8],
             running: ram[0x221], fineY: ram[0x20B], reg64: ram[0x64]};
  s.v = {colTick: ram[0x3AD6], phase: ram[0x3AD7], idxB: ram[0x3AD8], redraw: ram[0x3AD9],
         rowPtr: ram[0x3ADA] | ram[0x3ADB] << 8, cntA: ram[0x3ADC], tickA: ram[0x3ADD], repA: ram[0x3ADE],
         dirA: ram[0x3ADF], cntB: ram[0x3AE0], tickB: ram[0x3AE1], repB: ram[0x3AE2], dirB: ram[0x3AE3]};
  return s;
}

class Sample {
  constructor(where, k) {
    this.k = k;
    this.files = {};
    for (const [name, from] of FILES) {
      const path = `${where}/s${String(k).padStart(6, '0')}_${name}.bin`;
      this.files[name] = {from, bytes: readFileSync(path)};
    }
    this.io = readFileSync(`${where}/s${String(k).padStart(6, '0')}_io.bin`);
  }
  ram(addr) {
    for (const name in this.files) {
      const f = this.files[name];
      if (addr >= f.from && addr < f.from+f.bytes.length) { return f.bytes[addr-f.from]; }
    }
    return -1;
  }
}

/**
 * ★ The layout of an init from the timing pass: the handlers that nested
 * into it after the fire at `fireFrame`, with the first screen's progress,
 * up to the main loop's entry (`mainLoop` event: frame and raster).
 */
function layoutOf(timing, fireFrame, fireRaster, mainLoop) {
  if (!timing || !mainLoop) { return null; }
  const out = [];
  // ★ the latched raster-202 handler in the fire's frame itself (after the fire, at the first CLI)
  const t0 = timing[fireFrame] && timing[fireFrame].init;
  if (t0 && t0.irq202 && t0.irq202.raster > fireRaster) { out.push({at: 'irq202', frame: 0}); }
  for (let f = fireFrame+1; f <= mainLoop.frame; f++) {
    const t = timing[f] && timing[f].init;
    for (const at of ['irq48', 'band5', 'irq202']) {
      if (f === mainLoop.frame && ((at === 'band5' && mainLoop.raster <= 141) || (at === 'irq202' && mainLoop.raster <= 202))) { continue; }
      const e = t && t[at];
      if (!e) {
        // no entry: the handler came outside the init (before the first screen: nothing drawn)
        if (f < mainLoop.frame || at === 'irq48') { out.push({at, frame: f-fireFrame, cells: 0}); }
        continue;
      }
      let cells = 0, colour = true, set;
      if (e.cells !== undefined) { cells = e.cells; colour = e.colour; }
      else if (e.phase === 'after') { cells = 760; }
      else if (e.set !== undefined) { set = e.set; }
      out.push({at, frame: f-fireFrame, cells, colour, set});
    }
  }
  out.push({at: 'mainLoop', frame: mainLoop.frame-fireFrame, raster: mainLoop.raster});
  return out;
}

/**
 * One recording walked by the remake and compared.
 *
 * ★ `hooks` lets another matcher ride on the same walk (`matchsound.mjs`,
 * M6): `setup({ship, rules, meta, where, stops, timing})` once the remake
 * stands at the init; `atStop(st, kind)` at every stop the remake was
 * brought to (`kind` 'top', 'frame' for READY/sequence iterations, 'event'),
 * before the RAM comparison and its skip rules; `finish(ended)` at the end.
 * `ram: false` leaves the RAM comparison out, `quiet` the summary line.
 * @param {string} name - `l<level><scenario>`.
 * @param {Object} [hooks] - See above.
 */
export function matchRecording(name, hooks) {
  hooks = hooks || {};
  const where = `${dir}/${name}`;
  if (!existsSync(`${where}/samples.json`)) { console.log(`${name}: no recording`); return; }
  const meta = JSON.parse(readFileSync(`${where}/meta.json`, 'utf8'));
  const stops = JSON.parse(readFileSync(`${where}/samples.json`, 'utf8')).stops;
  const init = new Uint8Array(readFileSync(`${where}/init_ram.bin`));
  const initIO = new Uint8Array(readFileSync(`${where}/init_io.bin`));
  const timing = existsSync(`${where}/timing.json`) ? JSON.parse(readFileSync(`${where}/timing.json`, 'utf8')).shifts : null;
  const level = levels.levels[meta.level-1];
  const scroll = new LevelScroll();
  scroll.init(level, stateOf(init));
  const ship = new Ship(scroll);
  ship.loadData(shipData, spritesData, enemiesData);
  ship.load(init, initIO, level);
  ship.immortal = !!meta.immortal;
  ship.mortalAfter = meta.mortalAfter || 0;
  const rules = new GameRules(ship);
  rules.levels = levels.levels;
  if (timing) {
    ship.columnTiming = {};
    for (const f in timing) { ship.columnTiming[+f] = timing[f]; }
  }
  if (hooks.setup) { hooks.setup({ship, rules, meta, where, stops, timing}); }
  const before = checks, beforeDiffs = diffs;
  let reported = 0;
  const report = (k, what, got, want) => {
    diffs++;
    if (reported < maxReport) { console.log(`    s${k} ${what}: got ${got} want ${want}`); reported++; }
  };
  // ★ the init's first pass (M3): before the first raster-48 hit when there is time for it — the entry
  // $08C1 takes 17 cycles to reach livesPanel, its clear 90, then 19 a glyph (3 lives): with less than
  // that the handler interrupts the lives half drawn (level 4: 148 cycles — two glyphs) and the entry
  // goes on after it
  const toRaster48 = meta.initRaster < 48 ? (48-meta.initRaster)*63-meta.initCycle : 1e9;
  if (!meta.initRaster || toRaster48 > 170) { ship.mainLoopEnter(); }
  else if (toRaster48 > 107) {
    const lives = ship.ram[0x281D] & 7, glyphs = Math.min(lives, Math.floor((toRaster48-107)/19));
    for (let x = 0; x < 8; x++) { ship.sw(0xCF49+x, 0); }
    for (let i = 0; i < glyphs; i++) { ship.sw(0xCF48+lives-i, 0x1F); ship.cw(0xCF48+lives-i, 9); }
  }
  if (meta.initRaster >= 48 && meta.initRaster < 141) { ship.band5(); }
  if (meta.initRaster >= 48 && meta.initRaster < 202) { ship.irq202(); }

  const events = stops.filter(s => !['top', 'readyFrame', 'endFrame', 'other'].includes(s.kind));
  let eventsSeen = 0, loaded = false, readyN = 0, endN = 0, compared = 0, busy = 0, overrun = 0, inInit = 0, stale = 0, error = null, firstBad = null;
  // ★ the races: for every death, whether READY came at once (the same frame) or after the wait
  const raceAfter = (deathIndex) => {
    const next = events[deathIndex+1];
    if (!next) { return null; }
    if (next.kind === 'gameOver') { return null; }
    return next.kind === 'ready' ? next.frame !== events[deathIndex].frame : null;
  };
  let deathCount = 0;
  rules.onEvent = (e) => {
    if (e.kind === 'ready') {
      // ★ READY's clear as the handlers found it (phase `ready` of the init entries, X of $1192):
      // this frame's band 5 / raster-202 handler, the next frame's raster-48 handler
      const at = {};
      const t0 = timing && timing[e.frame] && timing[e.frame].init, t1 = timing && timing[e.frame+1] && timing[e.frame+1].init;
      for (const k of ['band5', 'irq202']) { if (t0 && t0[k] && t0[k].phase === 'ready') { at[k] = t0[k].x; } }
      if (t1 && t1.irq48 && t1.irq48.phase === 'ready') { at.irq48 = t1.irq48.x; }
      rules.readyClearAt = at;
    }
    if (e.kind === 'death') {
      const idx = events.findIndex((ev, i) => ev.kind === 'death' && events.slice(0, i).filter(x => x.kind === 'death').length === deathCount);
      deathCount++;
      const w = idx >= 0 ? raceAfter(idx) : null;
      rules.race = w;
    }
    if (e.kind === 'fire') {
      // the layout of the init that follows: the recording's own
      const i = events.findIndex(ev => ev.kind === 'fire' && ev.frame === e.frame && !ev.used);
      if (i >= 0) {
        events[i].used = true;
        const ml = events.slice(i).find(ev => ev.kind === 'mainLoop');
        rules.layout = layoutOf(timing, e.frame, events[i].raster, ml && ml.frame <= e.frame+6 ? ml : null);
      }
    }
    if (e.kind === 'load') { loaded = true; }
  };

  /** one step of the remake: a frame, an iteration, or a step of the restart up to its next handler */
  const stepOnce = () => {
    if (rules.state === 'restart') {
      if (!rules.steps) { rules.steps = rules.buildRestart(); }
      while (rules.steps.length) {
        const st = rules.steps.shift();
        if (st.frameEnd) { continue; }
        st.run();
        return;
      }
      return;
    }
    if (rules.state === 'rewind' || rules.state === 'ending') { return; }
    rules.frame();
  };
  /** the remake just before the raster-48 handler of frame `f` */
  const advanceToTop = (f) => {
    for (let guard = 0; guard < 100000; guard++) {
      if (rules.state === 'play' && ship.frameCount >= f-1) { return ship.frameCount === f-1; }
      if (rules.state === 'ready' && rules.readyExtra && ship.frameCount === f-1) { return true; }
      if (rules.state === 'restart') {
        if (!rules.steps) { rules.steps = rules.buildRestart(); }
        if (rules.nextStep() === 'irq48' && ship.frameCount === f-1) { rules.runUntil('irq48'); return true; }
        if (ship.frameCount >= f) { return false; }
      }
      if (rules.state === 'rewind' || rules.state === 'ending') { return false; }
      stepOnce();
    }
    return false;
  };
  const advanceUntil = (cond) => {
    for (let guard = 0; guard < 100000; guard++) {
      if (cond()) { return true; }
      if (rules.state === 'rewind' || rules.state === 'ending') { return cond(); }
      stepOnce();
    }
    return false;
  };

  const compareRam = (s) => {
    for (const [a, b] of RANGES) {
      for (let addr = a; addr < b; addr++) {
        if (loaded && addr >= LOADER_ZP[0] && addr < LOADER_ZP[1]) { continue; }
        const want = s.ram(addr);
        if (want < 0) { continue; }
        checks++;
        const m = colorMask[addr];
        if ((ship.ram[addr] & m) !== (want & m)) { report(s.k, `$${addr.toString(16).padStart(4, '0')}`, ship.ram[addr], want); }
      }
    }
    const bank = s.files.bank.bytes;
    for (let i = 0; i < 1019; i++) {
      checks++;
      if (ship.scroll.screen[i] !== bank[0x600+i]) { report(s.k, `screen ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.screen[i], bank[0x600+i]); }
    }
    for (let i = 0; i < 1000; i++) {
      checks++;
      if (ship.scroll.color[i] !== (s.io[0x800+i] & 15)) { report(s.k, `colour ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.color[i], s.io[0x800+i] & 15); }
    }
    for (let i = 0; i < 0x300; i++) {
      checks++;
      if (ship.spriteRAM[i] !== bank[0xA00+i]) { report(s.k, `sprite RAM $${(0xD000+i).toString(16)}`, ship.spriteRAM[i], bank[0xA00+i]); }
    }
    for (let i = 0; i < 8; i++) {
      checks++;
      if (ship.glyphDD[i] !== bank[0xE8+i]) { report(s.k, `glyph $DD byte ${i}`, ship.glyphDD[i], bank[0xE8+i]); }
    }
    for (const reg of REGS) {
      checks++;
      const m = reg >= 0x25 ? 15 : 255;
      if ((ship.vic[reg] & m) !== (s.io[reg] & m)) { report(s.k, `$D0${reg.toString(16).padStart(2, '0')}`, ship.vic[reg], s.io[reg]); }
    }
    checks++;
    if ((ship.vic[0x10] & 7) !== (s.io[0x10] & 7)) { report(s.k, '$D010 bits 0-2', ship.vic[0x10] & 7, s.io[0x10] & 7); }
  };
  const compareGroup0 = (s, first) => {
    if (ship.ram[0x024C] || ship.bossChain) { return; }
    const bank = s.files.bank.bytes;
    const initGroup = first ? [0, 1, 2, 3, 4].map(i => ({x: initIO[6+2*i] | ((initIO[0x10] >> (3+i)) & 1) << 8, y: initIO[7+2*i], pointer: init[0xCFFB+i], color: initIO[0x2A+i] & 15})) : null;
    const g = ship.enemies.group(0), prevGroup = ship.groupAfterLoop || initGroup || g, trail = ship.groupTrail || [];
    for (let i = 0; i < 5; i++) {
      const e = g[i], p = prevGroup[i];
      if (!e) { continue; }
      checks += 5;
      const vicX = s.io[6+2*i] | ((s.io[0x10] >> (3+i)) & 1) << 8, vicY = s.io[7+2*i], vicP = bank[0x9FB+i], vicC = s.io[0x2A+i] & 15;
      const olds = [p].concat(trail.map(t => t[i])).filter(Boolean);
      const same = (v, a, key, mask) => v === a ? 0 : (olds.some(o => (o[key] & mask) === v) ? 1 : -1);
      const r = [same(vicX, e.x, 'x', 511), same(vicY, e.y, 'y', 255), same(vicP, e.pointer, 'pointer', 255), same(vicC, e.color & 15, 'color', 15)];
      if (r[0] < 0) { report(s.k, `sprite ${3+i} X (VIC / slot)`, vicX, e.x); }
      if (r[1] < 0) { report(s.k, `sprite ${3+i} Y (VIC / slot)`, vicY, e.y); }
      if (r[2] < 0) { report(s.k, `sprite ${3+i} pointer (VIC / slot)`, vicP, e.pointer); }
      if (r[3] < 0) { report(s.k, `sprite ${3+i} colour (VIC / slot)`, vicC, e.color & 15); }
      if (r.some(v => v === 1)) { stale++; }
    }
  };
  const compareFlat = (s) => {
    compareRam(s);
    for (const [reg, m] of FLAT_REGS) {
      checks++;
      if ((ship.vic[reg] & m) !== (s.io[reg] & m)) { report(s.k, `$D0${reg.toString(16).padStart(2, '0')}`, ship.vic[reg] & m, s.io[reg] & m); }
    }
  };

  let lastKind = null, ended = null;
  const show = (st) => {
    if (!watch.length || st.k < fromStop) { return; }
    let s = null;
    try { s = new Sample(where, st.k); } catch (e) { return; }
    console.log(`    s${st.k} ${st.kind} f${st.frame}: ` + watch.map(a => `$${a.toString(16)}=${ship.ram[a].toString(16)}/${(s.ram(a) & 0xFF).toString(16)}`).join(' '));
  };
  for (const st of stops) {
    if (st.k > maxStop) { break; }
    const bad0 = diffs;
    try {
      if (st.kind === 'top') {
        if (st.kind !== lastKind) { readyN = 0; endN = 0; }
        const ok = advanceToTop(st.frame);
        if (!ok) { report(st.k, `frame ${st.frame}: the remake is at ${rules.state} frame ${ship.frameCount}`, rules.state, 'play'); if (stopAtFirst) { break; } lastKind = st.kind; continue; }
        if (hooks.atStop) { hooks.atStop(st, 'top'); }
        if (hooks.ram === false) { compared++; lastKind = st.kind; continue; }
        const s = new Sample(where, st.k);
        if (s.ram(0x0225)) { busy++; lastKind = st.kind; continue; }
        if (s.ram(0x0B5F) && rules.state !== 'ready') { overrun++; lastKind = st.kind; continue; }
        // ★ a raster-48 handler nested into the init's code before the first screen (the level's own init,
        // $1425 …): the sample sees that code half done — skipped like one inside a shift
        const ti = timing && timing[st.frame] && timing[st.frame].init && timing[st.frame].init.irq48;
        if (ti && ti.set === undefined && ti.cells === undefined && ti.phase !== 'after') { inInit++; lastKind = st.kind; continue; }
        // ★ the frame after a READY entered late (after the raster-202 handler): its clear $1192 may still
        // run at raster 48 — the sample sees the playfield half cleared, $0B63 not yet set
        if (rules.state === 'ready' && rules.readyExtra) { inInit++; lastKind = st.kind; continue; }
        compareRam(s);
        if (rules.state === 'play' || rules.state === 'restart') { compareGroup0(s, st.k === 0); }
        compared++;
        show(st);
      } else if (st.kind === 'readyFrame' || st.kind === 'endFrame') {
        const n = st.kind === 'readyFrame' ? ++readyN : ++endN;
        if (st.kind === 'readyFrame') { endN = 0; } else { readyN = 0; }
        const want = st.kind === 'readyFrame' ? 'ready' : 'sequence';
        const ok = advanceUntil(() => rules.state === want && !rules.readyExtra && (st.kind === 'readyFrame' ? rules.readyFrames : rules.endFrames) === n-1);
        if (!ok) { report(st.k, `${st.kind} ${n} at frame ${st.frame}: the remake is at ${rules.state} (${rules.readyFrames}/${rules.endFrames}) frame ${ship.frameCount}`, rules.state, want); if (stopAtFirst) { break; } lastKind = st.kind; continue; }
        if (hooks.atStop) { hooks.atStop(st, 'frame'); }
        if (hooks.ram === false) { compared++; lastKind = st.kind; continue; }
        const s = new Sample(where, st.k);
        compareFlat(s);
        compared++;
        show(st);
      } else {
        readyN = 0; endN = 0;
        if (st.kind === 'levelStart') { ended = 'levelStart'; break; }
        if (st.kind === 'other') { continue; }
        const idx = eventsSeen++;
        const ok = advanceUntil(() => rules.events.length > idx);
        checks++;
        const got = rules.events[idx];
        if (!ok || !got) { report(st.k, `event ${st.kind}@${st.frame}`, 'none', st.kind); if (stopAtFirst) { break; } continue; }
        const same = got.kind === st.kind && got.frame === st.frame && (st.kind !== 'ready' || got.a === st.a);
        if (!same) { report(st.k, `event ${idx}`, `${got.kind}@${got.frame}${got.a !== undefined ? '/'+got.a : ''}`, `${st.kind}@${st.frame}${st.kind === 'ready' ? '/'+st.a : ''}`); }
        if (hooks.atStop) { hooks.atStop(st, 'event'); }
        if (verbose) { console.log(`    ${st.kind}@${st.frame}${same ? '' : ' !!'}`); }
        if (st.kind === 'ending') { ended = 'ending'; break; }
      }
    } catch (e) { error = e; console.log(`    s${st.k}: ${e.message}`); if (verbose) { console.log(e.stack); } break; }
    lastKind = st.kind;
    if (diffs > bad0 && firstBad === null) { firstBad = st.k; }
    if (diffs > bad0 && stopAtFirst) { break; }
  }
  if (hooks.finish) { hooks.finish(ended, error); }
  const evs = rules.events.map(e => `${e.kind}@${e.frame}`).join(' ');
  if (!hooks.quiet) console.log(`${name}: level ${meta.level} ${meta.scenario}, ${compared} samples, ${eventsSeen} events, ${ship.frameCount} frames, `
              + `${checks-before} checks, ${diffs-beforeDiffs} differences`
              + (firstBad !== null ? ` (first at s${firstBad})` : '')
              + (ended ? `, ${ended} reached` : '')
              + (error ? ', STOPPED by an error' : '')
              + (stale ? `, ${stale} sprites a frame stale in the VIC` : '')
              + (busy ? `, ${busy} samples inside a shift skipped` : '')
              + (overrun ? `, ${overrun} inside the raster-202 handler skipped` : '')
              + (inInit ? `, ${inInit} inside an init's code skipped` : ''));
  if (verbose) { console.log(`    remake events: ${evs}`); }
  if (error) { diffs++; }
}

/** the recordings in `--dir`, by name */
export function recordings() {
  return readdirSync(dir).filter(n => /^l\d[a-z]$/.test(n)).sort().filter(n => !only || n === only);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const name of recordings()) {
    matchRecording(name);
  }
  console.log(`\nmatchrules: ${checks} checks, ${diffs} differences`);
  process.exit(diffs ? 1 : 0);
}
