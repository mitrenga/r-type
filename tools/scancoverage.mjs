#!/usr/bin/env node
/**
 * scancoverage — what the recordings of M4 cover, so that a zero of
 * `matchenemies.mjs` proves something.
 *
 * Runs the remake (`app/enemies.js`, `app/levelCode.js`) over every recording
 * of `build/enemies/` the way `matchenemies.mjs` does (the init dump, the
 * measured shift timing) and counts, by level, what the original's code was
 * made to do: every enemy type launched (`$505E`, the type from the wave
 * table), every path command (`$053C`/`$05A5`: $D3-$D6), the ground probe,
 * the crossings between the groups of the multiplexer and the turns at a
 * full group, the enemies hit by each weapon (a shot, the beam, a laser, the
 * Force, a bit, the ship), deaths, carriers turned into items, formations,
 * the enemies' bullets, the bosses reached, hit on and off the weak spot,
 * killed, the ends of the levels — and the states of the shift the
 * handlers nested into.
 *
 *     tools/scancoverage.mjs                  # -> build/enemies/coverage.json and a table
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');

const LevelScroll = loadClassicScript(new URL('../app/levelScroll.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/sidPlayer.js', import.meta.url).pathname);   // M6: `Ship` constructs `SidPlayer`
const Ship = loadClassicScript(new URL('../app/ship.js', import.meta.url).pathname);
const Enemies = loadClassicScript(new URL('../app/enemies.js', import.meta.url).pathname);
loadClassicScript(new URL('../app/levelCode.js', import.meta.url).pathname);

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const dir = opt('--dir', 'build/enemies');
const levels = JSON.parse(readFileSync('data/levels.json', 'utf8'));
const shipData = JSON.parse(readFileSync('data/ship.json', 'utf8'));
const spritesData = JSON.parse(readFileSync('data/sprites.json', 'utf8'));

/** the counters of one level */
function fresh() {
  return {recordings: 0, frames: 0, types: {}, pathX: {}, pathY: {}, groundProbe: 0, groundY: 0, bandMoves: 0, bandTurns: 0,
          hits: {shot: 0, beam: 0, laser: 0, force: 0, bit: 0, ship: 0}, deaths: 0, carriers: 0, formations: 0, bullets: 0,
          launches: 0, lost: 0, boss: {reached: 0, hits: 0, weakHits: 0, killed: 0, parts: 0}, levelEnds: 0,
          shifts: {band5: {}, irq202: {}, tail: {}}};
}
const byLevel = {};
let current = null;

// --- the hooks into the remake's code: what ran
const proto = Enemies.prototype;
const wrap = (name, fn) => { const orig = proto[name]; proto[name] = function () { fn.apply(this, arguments); return orig.apply(this, arguments); }; };
const origSpawner = proto.spawner;
proto.spawner = function () {
  const r = this.ram, before = r[0x7A] | r[0x7B] << 8;
  const flagsBefore = Array.from(r.subarray(0x044C, 0x045B));
  origSpawner.call(this);
  const after = r[0x7A] | r[0x7B] << 8;
  for (let p = before; p < after; p += 2) {
    const type = r[p+1];
    if (type < 0x80) { current.types[type] = (current.types[type] || 0)+1; }
  }
  for (let x = 0; x < 15; x++) {
    if (flagsBefore[x] === 0 && r[0x044C+x] === 1) {
      current.launches++;
      current.pathX[r[0x053C+x].toString(16)] = (current.pathX[r[0x053C+x].toString(16)] || 0)+1;
      current.pathY[r[0x05A5+x].toString(16)] = (current.pathY[r[0x05A5+x].toString(16)] || 0)+1;
    }
  }
};
wrap('ground', function () { current.groundProbe++; });
wrap('groundY', function () { current.groundY++; });
const origBand = proto.bandMove;
proto.bandMove = function (x, y, vertical) {
  const taken = !vertical && this.ram[0x044C+y];
  if (taken) { current.bandTurns++; } else { current.bandMoves++; }
  return origBand.apply(this, arguments);
};
const origDamage = proto.damage;
proto.damage = function (x, by, belowOnly) {
  current.hits[by === 1 && !belowOnly ? 'shot' : by === 5 ? 'laser' : 'beam']++;
  return origDamage.apply(this, arguments);
};
const origDie = proto.die;
proto.die = function (x) {
  const r = this.ram, ptr = r[0xAF+x];
  current.deaths++;
  if (ptr === 0x78 || ptr === 0x79) { current.carriers++; }
  else if (r[0xBE+x] & 0x80) { current.formations++; }
  return origDie.apply(this, arguments);
};
const origShoot = proto.shoot;
proto.shoot = function (x) {
  const r = this.ram, before = r.subarray(0x02E5, 0x02EF).reduce((a, b) => a+b, 0);
  origShoot.apply(this, arguments);
  if (r.subarray(0x02E5, 0x02EF).reduce((a, b) => a+b, 0) > before) { current.bullets++; }
};
wrap('endObject', function () { current.boss.reached++; });
const origHit = proto.bossHit;
proto.bossHit = function (ch, y, p) {
  const r = this.ram, weak = (r[0x0416] & 0x80) !== 0 || r[0x0416] === r[0x58EF];
  current.boss.hits++;
  if (weak) { current.boss.weakHits++; }
  return origHit.apply(this, arguments);
};
wrap('bossPartHits', function () { current.boss.parts++; });
const origLose = proto.bossLoseHits;
proto.bossLoseHits = function (by) { const dying = origLose.apply(this, arguments); if (dying) { current.boss.killed++; } return dying; };
wrap('levelEnd', function () { current.levelEnds++; });
const origApply = Ship.prototype.advanceShift;
Ship.prototype.advanceShift = function (point) {
  if (this.scroll.shift && this.columnTiming) {
    const t = this.columnTiming[this.frameCount];
    const p = t && t[point] ? t[point].progress : null;
    const key = !p ? 'over' : p.copy !== 'done' ? `copy ${p.copy[0]}:${p.copy[1]}` : `${p.pointer ? 'pointer' : 'copied'} rows ${p.column || 0}`;
    const where = this.frameCount === this.shiftInfo.start ? 'F' : 'F+1';
    current.shifts[point][`${where} ${key}`] = (current.shifts[point][`${where} ${key}`] || 0)+1;
  }
  return origApply.apply(this, arguments);
};

