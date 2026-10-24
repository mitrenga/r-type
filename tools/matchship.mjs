#!/usr/bin/env node
/**
 * matchship — the ship, its weapons and the panel moved by the remake, against the running original.
 *
 * The acceptance tool of M3. For every recording of `tools/traceship.py`
 * (`build/ship/l<level><scenario>/`) it takes the RAM at the first `$08C1`
 * (the init, items poked), builds the level with `app/levelScroll.js`, loads
 * the state into `app/ship.js` — the game's own code, classic scripts loaded
 * through `classicScript.cjs` — and runs frame after frame, comparing every
 * sample at `$0DBA` (hit *h* sees *h* − 1 frames after the init, plus the
 * raster-202 handler of the init frame when the init fell between raster 48
 * and 202):
 *
 * - **the variables at their addresses**: zero page (ship, Force, sprite
 *   slots), the state pages $0200-$07FF, and every table of the shots,
 *   lasers, beam, missiles, explosions, score, bits, death and the hooks;
 * - **the screen**: all 25 rows and the sprite pointers, the colour RAM;
 * - **the sprites**: shapes $D000-$D2FF (the bits drawn in), registers of
 *   sprites 0-2, enable, multicolour, colours; glyph $DD of the shared set.
 *
 * ★ Every sample taken one frame after a column shift finds the original
 * still inside the shift (`$0225` set: the shift outlasts the frame and the
 * next raster-48 handler nests into it); such samples are skipped and counted.
 * So are the few where the raster-202 handler itself (`$0B5F` set) ran past
 * the next raster 48 — measured with the red laser in levels 2 and 8, where
 * the music or the laser take long; the nested handler then skips only the
 * enemy loop, which has nothing to do in M3.
 *
 * Bytes that hold a colour read back from the colour RAM are compared in
 * their low nibble (the chip has four bits there). The zero-page temporaries
 * of the routines ($3F-$58, $5A-$63, $65-$79, $D0-$E5) are not compared.
 *
 *     tools/matchship.mjs                    # all recordings in build/ship/
 *     tools/matchship.mjs --only l1b --verbose --stop
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');

const LevelScroll = loadClassicScript(new URL('../app/levelScroll.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/sidPlayer.js', import.meta.url).pathname);   // M6: `Ship` constructs `SidPlayer`
const Ship = loadClassicScript(new URL('../app/ship.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/enemies.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/levelCode.js', import.meta.url).pathname);   // M4: `Ship` constructs `Enemies`

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const stopAtFirst = args.includes('--stop');
const only = opt('--only');
const dir = opt('--dir', 'build/ship');
const maxReport = +opt('--report', 12);

const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const shipData = JSON.parse(readFileSync('data/ship.json', 'utf8'));
const spritesData = JSON.parse(readFileSync('data/sprites.json', 'utf8'));

/** the sample files and the addresses they hold */
const FILES = [
  ['low', 0x0000, 0x0800], ['mid', 0x0977, 0x0E85], ['v1', 0x1190, 0x2498], ['v2', 0x2805, 0x3AE4],
  ['v3', 0x3B99, 0x4962], ['v4', 0x4C4B, 0x4EB7], ['hook', 0x6000, 0x6010], ['bank', 0xC600, 0xD300]
];
/** ★ $0977 (the main loop's tick) is left out: the sample at $0DBA lies past the handler's `STA $0977`,
 * the remake is compared before its handler — and the wait of the main loop clears it (M5)
 */
/** the ranges of `ram` compared: [from, to) */
const RANGES = [
  [0x23, 0x35], [0x59, 0x5A], [0x64, 0x65], [0x7A, 0xCE],
  [0x0100, 0x01C0], [0x0200, 0x0314], [0x0316, 0x0400], [0x0400, 0x0800],   // $0314/$0315: the chain's next handler
  [0x0B5D, 0x0B64], [0x0E69, 0x0E6B],                                       // ($0977: see below)
  [0x1190, 0x1192], [0x1A67, 0x1A68], [0x1C43, 0x1C44], [0x1CAC, 0x1CB1], [0x1DB6, 0x1DB7], [0x1EC7, 0x1EC8],
  [0x1FD8, 0x1FF1], [0x2068, 0x206A], [0x226B, 0x226C], [0x2274, 0x2275], [0x2289, 0x228A], [0x242F, 0x2498],
  [0x2805, 0x2821], [0x2C51, 0x2C52], [0x2FC2, 0x2FDB], [0x305C, 0x3061], [0x306C, 0x3071], [0x3079, 0x307D],
  [0x32C8, 0x32CA], [0x3384, 0x33A5], [0x33F1, 0x33F3], [0x3413, 0x3414], [0x348C, 0x348D], [0x34B7, 0x34B8],
  [0x36A8, 0x36A9], [0x3AD6, 0x3AE4],
  [0x3B99, 0x3B9B], [0x3D73, 0x3D74], [0x3ED5, 0x3EF0], [0x40AA, 0x40D1], [0x4114, 0x4115], [0x4284, 0x429E],
  [0x4791, 0x47A1], [0x4855, 0x4857], [0x495E, 0x4962],
  [0x4C4B, 0x4C93], [0x4EAC, 0x4EB7],
  [0x6000, 0x6006]
];
/** bytes read back from the colour RAM: four bits */
const COLOR_BYTES = [[0x0160, 0x01C0], [0x0370, 0x037A], [0x043A, 0x0446], [0x1FE2, 0x1FE4], [0x3EE9, 0x3EED],
                     [0x40BE, 0x40C2], [0x4294, 0x4297], [0x479F, 0x47A1], [0x4C8B, 0x4C91]];
