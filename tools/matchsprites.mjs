#!/usr/bin/env node
/**
 * matchsprites — the sprite blocks from the tape against the memory of the running original.
 *
 * `data/sprites.json` comes from the tape (`tools/dumpsprites.py`: side A's
 * `M` at `$8E53` as `$1794` copies it to `$D000`, the level's `S` from
 * `$E800`). This tool compares every block with the RAM under the I/O and
 * the KERNAL of every level at its first `$08C1` (`tools/tracelevels.py`),
 * and decodes each with `C64SpriteData` to show the library reads the
 * same shape (24 × 21, hires or multicolour by the sprite's `$D01C` bit —
 * the game sets all eight multicolour, `$1416`).
 *
 * ★ Named differences: the init `$1425` clears thirty bytes in each of ten
 * places of `$D000`-`$D27E` (the ship is composed there at run time, M3),
 * so blocks `$40`-`$49` are compared outside those; `$FD40`-`$FF3F`
 * (`$124B`) is not data at all.
 *
 *     tools/matchsprites.mjs [--dir build/levels] [--verbose]
 */
import { readFileSync, existsSync } from 'node:fs';
import '../app/svision/tools/nodeEnv.mjs';
const { C64SpriteData } = await import('../app/svision/js/platform/canvas2D/c64/c64SpriteData.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const dir = opt('--dir', 'build/levels');

const data = JSON.parse(readFileSync('data/sprites.json', 'utf8'));
// ★ $1439-$1454: STA $D000,X / $D061,X / $D080,X / $D0E1,X / $D100,X / $D161,X / $D180,X / $D1E1,X / $D200,X / $D261,X for X = $1D..0
const CLEARED = [0xD000, 0xD061, 0xD080, 0xD0E1, 0xD100, 0xD161, 0xD180, 0xD1E1, 0xD200, 0xD261].map(a => [a, a+0x1E]);
const cleared = (a) => CLEARED.some(([lo, hi]) => a >= lo && a < hi);

let checks = 0, diffs = 0, named = 0, decoded = 0;
function compareBlock(ram, b, what) {
  const at = parseInt(b.addr.slice(1), 16);
  let bad = 0;
  for (let i = 0; i < 63; i++) {
    if (cleared(at+i)) { named++; continue; }
    checks++;
    if (b.bytes[i] !== ram[at+i]) { bad++; diffs++; }
  }
  if (bad) console.log(`  DIFF ${what} block ${b.pointer} at ${b.addr}: ${bad} bytes`);
  // the library reads the shape and writes it back unchanged
  const grid = C64SpriteData.decode(Uint8Array.from(b.bytes.slice(0, 63)), {multicolor: true});
  const back = C64SpriteData.encode(grid, {multicolor: true});
  checks++;
  if (back.length !== 63 || back.some((v, i) => v !== b.bytes[i])) { diffs++; console.log(`  DIFF ${what} block ${b.pointer}: C64SpriteData round trip`); }
  decoded++;
}

for (const lv of data.levels) {
  const n = lv.level;
  const file = `${dir}/l${n}/init_ram.bin`;
  if (!existsSync(file)) { console.log(`level ${n}: no ${file}`); continue; }
  const ram = readFileSync(file);
  const before = diffs;
  for (const b of data.globalBlocks.blocks) compareBlock(ram, b, `level ${n} global`);
  for (const b of lv.blocks) compareBlock(ram, b, `level ${n}`);
  console.log(`level ${n}: ${data.globalBlocks.blocks.length} global + ${lv.blocks.length} level blocks, ${diffs-before} differences`);
}
console.log(`\nmatchsprites: ${checks} checks, ${diffs} differences (${decoded} blocks decoded, ${named} bytes named as run-time)`);
process.exit(diffs ? 1 : 0);
