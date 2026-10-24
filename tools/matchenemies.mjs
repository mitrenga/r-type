#!/usr/bin/env node
/**
 * matchenemies — the enemies, the waves, the multiplexer's slots and the
 * bosses moved by the remake, against the running original.
 *
 * The acceptance tool of M4. For every recording of `tools/traceenemies.py`
 * (`build/enemies/l<level><scenario>/`) it takes the RAM at the first `$08C1`,
 * builds the level with `app/levelScroll.js`, loads the state into
 * `app/ship.js` + `app/enemies.js` — the game's own code — and runs frame
 * after frame, comparing every sample at `$0DBA` as `matchship.mjs` does
 * (hit *h* sees *h* − 1 frames after the init), and on top of M3:
 *
 * - **the slots of the multiplexer** (zero page `$82`-`$CC`, `$044C`-`$0668`),
 *   the enemy bullets, the boss's tables (`$0398`-`$0427`) — all of
 *   `$0200`-`$07FF`;
 * - **the enemy code's own variables**: `$4F00`-`$5FFF` whole (the operands
 *   of the spawner, the band round-robins, the boss's hits, rows, flash);
 * - **the level's code and tables** `$7A00`-`$99FF` whole: whatever the
 *   boss step and the level's hook keep in `M` and `G`;
 * - **the sprite registers of sprites 3-7** as the raster-48 handler leaves
 *   them: group 0 of the multiplexer (X with its high bit from `$0D5C`,
 *   Y, pointer and colour from `$0EC5` of the frame before), for the slots
 *   in use. ★ The state machine of band 5 often runs past raster 202 and
 *   214 (measured, M4): the handler at 214 then copies a slot the machine
 *   has not reached yet — the sprite shows a frame late. Such a register is
 *   accepted when it holds the slot's value from before the state machine
 *   of the frame before (after its enemy loop — `Ship.groupAfterLoop`) and
 *   counted as **stale**: the overload of the original's multiplexer is
 *   timing, the slot tables are the state.
 *
 * ★ The same two kinds of sample are skipped and counted as in M3: inside a
 * column shift (`$0225`) and inside the raster-202 handler (`$0B5F`).
 *
 *     tools/matchenemies.mjs                      # all recordings in build/enemies/
 *     tools/matchenemies.mjs --only l1e --verbose --stop
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');

const LevelScroll = loadClassicScript(new URL('../app/levelScroll.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/sidPlayer.js', import.meta.url).pathname);   // M6: `Ship` constructs `SidPlayer`
const Ship = loadClassicScript(new URL('../app/ship.js', import.meta.url).pathname);
const Enemies = loadClassicScript(new URL('../app/enemies.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/levelCode.js', import.meta.url).pathname);
// ★ the raster-202 handler (the VIC write of group 0) nests into the state machine of band 5 at an
// unmeasured point: the registers may hold the group as it stood before any of its slot steps
const origStateMachine = Enemies.prototype.stateMachine, origSlotStep = Enemies.prototype.slotStep;
Enemies.prototype.stateMachine = function () { this.ship.groupTrail = [this.group(0)]; return origStateMachine.apply(this, arguments); };
Enemies.prototype.slotStep = function (x) { if (x < 5 && this.ship.groupTrail) { this.ship.groupTrail.push(this.group(0)); } return origSlotStep.apply(this, arguments); };

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const stopAtFirst = args.includes('--stop');
const only = opt('--only');
const dir = opt('--dir', 'build/enemies');
const maxReport = +opt('--report', 12);
const maxFrame = +opt('--to', 1e9);

const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const shipData = JSON.parse(readFileSync('data/ship.json', 'utf8'));
const spritesData = JSON.parse(readFileSync('data/sprites.json', 'utf8'));

/** the sample files and the addresses they hold */
const FILES = [
  ['low', 0x0000, 0x0800], ['mid', 0x0977, 0x0E85], ['v1', 0x1190, 0x2498], ['v2', 0x2805, 0x3AE4],
  ['v3', 0x3B99, 0x4962], ['v4', 0x4C4B, 0x4EB7], ['v5', 0x4F00, 0x6000], ['hook', 0x6000, 0x6010],
  ['lv', 0x7A00, 0x9A00], ['bank', 0xC600, 0xD300]
];
/** ★ $0977 (the main loop's tick) is left out: the sample at $0DBA lies past the handler's `STA $0977`,
 * the remake is compared before its handler — and the wait of the main loop clears it (M5)
 */
/** the ranges of `ram` compared: [from, to) — M3's, plus the enemies' */
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

let checks = 0, diffs = 0;

