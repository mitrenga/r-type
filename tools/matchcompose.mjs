#!/usr/bin/env node
/**
 * matchcompose — the level loader's picture against the recorded frames of M1, pixel by pixel.
 *
 * `app/levelLoader.js` composes the level from the worker's memory with the
 * raster splits of the interrupt chain written as **data** (which set from
 * which line and pixel, the scroll, the 38 columns, the panel). M1 measured
 * those splits store by store (`tools/mkscreen.py`, `app/screenLoader.js`,
 * `tools/matchscreen.mjs`: 0 differences against VICE). This tool holds the
 * two together: for every recorded frame of `build/screens/` it composes
 * the same memory both ways — `ScreenLoader` from the recorded stores,
 * `LevelLoader` from the state the worker would send (the fine scroll from
 * the frame's `$D016` store, `$D018` of the upper band from its `$D018`
 * store at the top) — with the recorded character sets, and compares the
 * pixels. Sprites are left out of both, and frames in which the original
 * wrote into the screen or colour RAM while the beam ran (a column shift)
 * are skipped — there the picture is not one memory.
 *
 * ★ It exists because of a mistake it would have caught: the loader took
 * `$64` as the upper set in every level, while `$0D0C` does so in level 2
 * only — level 1 showed its ceiling with the lower set, unflipped
 * (operator, 2026-10-18).
 *
 *     tools/matchcompose.mjs [--dir build/screens] [--verbose]
 */
import '../app/svision/tools/nodeEnv.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const { C64Charset } = await import('../app/svision/js/platform/canvas2D/c64/c64Charset.js');
const { LevelLoader } = await import('../app/levelLoader.js');
const { ScreenLoader } = await import('../app/screenLoader.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const dir = opt('--dir', 'build/screens');
const verbose = args.includes('--verbose');
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

const files = {};
for (const name of ['levels', 'charsets', 'texts', 'global']) files[name] = JSON.parse(readFileSync(`data/${name}.json`, 'utf8'));
const loader = new LevelLoader(files);

let frames = 0, checks = 0, diffs = 0, skipped = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  // ★ a frame with a store into the playfield's screen or colour RAM while the beam ran (a column
  // shift) is what memory held row by row — the worker's memory is one moment, so it is not compared
  const inScreen = (w) => { const a = parseInt(w.addr, 16); return (a >= 0xCC00 && a < 0xCEF8) || (a >= 0xD800 && a < 0xDAF8); };
  if (d.writes.some(inScreen)) { skipped++; if (verbose) console.log(`${f.padEnd(12)} stores into the screen during the frame, skipped`); continue; }
  // frames recorded before the tools went English still say `úroveň N` in `source`; both forms are read
  const level = /(?:úroveň|level) (\d)/.exec(d.source || '') ? +/(?:úroveň|level) (\d)/.exec(d.source)[1] : 1;
  const sl = new ScreenLoader(d);
  const ref = sl.build();
  const bank = sl.bank;
  // the sets the chip read in this frame, instead of the data's (the stars move)
  loader.fonts[level] = {upper: new C64Charset(bank.subarray(0, 0x800)), lower: new C64Charset(bank.subarray(0x2000, 0x2800))};
  loader.panelFont = new C64Charset(bank.subarray(0x800, 0x1000));
  const d016 = d.writes.find(w => w.addr === 'D016');
  // ★ the two $D018 of the playfield: the top's ($0D0C, raster 48) and the band's at raster 119 ($1066: $64)
  const d018 = d.writes.find(w => w.addr === 'D018' && w.line < 68);
  const band = d.writes.find(w => w.addr === 'D018' && w.line >= 68 && w.line < 150);
  const frame = {screen: bank.subarray(0xC00, 0xC00+1000), color: Uint8Array.from(d.colorRAM),
                 fine: d016 ? d016.value & 7 : d.vic[0x16] & 7, d018: d018 ? d018.value : 0x30,
                 reg64: band ? band.value : 0x38};
  const pic = loader.compose(level, frame);
  // the panel rows as the chip read them (the score, written during the frame, is M5)
  pic.textRAM.screen.set(ref.textRAM.screen.subarray(760), 760);
  pic.textRAM.colorRAM.set(ref.textRAM.colorRAM.subarray(760), 760);
  const a = new Uint32Array(320*200), b = new Uint32Array(320*200);
  pic.textRAM.paint32(a, pic.font, LE, {cursor: false});
  ref.textRAM.paint32(b, ref.font, LE, {cursor: false});
  let bad = 0;
  const lines = {};
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; const y = (i/320) | 0; lines[y] = (lines[y] || 0)+1; }
  frames++; checks += a.length; diffs += bad;
  if (bad || verbose) console.log(`${f.padEnd(12)} level ${level}  differences ${bad}${bad ? '  lines ' + Object.entries(lines).slice(0, 12).map(([y, n]) => `${y}:${n}`).join(' ') : ''}`);
}
console.log(`matchcompose: ${frames} frames, ${checks} pixels, ${diffs} differences (${skipped} frames with mid-frame screen stores skipped)`);
process.exit(diffs ? 1 : 0);
