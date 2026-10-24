#!/usr/bin/env node
/**
 * matchsound — the SID of the remake against the running original, write by
 * write: the tunes and the effects of whole games.
 *
 * The acceptance tool of M6. For every recording of `tools/tracerules.py`
 * that `tools/tracesound.py` went over again (`build/rules/l<level><scenario>/
 * sound.json`), it walks the recording with the walk of `matchrules.mjs` —
 * the remake's own code from the RAM at the first `$08C1`, stop by stop,
 * the measured races and layouts dosed in — and at every stop of a frame
 * (`$0DBA`), of READY (`$0BFF`) and of the level-end sequence (`$0A38`)
 * compares **what the remake's player wrote into `$D400`-`$D418` since the
 * last such stop** (`SidPlayer.take`, `app/sidPlayer.js`) with what the
 * original wrote between the same stops: the registers, the values and the
 * order, write for write. The stops of events (a death, READY entered, a
 * load…) only add their writes to the next comparison — a step of the
 * remake's main loop may cross several of them at once. At the end the
 * writes after the last compared stop are compared too (tapeEnd's `$D418`
 * ← 0 among them).
 *
 * ★ The **player's variables `$6370`-`$6475`** are compared at the same
 * stops (`s%06d_snd.bin`) — all but `$63C0`, which `$6379` stores from X and
 * nobody reads: in tapeEnd X is whatever the death left in it.
 *
 * ★ **The position of a write in the frame is a model, not a measurement**
 * (`Ship.MUSIC_LINES`, R-044), so it is not compared — but the recording
 * carries the raster line and the cycle of every write, and the tool prints
 * where they fell (the handler at line 204, READY at `$43`, the sequence at
 * `$FA`) so the model can be read against them.
 *
 *     tools/matchsound.mjs                        # every recording with a sound.json
 *     tools/matchsound.mjs --only l1r --verbose
 *     tools/matchsound.mjs --no-ram               # without the RAM comparison of matchrules (faster)
 *
 * ★ Two things the tool knows about the measurement: **a late snapshot** —
 * the monitor's `bsave` at a stop that a player's step follows within a few
 * lines (the end of a column shift's copy right after `$0DBA`) sometimes
 * saves the memory **after** that step, while the log of the writes is in
 * order (l1r s125: the variables one step ahead, no write between the
 * stops, the step's writes after the stop). Such a snapshot — the variables
 * differ at a stop whose interval has no write, and they agree again at the
 * next — is counted as `late`, not as a difference. A stop may also fall
 * **inside a step** (the shift's copy ends and the player is writing voice
 * 3 when the next raster-48 handler comes — l1s s77): the streams are
 * therefore compared as streams, what one side wrote before the stop waits
 * for the other side at the next. And **the walk's own
 * parting**: where `matchrules` finds the remake's RAM differing from the
 * original's (the open flights of M4/M5), the enemies die at other frames
 * and ask for other sounds — the writes after that stop are another game's
 * and are counted apart (`after the walk parted`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { matchRecording, counters, recordings } from './matchrules.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
/** the RAM comparison of matchrules rides along (default): where the remake's game parts from the original's, the sound is another game's too */
const withRam = !args.includes('--no-ram');
const dir = opt('--dir', 'build/rules');
const maxReport = +opt('--report', 12);
/** `--trace 120-130`: at these stops both sides' writes since the last compared stop and the tick/position of the player */
const trace = opt('--trace', '') ? opt('--trace').split('-').map(Number) : null;

const VARS_FROM = 0x6370, VARS_TO = 0x6476;
/** ★ `$63C0`: X of `$6379`, stored and never read */
const VARS_SKIP = [0x63C0];

let checks = 0, diffs = 0, totalWrites = 0, totalRecordings = 0;