function stateOf(ram) {
  const s = {pointer: ram[0x201] | ram[0x202] << 8, fine: ram[0x20C], counter: ram[0x36A8],
             running: ram[0x221], fineY: ram[0x20B], reg64: ram[0x64]};
  s.v = {colTick: ram[0x3AD6], phase: ram[0x3AD7], idxB: ram[0x3AD8], redraw: ram[0x3AD9],
         rowPtr: ram[0x3ADA] | ram[0x3ADB] << 8, cntA: ram[0x3ADC], tickA: ram[0x3ADD], repA: ram[0x3ADE],
         dirA: ram[0x3ADF], cntB: ram[0x3AE0], tickB: ram[0x3AE1], repB: ram[0x3AE2], dirB: ram[0x3AE3]};
  return s;
}

class Sample {
  constructor(where, frame) {
    this.frame = frame;
    this.files = {};
    for (const [name, from] of FILES) {
      const path = `${where}/f${String(frame).padStart(5, '0')}_${name}.bin`;
      this.files[name] = {from, bytes: readFileSync(path)};
    }
    this.io = readFileSync(`${where}/f${String(frame).padStart(5, '0')}_io.bin`);
  }
  ram(addr) {
    for (const name in this.files) {
      const f = this.files[name];
      if (addr >= f.from && addr < f.from+f.bytes.length) { return f.bytes[addr-f.from]; }
    }
    return -1;
  }
}

