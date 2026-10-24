#!/usr/bin/env node
/**
 * debugship — the remake and the original side by side, frame by frame.
 *
 * Runs `app/ship.js` on a recording of `tools/traceship.py` like
 * `matchship.mjs` does and prints chosen addresses of both for a range of
 * samples — where a difference comes from, not just that it is there.
 *
 *     tools/debugship.mjs --only l5c --from 580 --to 586 --addrs 1FD8-1FF0,0777,2B,23
 */
import { readFileSync, existsSync } from 'node:fs';
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
const only = opt('--only', 'l1a'), from = +opt('--from', 1), to = +opt('--to', from+5);
const addrs = [];
for (const part of opt('--addrs', '23-35').split(',')) {
  const [a, b] = part.split('-').map(h => parseInt(h, 16));
  for (let x = a; x <= (b === undefined ? a : b); x++) addrs.push(x);
}
/** `--cells 18:34-39,17:38`: screen cells (row:col or row:col-col) printed from both sides */
const cells = [];
for (const part of (opt('--cells', '') ? opt('--cells').split(',') : [])) {
  const [row, cols] = part.split(':');
  const [c0, c1] = cols.split('-').map(Number);
  for (let c = c0; c <= (c1 === undefined ? c0 : c1); c++) cells.push([+row, c]);
}
const where = `${opt('--dir', 'build/ship')}/${only}`;
const meta = JSON.parse(readFileSync(`${where}/meta.json`, 'utf8'));
const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const init = new Uint8Array(readFileSync(`${where}/init_ram.bin`));
const initIO = new Uint8Array(readFileSync(`${where}/init_io.bin`));
const level = levels.levels[meta.level-1];
const scroll = new LevelScroll();
const initState = {pointer: init[0x201] | init[0x202] << 8, fine: init[0x20C], counter: init[0x36A8], running: init[0x221], fineY: init[0x20B], reg64: init[0x64]};
initState.v = {colTick: init[0x3AD6], phase: init[0x3AD7], idxB: init[0x3AD8], redraw: init[0x3AD9], rowPtr: init[0x3ADA] | init[0x3ADB] << 8,
               cntA: init[0x3ADC], tickA: init[0x3ADD], repA: init[0x3ADE], dirA: init[0x3ADF], cntB: init[0x3AE0], tickB: init[0x3AE1], repB: init[0x3AE2], dirB: init[0x3AE3]};
scroll.init(level, initState);
const ship = new Ship(scroll);
ship.loadData(JSON.parse(readFileSync('data/ship.json', 'utf8')), JSON.parse(readFileSync('data/sprites.json', 'utf8')));
ship.load(init, initIO, level);
ship.immortal = !!meta.immortal;
if (existsSync(`${where}/timing.json`)) {   // M4: the measured state of the column shifts
  const t = JSON.parse(readFileSync(`${where}/timing.json`, 'utf8')).shifts;
  ship.columnTiming = {};
  for (const f in t) { ship.columnTiming[+f] = t[f]; }
}
const toRaster48 = meta.initRaster < 48 ? (48-meta.initRaster)*63-meta.initCycle : 1e9;
const passBeforeHit1 = toRaster48 > 400;
if (passBeforeHit1) ship.mainLoopPass();
if (meta.initRaster < 141) ship.band5();   // M4: band 5 of the init frame
if (meta.initRaster >= 48 && meta.initRaster < 202) ship.irq202();

const FILES = [['low', 0x0000], ['mid', 0x0977], ['v1', 0x1190], ['v2', 0x2805], ['v3', 0x3B99], ['v4', 0x4C4B], ['v5', 0x4F00], ['hook', 0x6000], ['lv', 0x7A00]];
function original(f) {
  const files = [];
  for (const [n, a] of FILES) {   // M3 recordings have no v5/lv
    try { files.push([a, readFileSync(`${where}/f${String(f).padStart(5, '0')}_${n}.bin`)]); } catch (e) { /* absent */ }
  }
  return (addr) => { for (const [a, b] of files) if (addr >= a && addr < a+b.length) return b[addr-a]; return -1; };
}
const hex = (v) => v < 0 ? '--' : v.toString(16).padStart(2, '0');
let done = 0;
for (let f = from; f <= to; f++) {
  while (done < f-1) { ship.frame(); done++; }
  let o;
  try { o = original(f); } catch (e) { console.log(`f${f}: no sample`); continue; }
  const line = addrs.map(a => { const g = ship.ram[a], w = o(a); return `${a.toString(16)}:${hex(g)}${g !== w && w >= 0 ? '/' + hex(w) : ''}`; });
  let bank = null;
  try { bank = readFileSync(`${where}/f${String(f).padStart(5, '0')}_bank.bin`); } catch (e) { /* absent */ }
  for (const [row, col] of cells) {
    const i = row*40+col, g = ship.scroll.screen[i], w = bank ? bank[0x600+i] : -1;
    line.push(`[${row},${col}]:${hex(g)}${g !== w && w >= 0 ? '/' + hex(w) : ''}`);
  }
  console.log(`f${f} shifted=${ship.shifted ? 1 : 0} ${line.join(' ')}`);
}