function stateOf(ram) {
  const s = {pointer: ram[0x201] | ram[0x202] << 8, fine: ram[0x20C], counter: ram[0x36A8], running: ram[0x221], fineY: ram[0x20B], reg64: ram[0x64]};
  s.v = {colTick: ram[0x3AD6], phase: ram[0x3AD7], idxB: ram[0x3AD8], redraw: ram[0x3AD9], rowPtr: ram[0x3ADA] | ram[0x3ADB] << 8,
         cntA: ram[0x3ADC], tickA: ram[0x3ADD], repA: ram[0x3ADE], dirA: ram[0x3ADF], cntB: ram[0x3AE0], tickB: ram[0x3AE1], repB: ram[0x3AE2], dirB: ram[0x3AE3]};
  return s;
}

function scan(name) {
  const where = `${dir}/${name}`;
  if (!existsSync(`${where}/init_ram.bin`)) { return; }
  const meta = JSON.parse(readFileSync(`${where}/meta.json`, 'utf8'));
  current = byLevel[meta.level] = byLevel[meta.level] || fresh();
  current.recordings++;
  const init = new Uint8Array(readFileSync(`${where}/init_ram.bin`));
  const initIO = new Uint8Array(readFileSync(`${where}/init_io.bin`));
  const level = levels.levels[meta.level-1];
  const scroll = new LevelScroll();
  scroll.init(level, stateOf(init));
  const ship = new Ship(scroll);
  ship.loadData(shipData, spritesData);
  ship.load(init, initIO, level);
  ship.immortal = !!meta.immortal;
  if (existsSync(`${where}/timing.json`)) {
    const t = JSON.parse(readFileSync(`${where}/timing.json`, 'utf8')).shifts;
    ship.columnTiming = {};
    for (const f in t) { ship.columnTiming[+f] = t[f]; }
  }
  const toRaster48 = meta.initRaster < 48 ? (48-meta.initRaster)*63-meta.initCycle : 1e9;
  if (toRaster48 > 400) { ship.mainLoopPass(); }
  // M4: band 5 (the spawner) of the init frame ran before the first sample — only when the init lies between
  // raster 48 and band 5 (★ an init before raster 48 sees the first sample at raster 48 of the same frame)
  if (meta.initRaster >= 48 && meta.initRaster < 141) { ship.band5(); }
  if (meta.initRaster >= 48 && meta.initRaster < 202) { ship.irq202(); }
  const last = meta.recorded[meta.recorded.length-1];
  let done = 0;
  // the ship's own weapons and collisions as the enemies met them
  const hitsBefore = {...current.hits};
  const origCollision = ship.collision.bind(ship);
  ship.collision = function () { current.hits.ship++; return origCollision(); };
  while (done < last-1 && !ship.ready && !ship.levelOver) { ship.frame(); done++; }
  current.frames += done;
  void hitsBefore;
}

const names = readdirSync(dir).filter(n => /^l\d[a-z]$/.test(n)).sort();
for (const name of names) { scan(name); }
writeFileSync(`${dir}/coverage.json`, JSON.stringify(byLevel, null, 1));
const allTypes = new Set();
for (const lv in byLevel) { for (const t in byLevel[lv].types) { allTypes.add(+t); } }
console.log('level  rec  frames  types  launches  probes  moves/turns  hits shot/beam/laser/force+bit/ship  deaths carriers formations bullets  boss reached/hits/weak/parts/killed  ends');
for (const lv of Object.keys(byLevel).sort()) {
  const c = byLevel[lv], h = c.hits, b = c.boss;
  console.log(`${lv.padStart(5)}  ${String(c.recordings).padStart(3)}  ${String(c.frames).padStart(6)}  ${String(Object.keys(c.types).length).padStart(5)}  ${String(c.launches).padStart(8)}  ${String(c.groundProbe).padStart(6)}  ${String(c.bandMoves+'/'+c.bandTurns).padStart(11)}  ${String(h.shot+'/'+h.beam+'/'+h.laser+'/'+(h.force+h.bit)+'/'+h.ship).padStart(32)}  ${String(c.deaths).padStart(6)} ${String(c.carriers).padStart(8)} ${String(c.formations).padStart(10)} ${String(c.bullets).padStart(7)}  ${String(b.reached+'/'+b.hits+'/'+b.weakHits+'/'+b.parts+'/'+b.killed).padStart(34)}  ${String(c.levelEnds).padStart(4)}`);
}
console.log(`\nenemy types launched over all levels: ${allTypes.size} of 62 (the wave tables launch ${[...allTypes].length})`);
for (const lv of Object.keys(byLevel).sort()) {
  const c = byLevel[lv];
  console.log(`level ${lv}: path X ${JSON.stringify(c.pathX)}, path Y ${JSON.stringify(c.pathY)}, shifts at band 5 ${JSON.stringify(c.shifts.band5)}, at the raster-202 handler ${JSON.stringify(c.shifts.irq202)}`);
}