function matchScenario(name) {
  const where = `${dir}/${name}`;
  if (!existsSync(`${where}/init_ram.bin`)) { console.log(`${name}: no recording`); return; }
  const meta = JSON.parse(readFileSync(`${where}/meta.json`, 'utf8'));
  const init = new Uint8Array(readFileSync(`${where}/init_ram.bin`));
  const initIO = new Uint8Array(readFileSync(`${where}/init_io.bin`));
  const level = levels.levels[meta.level-1];
  const scroll = new LevelScroll();
  scroll.init(level, stateOf(init));
  const ship = new Ship(scroll);
  ship.loadData(shipData, spritesData);
  ship.load(init, initIO, level);
  ship.immortal = !!meta.immortal;
  // ★ the measured ends of the column shifts (`traceenemies.py --timing`): where the next frame drew the column
  if (existsSync(`${where}/timing.json`)) {
    const t = JSON.parse(readFileSync(`${where}/timing.json`, 'utf8')).shifts;
    ship.columnTiming = {};
    for (const f in t) { ship.columnTiming[+f] = t[f]; }
  }
  const before = checks, beforeDiffs = diffs;
  let reported = 0;
  const report = (frame, what, got, want) => {
    diffs++;
    if (reported < maxReport) { console.log(`    f${frame} ${what}: got ${got} want ${want}`); reported++; }
  };
  const toRaster48 = meta.initRaster < 48 ? (48-meta.initRaster)*63-meta.initCycle : 1e9;
  const passBeforeHit1 = toRaster48 > 400;
  if (passBeforeHit1) { ship.mainLoopPass(); }
  // M4: band 5 (the spawner) of the init frame ran before the first sample — only when the init lies between
  // raster 48 and band 5 (★ an init before raster 48 sees the first sample at raster 48 of the same frame)
  if (meta.initRaster >= 48 && meta.initRaster < 141) { ship.band5(); }
  if (meta.initRaster >= 48 && meta.initRaster < 202) { ship.irq202(); }
  const frames = readdirSync(where).filter(f => /^f\d+_low\.bin$/.test(f)).map(f => +f.slice(1, 6)).sort((a, b) => a-b);
  let done = 0, compared = 0, firstBad = null, busy = 0, overrun = 0, error = null, stale = 0;
  for (const f of frames) {
    if (f > maxFrame) { break; }
    try {
      while (done < f-1 && !ship.ready && !ship.levelOver) { ship.frame(); done++; }
    } catch (e) { error = e; console.log(`    f${f}: ${e.message}`); break; }
    if (ship.ready || ship.levelOver) { break; }
    if (f === 1 && !passBeforeHit1) { continue; }
    const s = new Sample(where, f);
    if (s.ram(0x0225)) { busy++; continue; }
    if (s.ram(0x0B5F)) { overrun++; continue; }
    const bad0 = diffs;
    for (const [a, b] of RANGES) {
      for (let addr = a; addr < b; addr++) {
        const want = s.ram(addr);
        if (want < 0) { continue; }
        checks++;
        const m = colorMask[addr];
        if ((ship.ram[addr] & m) !== (want & m)) { report(f, `$${addr.toString(16).padStart(4, '0')}`, ship.ram[addr], want); }
      }
    }
    const bank = s.files.bank.bytes;
    for (let i = 0; i < 1019; i++) {
      checks++;
      if (ship.scroll.screen[i] !== bank[0x600+i]) { report(f, `screen ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.screen[i], bank[0x600+i]); }
    }
    for (let i = 0; i < 1000; i++) {
      checks++;
      if (ship.scroll.color[i] !== (s.io[0x800+i] & 15)) { report(f, `colour ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.color[i], s.io[0x800+i] & 15); }
    }
    for (let i = 0; i < 0x300; i++) {
      checks++;
      if (ship.spriteRAM[i] !== bank[0xA00+i]) { report(f, `sprite RAM $${(0xD000+i).toString(16)}`, ship.spriteRAM[i], bank[0xA00+i]); }
    }
    for (let i = 0; i < 8; i++) {
      checks++;
      if (ship.glyphDD[i] !== bank[0xE8+i]) { report(f, `glyph $DD byte ${i}`, ship.glyphDD[i], bank[0xE8+i]); }
    }
    const regs = [0, 1, 2, 3, 4, 5, 0x15, 0x1C, 0x25, 0x26, 0x27, 0x28, 0x29];
    for (const reg of regs) {
      checks++;
      const m = reg >= 0x25 ? 15 : 255;
      if ((ship.vic[reg] & m) !== (s.io[reg] & m)) { report(f, `$D0${reg.toString(16).padStart(2, '0')}`, ship.vic[reg], s.io[reg]); }
    }
    checks++;
    if ((ship.vic[0x10] & 7) !== (s.io[0x10] & 7)) { report(f, '$D010 bits 0-2', ship.vic[0x10] & 7, s.io[0x10] & 7); }
    // the multiplexer: group 0 in the registers of sprites 3-7 (the boss's own chain writes them by rows — M4 compares its tables instead)
    if (!ship.ram[0x024C]) {
      // (★ at the first sample of an init before raster 48 the registers still hold what the raster-202
      // handler wrote before the init — the harness's items are not in them yet)
      const initGroup = f === 1 ? [0, 1, 2, 3, 4].map(i => ({x: initIO[6+2*i] | ((initIO[0x10] >> (3+i)) & 1) << 8, y: initIO[7+2*i], pointer: init[0xCFFB+i], color: initIO[0x2A+i] & 15})) : null;
      const g = ship.enemies.group(0), prevGroup = ship.groupAfterLoop || initGroup || g, trail = ship.groupTrail || [];
      for (let i = 0; i < 5; i++) {
        const e = g[i], p = prevGroup[i];
        if (!e) { continue; }
        checks += 5;
        const vicX = s.io[6+2*i] | ((s.io[0x10] >> (3+i)) & 1) << 8, vicY = s.io[7+2*i], vicP = bank[0x9FB+i], vicC = s.io[0x2A+i] & 15;
        const olds = [p].concat(trail.map(t => t[i])).filter(Boolean);
        const same = (v, a, key, mask) => v === a ? 0 : (olds.some(o => (o[key] & mask) === v) ? 1 : -1);
        const r = [same(vicX, e.x, 'x', 511), same(vicY, e.y, 'y', 255), same(vicP, e.pointer, 'pointer', 255), same(vicC, e.color & 15, 'color', 15)];
        if (r[0] < 0) { report(f, `sprite ${3+i} X (VIC / slot)`, vicX, e.x); }
        if (r[1] < 0) { report(f, `sprite ${3+i} Y (VIC / slot)`, vicY, e.y); }
        if (r[2] < 0) { report(f, `sprite ${3+i} pointer (VIC / slot)`, vicP, e.pointer); }
        if (r[3] < 0) { report(f, `sprite ${3+i} colour (VIC / slot)`, vicC, e.color & 15); }
        if (r.some(v => v === 1)) { stale++; }
      }
    }
    compared++;
    if (diffs > bad0 && firstBad === null) { firstBad = f; }
    if (diffs > bad0 && stopAtFirst) { break; }
  }
  console.log(`${name}: level ${meta.level} ${meta.scenario}${meta.immortal ? ' immortal' : ''}, ${compared} samples, ${done} frames, `
              + `${checks-before} checks, ${diffs-beforeDiffs} differences`
              + (firstBad !== null ? ` (first at f${firstBad})` : '') + (ship.ready ? ', READY reached' : '')
              + (ship.levelOver ? ', the level ended' : '')
              + (error ? ', STOPPED by an error' : '')
              + (stale ? `, ${stale} sprites a frame stale in the VIC` : '')
              + (busy ? `, ${busy} samples inside a shift skipped` : '')
              + (overrun ? `, ${overrun} inside the raster-202 handler skipped` : ''));
  if (error) { diffs++; }
}

const names = readdirSync(dir).filter(n => /^l\d[a-z]$/.test(n)).sort();
for (const name of names) {
  if (only && name !== only) continue;
  matchScenario(name);
}
console.log(`\nmatchenemies: ${checks} checks, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
