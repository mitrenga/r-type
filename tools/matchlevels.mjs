#!/usr/bin/env node
/**
 * matchlevels — the level built and scrolled by the remake, against the memory of the running original.
 *
 * The acceptance tool of M2. For every level it takes what
 * `tools/tracelevels.py` recorded — the RAM at the first `$08C1` (the level
 * loaded and initialised) and samples at `$0D04` every N frames: screen RAM,
 * colour RAM and the game's state — and runs **the game's own code**
 * (`app/levelScroll.js`, a classic worker script loaded through
 * `classicScript.cjs`) on `data/levels.json`:
 *
 * 1. **the map**: `$9A00`-`$BFFF` as `$162F` built it, up to the level's end
 *    pointer (what lies past it is never read, and the memory there is
 *    whatever was left);
 * 2. **the first screen**: rows 0-18 of screen and colour RAM as `$11A2`
 *    drew them;
 * 3. **every sample**: the scroll stepped as many frames as the original
 *    had — rows 0-18 of both RAMs and the counters (`$0201/$0202`, `$020C`,
 *    `$36A8`, `$0221`; level 3's `$020B` and `$3AD6`-`$3AE3`).
 *
 * ★ The number of steps to a sample follows from how VICE counts: `ignore N`
 * skips N hits, so sample k is hit k×(N+1) of `$0DBA` — and the step of a
 * frame runs right after that instruction, so hit h sees h − 1 steps and the
 * previous step is always complete (`tools/tracelevels.py`).
 *
 * The counters at the init are the original's (it ran a frame or two
 * before `$08C1`); the remake starts from the fresh ones of `$14FF`.
 *
 *     tools/matchlevels.mjs                  # all levels in build/levels/
 *     tools/matchlevels.mjs --level 1 --verbose
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');

const LevelScroll = loadClassicScript(new URL('../app/levelScroll.js', import.meta.url).pathname);

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const only = opt('--level') ? +opt('--level') : null;
const dir = opt('--dir', 'build/levels');

const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const MAP = 0x9A00, SCREEN = 0xCC00, COLOR = 0xD800, ROWS = 19;

let checks = 0, diffs = 0;
function check(what, got, want, mask) {
  let bad = 0, first = null;
  for (let i = 0; i < want.length; i++) {
    if (mask && !mask(i)) continue;
    checks++;
    if (got[i] !== want[i]) { diffs++; bad++; if (first === null) first = i; }
  }
  if (bad && verbose) console.log(`    DIFF ${what}: ${bad} bytes, first at ${first} (got ${got[first]}, want ${want[first]})`);
  return bad;
}

/** the original's counters out of a state page and the $3600 page */
function stateOf(page, vars) {
  const s = {pointer: page[0x201] | page[0x202] << 8, fine: page[0x20C], counter: vars[0xA8],
             running: page[0x221], fineY: page[0x20B], reg64: page[0x64]};
  s.v = {colTick: vars[0x4D6], phase: vars[0x4D7], idxB: vars[0x4D8], redraw: vars[0x4D9],
         rowPtr: vars[0x4DA] | vars[0x4DB] << 8, cntA: vars[0x4DC], tickA: vars[0x4DD], repA: vars[0x4DE],
         dirA: vars[0x4DF], cntB: vars[0x4E0], tickB: vars[0x4E1], repB: vars[0x4E2], dirB: vars[0x4E3]};
  return s;
}