const colorMask = new Uint8Array(0x6200).fill(0xFF);
for (const [a, b] of COLOR_BYTES) { colorMask.fill(0x0F, a, b); }

let checks = 0, diffs = 0;

/** the original's scroll counters out of a 64 KB image (as matchlevels) */
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
  /** @returns {number} the RAM byte at `addr`, or -1 when no file holds it */
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
  const before = checks, beforeDiffs = diffs;
  let reported = 0;
  const report = (frame, what, got, want) => {
    diffs++;
    if (reported < maxReport) { console.log(`    f${frame} ${what}: got ${got} want ${want}`); reported++; }
  };

  // what ran between the init and the first hit: the main loop's first pass when there was time for it
  // (★ 630 cycles to raster 48 are enough, 138 are not), and the raster-202 handler of the init frame
  const toRaster48 = meta.initRaster < 48 ? (48-meta.initRaster)*63-meta.initCycle : 1e9;
  const passBeforeHit1 = toRaster48 > 400;
  if (passBeforeHit1) { ship.mainLoopPass(); }
  if (meta.initRaster >= 48 && meta.initRaster < 202) { ship.irq202(); }
  const frames = readdirSync(where).filter(f => /^f\d+_low\.bin$/.test(f)).map(f => +f.slice(1, 6)).sort((a, b) => a-b);
  let done = 0, compared = 0, firstBad = null, busy = 0, overrun = 0;
  for (const f of frames) {
    while (done < f-1 && !ship.ready) { ship.frame(); done++; }
    if (ship.ready) { break; }
    if (f === 1 && !passBeforeHit1) { continue; }   // the main loop is in the middle of its first pass
    const s = new Sample(where, f);
    if (s.ram(0x0225)) { busy++; continue; }     // ★ the sample fell into the shift the previous frame started
    if (s.ram(0x0B5F)) { overrun++; continue; }  // ★ the raster-202 handler of the previous frame is still running
    const bad0 = diffs;
    // the variables
    for (const [a, b] of RANGES) {
      for (let addr = a; addr < b; addr++) {
        const want = s.ram(addr);
        if (want < 0) { continue; }
        checks++;
        const m = colorMask[addr];
        if ((ship.ram[addr] & m) !== (want & m)) { report(f, `$${addr.toString(16).padStart(4, '0')}`, ship.ram[addr], want); }
      }
    }
    // the screen, the pointers, the colours
    const bank = s.files.bank.bytes;
    for (let i = 0; i < 1019; i++) {                       // $CFFB-$CFFF: pointers of sprites 3-7, the multiplexer's (M4)
      checks++;
      if (ship.scroll.screen[i] !== bank[0x600+i]) { report(f, `screen ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.screen[i], bank[0x600+i]); }
    }
    for (let i = 0; i < 1000; i++) {
      checks++;
      if (ship.scroll.color[i] !== (s.io[0x800+i] & 15)) { report(f, `colour ${i} (row ${i/40|0} col ${i%40})`, ship.scroll.color[i], s.io[0x800+i] & 15); }
    }
    // the sprites and glyph $DD
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
      const m = reg >= 0x25 ? 15 : 255;                       // colour registers read back with the upper nibble set
      if ((ship.vic[reg] & m) !== (s.io[reg] & m)) { report(f, `$D0${reg.toString(16).padStart(2, '0')}`, ship.vic[reg], s.io[reg]); }
    }
    checks++;
    if ((ship.vic[0x10] & 7) !== (s.io[0x10] & 7)) { report(f, '$D010 bits 0-2', ship.vic[0x10] & 7, s.io[0x10] & 7); }
    compared++;
    if (diffs > bad0 && firstBad === null) { firstBad = f; }
    if (diffs > bad0 && stopAtFirst) { break; }
  }
  console.log(`${name}: level ${meta.level} ${meta.scenario}${meta.immortal ? ' immortal' : ''}, ${compared} samples, ${done} frames, `
              + `${checks-before} checks, ${diffs-beforeDiffs} differences`
              + (firstBad !== null ? ` (first at f${firstBad})` : '') + (ship.ready ? ', READY reached' : '')
              + (busy ? `, ${busy} samples inside a shift skipped` : '')
              + (overrun ? `, ${overrun} inside the raster-202 handler skipped` : ''));
}

const names = readdirSync(dir).filter(n => /^l\d[a-z]$/.test(n)).sort();
for (const name of names) {
  if (only && name !== only) continue;
  matchScenario(name);
}
console.log(`\nmatchship: ${checks} checks, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