function matchSound(name) {
  const where = `${dir}/${name}`;
  if (!existsSync(`${where}/sound.json`)) { return false; }
  const sound = JSON.parse(readFileSync(`${where}/sound.json`, 'utf8'));
  if (!sound.sameStops) { console.log(`${name}: the sound pass made other stops than the recording — run tracesound again`); diffs++; return true; }
  const before = checks, beforeDiffs = diffs, rulesBefore = counters().diffs;
  let ship = null, pending = [], compared = 0, writesOrig = 0, writesRemake = 0, varsChecked = 0, reported = 0, firstBad = null;
  const rasters = {top: [], frame: []};
  const regs = new Set();
  let filtered = 0, lastKind = 'top', dumped = false;
  let late = 0, suspect = null, parted = null, afterParted = 0;
  const report = (k, what, got, want) => {
    if (parted !== null) { afterParted++; return; }
    diffs++;
    if (firstBad === null) { firstBad = k; }
    if (reported < maxReport) { console.log(`    s${k} ${what}: got ${got} want ${want}`); reported++; }
  };
  const hex = (w) => w ? `$D4${w[0].toString(16).padStart(2, '0')}=${w[1].toString(16).padStart(2, '0')}` : '-';
  // ★ the two streams are compared as streams: a stop may fall **inside** a step of the player (the end
  // of a shift's copy writing voice 3 when the raster-48 handler of the next frame comes — l1s s77), so
  // the writes a step made before the stop stay queued until the other side catches up at the next one
  let queueRemake = [], queueOrig = [];
  const compareWrites = (k, final) => {
    const got = ship.sid ? ship.sid.take() : [];
    writesOrig += pending.length;
    writesRemake += got.length;
    for (const w of pending) {
      regs.add(w[0]);
      if (w[0] === 0x17 && (w[1] & 0x0F)) { filtered++; }
      if (w[3] !== undefined) { rasters[lastKind].push(w[3]); }
    }
    // (after the walk parted nothing is compared any more: the queues would only grow — a spread of a
    // huge array overflows the stack)
    if (parted !== null) { afterParted += Math.max(got.length, pending.length); pending = []; queueRemake = []; queueOrig = []; return 0; }
    for (const g of got) { queueRemake.push(g); }
    for (const w of pending) { queueOrig.push(w); }
    pending = [];
    const n = final ? Math.max(queueRemake.length, queueOrig.length) : Math.min(queueRemake.length, queueOrig.length);
    let bad = false;
    for (let i = 0; i < n; i++) {
      checks++;
      const g = queueRemake[i] ? [queueRemake[i][1], queueRemake[i][2]] : null, w = queueOrig[i] ? [queueOrig[i][0], queueOrig[i][1]] : null;
      if (!g || !w || g[0] !== w[0] || g[1] !== w[1]) { report(k, `write ${i} of ${n}`, hex(g), hex(w)); bad = true; }
    }
    if (bad && verbose && !dumped) {
      dumped = true;
      console.log(`    s${k} remake: ` + queueRemake.slice(0, n).map(g => hex([g[1], g[2]])).join(' '));
      console.log(`    s${k} original: ` + queueOrig.slice(0, n).map(w => hex(w) + '@' + w[2] + '/' + w[3]).join(' '));
      console.log(`    s${k} player vars: ` + Array.from(ship.ram.subarray(0x6380, 0x6400)).map(v => v.toString(16).padStart(2, '0')).join(' '));
    }
    queueRemake.splice(0, n);
    queueOrig.splice(0, n);
    // more than a step of the player queued on one side: the two are not just offset by a stop inside a step
    if (!final && (queueRemake.length > 60 || queueOrig.length > 60)) {
      report(k, `writes without a counterpart (remake ${queueRemake.length}, original ${queueOrig.length})`, queueRemake.length, queueOrig.length);
      queueRemake = []; queueOrig = [];
    }
    return queueRemake.length + queueOrig.length;
  };
  const compareVars = (k) => {
    const path = `${where}/s${String(k).padStart(6, '0')}_snd.bin`;
    if (!existsSync(path)) { return; }
    const b = readFileSync(path);
    const bad = [];
    for (let a = VARS_FROM; a < VARS_TO && a-VARS_FROM < b.length; a++) {
      if (VARS_SKIP.includes(a)) { continue; }
      checks++; varsChecked++;
      if (ship.ram[a] !== b[a-VARS_FROM]) { bad.push([k, `$${a.toString(16)}`, ship.ram[a].toString(16), b[a-VARS_FROM].toString(16)]); }
    }
    // ★ a suspected late snapshot: held back until the next stop decides (see the header)
    if (suspect) {
      if (bad.length) { for (const r of suspect) { report(...r); } } else { late++; }
      suspect = null;
    }
    // ★ any mismatch is first a suspect: the raster-48 handler may interrupt a step of the player (the end
    // of a shift's copy or of level 3's redraw running late — a new-rows step makes no write, so the
    // interval does not show it) and the stop sees the variables mid-step; the next stop decides
    if (bad.length) { suspect = bad; return; }
  };
  matchRecording(name, {
    ram: withRam, quiet: !withRam,
    setup(ctx) { ship = ctx.ship; if (ship.sid) { ship.sid.take(); } },
    atStop(st, kind) {
      // the walk parted here (the RAM comparison of matchrules): the sound after it is another game's
      if (withRam && parted === null && counters().diffs > rulesBefore) { parted = st.k; }
      for (const w of (sound.writes[String(st.k)] || [])) { pending.push(w); }
      if (trace && st.k >= trace[0] && st.k <= trace[1]) {
        const got = ship.sid ? ship.sid.writes : [];
        console.log(`    s${st.k} ${st.kind} f${st.frame} (remake f${ship.frameCount} ${ship.rules ? ship.rules.state : ''}): remake ${got.length} writes [${got.map(g => hex([g[1], g[2]])).slice(0, 6).join(' ')}…], `
                    + `original ${pending.length} [${pending.map(w => hex(w) + '@' + w[2] + '/' + w[3]).slice(0, 6).join(' ')}…]; $63F9 ${ship.ram[0x63F9]} $6380 ${ship.ram[0x6380]} $63B5 ${ship.ram[0x63B5]}`);
      }
      if (kind === 'event') { return; }
      lastKind = kind;
      compareWrites(st.k, false);
      // (a stop inside a step: the variables are mid-step on the original's side — decided by the next stop)
      compareVars(st.k);
      compared++;
    },
    finish() { if (suspect) { for (const r of suspect) { report(...r); } suspect = null; } compareWrites('end', true); }
  });
  totalRecordings++;
  totalWrites += writesOrig;
  const q = (xs) => xs.length ? `${Math.min(...xs)}-${Math.max(...xs)} (median ${xs.slice().sort((a, b) => a-b)[xs.length >> 1]})` : '-';
  const rulesDiffs = counters().diffs-rulesBefore;
  console.log(`${name}: level ${sound.level} ${sound.scenario}, ${compared} stops compared, ${writesOrig} writes (remake ${writesRemake}), `
              + `${varsChecked} variable checks, ${checks-before} checks, ${diffs-beforeDiffs} differences`
              + (firstBad !== null ? ` (first at s${firstBad})` : '')
              + (late ? `, ${late} snapshots late or inside a step` : '')
              + (parted !== null ? `; the walk parted at s${parted} (${rulesDiffs} RAM differences), ${afterParted} sound differences after it not counted` : '')
              + `; registers ${[...regs].sort((a, b) => a-b).map(r => r.toString(16).padStart(2, '0')).join(' ')}`
              + `; filter routed ${filtered}`
              + (verbose ? `; rasters in play ${q(rasters.top)}, in READY/sequence ${q(rasters.frame)}` : ''));
  return true;
}

let any = false;
for (const name of recordings()) {
  any = matchSound(name) || any;
}
if (!any) { console.log('matchsound: no sound.json in ' + dir + ' — tools/tracesound.py first'); }
const walk = counters().diffs;
console.log(`\nmatchsound: ${totalRecordings} recordings, ${totalWrites} writes, ${checks} checks, ${diffs} differences` + (walk ? ` (the walk itself: ${walk} RAM differences, matchrules)` : ''));
process.exit(diffs ? 1 : 0);