function matchLevel(n) {
  const where = `${dir}/l${n}`;
  if (!existsSync(`${where}/init_ram.bin`)) { console.log(`level ${n}: no recording in ${where}`); return; }
  const meta = JSON.parse(readFileSync(`${where}/meta.json`, 'utf8'));
  const init = readFileSync(`${where}/init_ram.bin`);
  const initIO = readFileSync(`${where}/init_io.bin`);
  const level = levels.levels[n-1];
  const ls = new LevelScroll();
  const initState = stateOf(init, init.subarray(0x3600, 0x3C00));
  ls.init(level, initState);
  const before = checks, beforeDiffs = diffs;

  // 1. the map, up to the end pointer (level 3: the whole buffer)
  if (level.vertical) {
    check('buffer', ls.map.subarray(0, 0x1A00), init.subarray(MAP, MAP+0x1A00));   // the 26 pages $12BB clears
  } else {
    const end = parseInt(level.end.slice(1), 16)-MAP;
    for (let row = 0; row < ROWS; row++) {
      check(`map row ${row}`, ls.map.subarray(row*512, row*512+end), init.subarray(MAP+row*512, MAP+row*512+end));
    }
  }
  // 2. the first screen (level 3: cleared, its colour RAM is what the machine had — the first
  //    redraw writes columns 0-38, column 39 never)
  const cols = level.vertical ? (i => i % 40 < 39) : null;
  check('first screen', ls.screen.subarray(0, ROWS*40), init.subarray(SCREEN, SCREEN+ROWS*40));
  if (!level.vertical) {
    check('first colours', ls.color.subarray(0, ROWS*40), Uint8Array.from(initIO.subarray(0x800, 0x800+ROWS*40), v => v & 15));
  }

  // 3. the samples
  const files = readdirSync(where).filter(f => /^s\d+_state\.bin$/.test(f)).sort();
  const hitsPerSample = meta.every+1;
  // ★ samples at $0DBA see hit-1 steps whatever the init raster; the older $0D04 recordings depended on it
  const extra = meta.sampleAt === '$0DBA' ? 0 : (meta.initRaster >= 48 && meta.initRaster < 142) ? 1 : 0;
  let stepped = 0, samples = 0, afterEnd = 0;
  for (const f of files) {
    const k = files.indexOf(f)+1;
    const steps = k*hitsPerSample-1+extra;
    while (stepped < steps) { ls.step(); stepped++; }
    if (!ls.running) {
      // ★ past the end pointer the scroll is the level's own code: the hook re-arms it (levels 6, 7)
      // and the last shift's nested interrupt counts one more frame — bosses, M4
      afterEnd++;
      continue;
    }
    const page = readFileSync(`${where}/${f}`);
    const vars = readFileSync(`${where}/${f.replace('state', 'vars')}`);
    const bank = readFileSync(`${where}/${f.replace('state', 'bank')}`);
    const color = readFileSync(`${where}/${f.replace('state', 'color')}`);
    const want = stateOf(page, vars);
    const got = ls.state();
    const label = `sample ${k} (${steps} steps)`;
    let bad = 0;
    bad += check(`${label} screen`, ls.screen.subarray(0, ROWS*40), bank.subarray(0xC00, 0xC00+ROWS*40), cols);
    bad += check(`${label} colours`, ls.color.subarray(0, ROWS*40), Uint8Array.from(color.subarray(0, ROWS*40), v => v & 15), cols);
    const keys = ['pointer', 'fine', 'counter', 'running', 'reg64'].concat(level.vertical ? ['fineY'] : []);
    bad += check(`${label} counters`, keys.map(x => got[x]), keys.map(x => want[x]));
    if (level.vertical) {
      const vk = Object.keys(want.v);
      bad += check(`${label} level-3 state`, vk.map(x => got.v[x]), vk.map(x => want.v[x]));
    }
    if (bad && verbose) console.log(`    ${label}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
    samples++;
  }
  console.log(`level ${n}: ${samples} samples, ${stepped} frames, ${checks-before} checks, ${diffs-beforeDiffs} differences`
              + (level.vertical ? ' (vertical)' : ` (${level.columns} columns)`)
              + (afterEnd ? `, ${afterEnd} samples past the end not compared` : ''));
}

for (let n = 1; n <= 8; n++) {
  if (only && n !== only) continue;
  matchLevel(n);
}
console.log(`\nmatchlevels: ${checks} checks, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
