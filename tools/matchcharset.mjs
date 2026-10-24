#!/usr/bin/env node
/**
 * matchcharset — the character sets from the tape against the memory of the running original.
 *
 * `data/charsets.json` comes from the tape (`tools/dumpcharset.py`: the
 * level's `G` and `S`, side A's `M`, laid out as the loader and `$1794` /
 * `$11FA` lay them out). This tool compares every set with the RAM of every
 * level at its first `$08C1` (`tools/tracelevels.py`, `build/levels/lN/
 * init_ram.bin`): `$C000` (upper playfield), `$E000` (lower), `$C800`
 * (panel). As in `matchimage`, **every differing byte must be named**:
 *
 * - the level init's clearing and seeding of the star glyphs `$AF`-`$BF`
 *   (levels 1 and 4) is **in the data** (`dumpcharset.py`, `INIT`); what the
 *   level's hook then does to them every frame from `$DC04` is not — so in
 *   levels 1, 2, 4 and 7, whose hooks had run by `$08C1` (4 to 96 bytes
 *   moved), those glyphs are named;
 * - the panel set's glyphs `$FC`-`$FF` (`$CBE1`-`$CBFF`) lie **past the end
 *   of the side A file** and hold whatever RAM held;
 * - level 6's `S` is 1 280 B: its lower set past glyph `$9F` is whatever the
 *   level before left there (`lowerInFile`);
 * - level 6's hook `$9286` rolls glyphs `$80`-`$8F` of the upper set every
 *   frame (`$929C`-`$92D5`, `ROL $C400,X` …) — an animation, not data.
 *
 * Everything else must be equal, byte for byte.
 *
 *     tools/matchcharset.mjs [--dir build/levels] [--verbose]
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const dir = opt('--dir', 'build/levels');

const data = JSON.parse(readFileSync('data/charsets.json', 'utf8'));
const UPPER = 0xC000, LOWER = 0xE000, PANEL = 0xC800;
const STARS = [0xAF*8, 0xC0*8];            // the star glyphs, both sets
const PANEL_PAST_FILE = 0x3E1;             // $CBE1-$CBFF

let checks = 0, diffs = 0, named = 0;
function compare(what, want, got, isNamed) {
  let bad = 0, first = null;
  for (let i = 0; i < want.length; i++) {
    if (isNamed && isNamed(i)) { named++; continue; }
    checks++;
    if (want[i] !== got[i]) { bad++; diffs++; if (first === null) first = i; }
  }
  if (bad || verbose) console.log(`  ${what}: ${want.length} B, ${bad} differences${bad ? ` (first at +$${first.toString(16)})` : ''}`);
}

for (const lv of data.levels) {
  const n = lv.level;
  const file = `${dir}/l${n}/init_ram.bin`;
  if (!existsSync(file)) { console.log(`level ${n}: no ${file}`); continue; }
  const ram = readFileSync(file);
  console.log(`level ${n}:`);
  const rolled = n === 6 ? [0x80*8, 0x90*8] : [0, 0];   // level 6: $929C
  const animated = n === 1 || n === 2 || n === 4 || n === 7;   // $940A/$945C, $943B ($947A), $918D, $93B6: the hook moved the stars by $08C1 (4-96 B)
  const stars = (i) => animated && i >= STARS[0] && i < STARS[1];
  compare('upper set $C000', Uint8Array.from(lv.upper.bytes), ram.subarray(UPPER, UPPER+0x800),
          i => stars(i) || (i >= rolled[0] && i < rolled[1]));
  compare('lower set $E000', Uint8Array.from(lv.lower.bytes), ram.subarray(LOWER, LOWER+0x800),
          i => stars(i) || i >= lv.lowerInFile);
  compare('panel set $C800', Uint8Array.from(data.panel.bytes), ram.subarray(PANEL, PANEL+0x400),
          i => i >= PANEL_PAST_FILE);
  compare('shared glyphs $C600', Uint8Array.from(data.shared.bytes), ram.subarray(UPPER+0x600, UPPER+0x800));
}
console.log(`\nmatchcharset: ${checks} checks, ${diffs} differences (${named} bytes named as run-time)`);
process.exit(diffs ? 1 : 0);
