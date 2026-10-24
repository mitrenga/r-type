// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The enemies, their waves, the multiplexer's slots and the bosses — the
 * original's code, routine by routine (`sources/docs/disasm_notes.md` §12,
 * `sources/asm/main.asm`, `sources/asm/level<N>.asm`):
 *
 * - the **spawner `$4FA8`** (band 5 of the interrupt chain, raster 141):
 *   the wave table's `column, type` pairs against the map pointer, a slot
 *   of the multiplexer by the enemy's Y (three groups of five), the type's
 *   tables of `M` copied into the slot;
 * - the **state machine `$518D`** right after it: per slot the X path, the
 *   ground probe, the animation, the Y path, the crossing between the
 *   groups of the multiplexer — and what happens when the target group is
 *   full (the enemy turns around);
 * - the **enemy loop `$17FB`** (tail of the raster-48 handler): the enemy
 *   shooting, the Force, the bits and the ship against every slot, the
 *   trail of ground enemies, the player's shots found in the screen around
 *   the enemy, hits, deaths, carriers turned into items;
 * - the **boss `$56CF`-`$5E46`**: an object of 5 × 7 sprites on its own
 *   raster chain, hit by the shots in the screen, its weak spot, its death
 *   and the end of the level, with the level's own step in `M`.
 *
 * ★ The variables live where the original keeps them — in the {@link Ship}'s
 * flat `ram` (which from M4 reaches `$9A00`: the tables of `M` and the
 * level's code variables are at their addresses too). `tools/matchenemies.mjs`
 * compares the same bytes with the running original, frame by frame.
 *
 * @constructor
 * @param {Ship} ship - The ship, whose memory this is.
 */
function Enemies(ship) {
  this.ship = ship;
  this.ram = ship.ram;
  /** the level's boss step in `M`, by level index (set by the level code, M4) */
  this.levelCode = null;
} // Enemies

/** slots of the multiplexer: 15 = 3 groups × sprites 3-7 */
Enemies.SLOTS = 15;

// ---------------------------------------------------------------- the spawner

/**
 * ★ `$5112`, `$513B`, `$5164`: six bytes of a path (`$7C`, `$7E`, `$80`)
 * into the slot's state.
 */
Enemies.prototype.copyPath1 = function (x) {
  var r = this.ram, p = r[0x7C] | r[0x7D] << 8;
  r[0x053C+x] = r[p]; r[0x054B+x] = r[0x055A+x] = r[p+1]; r[0x0569+x] = r[p+2];
  r[0x0578+x] = r[p+3]; r[0x0587+x] = r[p+4]; r[0x0596+x] = r[p+5];
}; // copyPath1
Enemies.prototype.copyPath2 = function (x) {
  var r = this.ram, p = r[0x7E] | r[0x7F] << 8;
  r[0x05A5+x] = r[p]; r[0x05B4+x] = r[0x05C3+x] = r[p+1]; r[0x05D2+x] = r[p+2];
  r[0x05E1+x] = r[p+3]; r[0x05F0+x] = r[p+4]; r[0x05FF+x] = r[p+5];
}; // copyPath2
Enemies.prototype.copyPath3 = function (x) {
  var r = this.ram, p = r[0x80] | r[0x81] << 8;
  r[0x060E+x] = r[0x061D+x] = r[p]; r[0x062C+x] = r[p+1]; r[0x063B+x] = r[p+2];
  r[0x064A+x] = r[p+3]; r[0x0659+x] = r[p+4]; r[0x0668+x] = r[p+5];
}; // copyPath3

/**
 * ★ `$4FA8`: the wave spawner, once a frame from band 5 (`$1166`) — every
 * pair of the wave table whose column is the map pointer's low byte
 * launches an enemy (or the end object, or moves `$0235`); then the state
 * machine. The band of the new enemy comes from its Y against `$023C` and
 * `$023F`, the slot round-robin from `$56CC`-`$56CE`; a taken slot means
 * the wave is lost (no retry).
 */
Enemies.prototype.spawner = function () {
  var r = this.ram, s = this.ship;
  for (;;) {
    if (r[0x0236]) { break; }
    var p = r[0x7A] | r[0x7B] << 8;
    if (r[p] !== r[0x0201]) { break; }
    var y = r[p+1];
    p = (p+2) & 0xFFFF;
    r[0x7A] = p & 0xFF; r[0x7B] = p >> 8;
    if (y & 0x80) {
      if (y < 0xFB) { this.endObject(y); return; }
      if (y === 0xFF) { r[0x0235] = (r[0x0235]+1) & 0xFF; break; }
      if (y === 0xFE) { r[0x0235] = (r[0x0235]-1) & 0xFF; break; }
    }
    // $4FE6: the Y, fixed or random
    var a;
    if (r[0x7B14+y] === 0xD3) {
      a = r[0x7BCE+y];
    } else {
      a = ((s.rnd() & r[0x7C0C+y])+r[0x7BCE+y]) & 0xFF;
      if (a === 0) { a = r[0x7BCE+y]; }
    }
    r[0x505F] = a;
    // $4FFF: the slot
    var x;
    if (r[0x0235]) {
      for (x = 4; x >= 0; x--) { if (r[0x044C+x] === 0) { break; } }
      if (x < 0) { break; }
    } else if (a < r[0x023C]) {
      x = r[0x56CC];
      if (x & 0x80) { x = 4; }
      r[0x56CC] = (x-1) & 0xFF;
      if (r[0x044C+x]) { break; }
    } else if (a < r[0x023F]) {
      x = r[0x56CD];
      if (x === 4) { x = 9; }
      r[0x56CD] = (x-1) & 0xFF;
      if (r[0x044C+x]) { break; }
    } else {
      x = r[0x56CE];
      if (x === 9) { x = 14; }
      r[0x56CE] = (x-1) & 0xFF;
      if (r[0x044C+x]) { break; }
    }
    // $505E: the launch
    r[0xA0+x] = r[0x505F];
    r[0xBE+x] = r[0x7C4A+y];
    r[0x045B+x] = r[0x7C88+y];
    r[0x046A+x] = y;
    r[0x044C+x] = (r[0x044C+x]+1) & 0xFF;
    r[0x02C6+x] = 0xD3;
    r[0x0479+x] = 0;
    if (r[0x7AD6+y] === 0xD3) {
      r[0x82+x] = r[0x7B52+y];
      r[0x91+x] = r[0x7B90+y] ? r[0x56BD+x] : 0;
    } else {
      var v = (s.rnd() & 0x7F)+r[0x7B52+y];
      r[0x82+x] = v & 0xFF;
      if (v > 0xFF) { r[0x91+x] = r[0x56BD+x]; } else { r[0x91+x] = r[0x7B90+y] ? r[0x56BD+x] : 0; }
    }
    r[0x7C] = r[0x0488+x] = r[0x0497+x] = r[0x7CC6+y];
    r[0x7D] = r[0x04A6+x] = r[0x04B5+x] = r[0x7D04+y];
    r[0x7E] = r[0x04C4+x] = r[0x04D3+x] = r[0x7D42+y];
    r[0x7F] = r[0x04E2+x] = r[0x04F1+x] = r[0x7D80+y];
    r[0x80] = r[0x0500+x] = r[0x050F+x] = r[0x7DBE+y];
    r[0x81] = r[0x051E+x] = r[0x052D+x] = r[0x7DFC+y];
    this.copyPath1(x); this.copyPath2(x); this.copyPath3(x);
    if (r[0xBE+x] & 0x80) { r[0x5111] = (r[0x5111]+1) & 0xFF; continue; }   // $50FD: a formation: the next pair at once
    if (r[0x5111]) { r[0x5111] = 0; return; }                               // $5103: the formation is complete — no state machine this frame
    break;
  }
  this.stateMachine();
}; // spawner

/** ★ `$5215`: a slot freed (the sprite parked at Y $64). */
Enemies.prototype.kill = function (x) {
  var r = this.ram;
  r[0x82+x] = 0; r[0x91+x] = 0; r[0x044C+x] = 0; r[0xA0+x] = 0x64;
}; // kill

/**
 * ★ `$518D`: the state machine over the fifteen slots, from the last. An
 * exploding slot (`$80`) animates its pointer until `$65` (`$6D` for the
 * `$0587` = 2 kind) and frees itself; an active one runs its X path, the
 * ground probe, the animation and the Y path — every path a script of six
 * bytes reloaded from `M` when its count runs out.
 */
Enemies.prototype.stateMachine = function () {
  var r = this.ram, nest = this.irqNest;
  // ★ the raster-202 handler nests into the state machine when it runs past raster 202 (measured:
  // `irq202InBand5` — the PC and the slot in hand): the slots after it see the handler's work. By
  // slots: before slot x when the handler came in its search ($518F) or its X path, else after it.
  var at = nest && nest.pc >= 0x518D ? nest.x : -2, before = nest && nest.pc < 0x5225;
  if (nest && nest.pc < 0x518D && !this.irqYielded) { this.irqYielded = true; this.irqOnNest(); }   // inside the spawner: after it
  for (var x = 14; x >= 0; x--) {
    if (x === at && before && !this.irqYielded) { this.irqYielded = true; this.irqOnNest(); }
    if (x === at+1 && !before && !this.irqYielded) { this.irqYielded = true; this.irqOnNest(); }
    var f = r[0x044C+x];
    if (f & 0x80) {
      r[0x060E+x] = (r[0x060E+x]-1) & 0xFF;
      if (r[0x060E+x]) { continue; }
      r[0xAF+x] = (r[0xAF+x]+1) & 0xFF;
      var limit = r[0x0587+x] === 2 ? 0x6D : 0x65;
      if (r[0xAF+x] < limit) { r[0x060E+x] = 3; } else { this.kill(x); }
      continue;
    }
    if (!f) { continue; }
    this.slotStep(x);
  }
  if (nest && at === 0 && !before && !this.irqYielded) { this.irqYielded = true; this.irqOnNest(); }
}; // stateMachine

/** `$51BF`: one active slot — the X path by its command, then the rest. */
Enemies.prototype.slotStep = function (x) {
  var r = this.ram, s = this.ship, cmd = r[0x053C+x];
  var state;
  if (cmd === 0xD4) {                                     // $5274: a random X direction
    r[0x0587+x] = (r[0x0587+x]-1) & 0xFF;
    if (r[0x0587+x]) {
      state = 'move';
    } else {
      r[0x0569+x] = (r[0x0569+x]-1) & 0xFF;
      if (!r[0x0569+x]) {
        state = this.segmentEnd1(x);
        if (state === 'dead') { return; }
        if (state === 'again') { state = 'normal'; }
      } else {
        var m = r[0x054B+x];
        r[0x0578+x] = (m & 0x80) ? ((s.rnd() & m) | 0x80) : (s.rnd() & m);
        r[0x0587+x] = s.rnd() & 0x1F;
        state = 'move';
      }
    }
  } else if (cmd === 0xD5) {                              // $52A4: X toward the ship
    r[0x52BD] = r[0x26] ? 1 : 0;
    r[0x52BF] = r[0x91+x] ? 1 : 0;
    var shipX = r[0x25] | r[0x52BD] << 8, ex = r[0x82+x] | r[0x52BF] << 8;
    if (shipX === ex) { state = 'anim'; }
    else {
      if (shipX < ex) { r[0x0578+x] |= 0x80; } else { r[0x0578+x] &= 0x7F; }
      state = 'tick';
    }
  } else if (cmd === 0xD6) {                              // $52E0: X steps from a table
    r[0x0569+x] = (r[0x0569+x]-1) & 0xFF;
    if (r[0x0569+x] & 0x80) {
      state = this.segmentEnd1(x);
      if (state === 'dead') { return; }
      if (state === 'again') { state = 'normal'; }
    } else {
      var yy = r[0x054B+x];
      r[0x054B+x] = (r[0x054B+x]+1) & 0xFF;
      r[0xCE] = r[0x0578+x]; r[0xCF] = r[0x0587+x];
      var v = r[(r[0xCE] | r[0xCF] << 8)+yy];
      if (v & 0x80) {
        if (!this.moveLeft(x, v)) { return; }
      } else {
        var sum = v+r[0x82+x];
        r[0x82+x] = sum & 0xFF;
        if (sum > 0xFF) { r[0x91+x] = r[0x56BD+x]; }
      }
      state = 'anim';
    }
  } else {
    state = 'normal';
  }
  if (state === 'normal') {                               // $51DB
    for (;;) {
      r[0x0569+x] = (r[0x0569+x]-1) & 0xFF;
      if (r[0x0569+x]) { break; }
      var end = this.segmentEnd1(x);
      if (end === 'dead') { return; }
      if (end === 'tick') { break; }
    }
    state = 'tick';
  }
  if (state === 'tick') {                                 // $5225
    r[0x055A+x] = (r[0x055A+x]-1) & 0xFF;
    if (r[0x055A+x]) { state = 'anim'; }
    else {
      r[0x055A+x] = r[0x054B+x];
      if (r[0x0587+x]) { this.ground(x); }
      state = 'move';
    }
  }
  if (state === 'move') {                                 // $523B
    var d = r[0x0578+x];
    if (d) {
      if (d & 0x80) {
        if (!this.moveLeft(x, d)) { return; }
      } else {
        if (r[0x91+x] && r[0x82+x] >= 0x58) { this.kill(x); return; }
        var t = r[0x82+x]+d;
        r[0x82+x] = t & 0xFF;
        if (t > 0xFF) { r[0x91+x] = r[0x56BD+x]; }
      }
    }
  }
  this.animStep(x);
}; // slotStep

/**
 * ★ `$51E0`: the X path's segment ran out — the next six bytes, or the
 * path's start again, or the end of the enemy (`$0596` negative).
 * @returns {string} 'dead' (the slot was freed), 'tick' (a ground enemy
 *          keeps its segment: on to `$5225`), 'again' (reloaded: `$51DB` counts again).
 */
Enemies.prototype.segmentEnd1 = function (x) {
  var r = this.ram, a = r[0x0596+x];
  if (a & 0x80) { this.kill(x); return 'dead'; }
  var p;
  if (a) {
    if (r[0x0587+x]) { return 'tick'; }                    // $5202
    p = r[0x0488+x] | r[0x04A6+x] << 8;
  } else {
    p = ((r[0x0497+x] | r[0x04B5+x] << 8)+6) & 0xFFFF;
  }
  r[0x7C] = r[0x0497+x] = p & 0xFF; r[0x7D] = r[0x04B5+x] = p >> 8;
  this.copyPath1(x);
  return 'again';
}; // segmentEnd1

/** ★ `$525E`: X moved left by the low seven bits of `d`; past the left edge the slot dies. */
Enemies.prototype.moveLeft = function (x, d) {
  var r = this.ram, a = d & 0x7F, old = r[0x82+x];
  r[0x82+x] = (old-a) & 0xFF;
  if (a <= old) { return true; }
  // the subtraction wrapped: the high bit goes, or the enemy is gone
  if (r[0x91+x] === 0) { this.kill(x); return false; }
  r[0x91+x] = 0;
  return true;
}; // moveLeft

/**
 * ★ `$5305`: the ground probe of an enemy that follows the terrain — the
 * cell two rows below (ahead by two columns when flying right) decides
 * whether to turn, with the third path moved by six bytes.
 */
Enemies.prototype.ground = function (x) {
  var r = this.ram, s = this.ship;
  var y = r[0x02C6+x];
  if (y & 0x80) { return; }
  if (r[0xA0+x] >= 0xB6) { return; }
  var p = ((r[0x02A8+x] | r[0x02B7+x] << 8)+0x50) & 0xFFFF;
  r[0xD8] = p & 0xFF; r[0xD9] = p >> 8;
  var turn, delta;
  if (r[0x0578+x] & 0x80) {
    if (!(s.flag(s.sc(p+y)) & 0x80)) { return; }
    r[0x0578+x] ^= 0x83;
    delta = 6;
  } else {
    if (!(r[0x91+x] && r[0x82+x] >= 0x58)) {
      y += 2;
      if (y >= 0x28) { return; }
      if (!(s.flag(s.sc(p+y)) & 0x80)) { return; }
    }
    r[0x0578+x] ^= 0x80;
    delta = -6;
  }
  var q = ((r[0x0500+x] | r[0x051E+x] << 8)+delta) & 0xFFFF;
  r[0x80] = r[0x0500+x] = r[0x050F+x] = q & 0xFF;
  r[0x81] = r[0x051E+x] = r[0x052D+x] = q >> 8;
  this.copyPath3(x);
  r[0x061D+x] = 1;
}; // ground

/** ★ `$539C`: the animation (the third path: the sprite pointer from a table), then the Y path. */
Enemies.prototype.animStep = function (x) {
  var r = this.ram;
  if (!r[0x0479+x]) {
    var reload = false;
    if (r[0x02C6+x] & 0x80) {
      reload = true;
    } else {
      r[0x062C+x] = (r[0x062C+x]-1) & 0xFF;
      if (!r[0x062C+x]) {
        var a = r[0x0668+x];
        if (a & 0x80) { this.pathY(x); return; }
        var p = a ? (r[0x0500+x] | r[0x051E+x] << 8) : (((r[0x050F+x] | r[0x052D+x] << 8)+6) & 0xFFFF);
        r[0x80] = r[0x050F+x] = p & 0xFF; r[0x81] = r[0x052D+x] = p >> 8;
        this.copyPath3(x);
      }
      r[0x061D+x] = (r[0x061D+x]-1) & 0xFF;             // $53DB
      reload = r[0x061D+x] === 0;
      if (!reload) { this.pathY(x); return; }
    }
    if (reload) {                                         // $53E2
      r[0x061D+x] = r[0x060E+x];
      var k = r[0x063B+x];
      if (k & 0x80) { k &= 0x7F; } else { r[0x063B+x] = (r[0x063B+x]-1) & 0xFF; }
      r[0xCE] = r[0x064A+x]; r[0xCF] = r[0x0659+x];
      r[0xAF+x] = r[(r[0xCE] | r[0xCF] << 8)+k];
    }
  }
  this.pathY(x);
}; // animStep

/** ★ `$5403`: the Y path by its command. */
Enemies.prototype.pathY = function (x) {
  var r = this.ram, s = this.ship, cmd = r[0x05A5+x];
  if (cmd === 0xD4) {                                     // $54B5: a random Y direction
    r[0x05F0+x] = (r[0x05F0+x]-1) & 0xFF;
    if (!r[0x05F0+x]) {
      r[0x05D2+x] = (r[0x05D2+x]-1) & 0xFF;
      if (!r[0x05D2+x]) { this.segmentEnd2(x); return; }
      var m = r[0x05B4+x];
      r[0x05E1+x] = (m & 0x80) ? ((s.rnd() & m) | 0x80) : (s.rnd() & m);
      r[0x05F0+x] = s.rnd() & 0x1F;
    }
    this.moveY(x, true);
    return;
  }
  if (cmd === 0xD5) {                                     // $54E5: Y toward the ship
    if (r[0x2B] === r[0xA0+x]) { return; }
    if (r[0x2B] < r[0xA0+x]) { r[0x05E1+x] |= 0x80; } else { r[0x05E1+x] &= 0x7F; }
    this.tickY(x);
    return;
  }
  if (cmd === 0xD6) {                                     // $5506: Y steps from a table
    r[0x05D2+x] = (r[0x05D2+x]-1) & 0xFF;
    if (r[0x05D2+x] & 0x80) { this.segmentEnd2(x); return; }
    var yy = r[0x05B4+x];
    r[0x05B4+x] = (r[0x05B4+x]+1) & 0xFF;
    r[0xCE] = r[0x05E1+x]; r[0xCF] = r[0x05F0+x];
    var v = r[(r[0xCE] | r[0xCF] << 8)+yy];
    if (v & 0x80) { this.moveUp(x, v); } else { this.moveDown(x, v); }
    return;
  }
  this.pathYNormal(x);
}; // pathY

/** ★ `$541F`: the plain Y path — segments of the second path counted down, then the tick. */
Enemies.prototype.pathYNormal = function (x) {
  var r = this.ram;
  for (;;) {
    r[0x05D2+x] = (r[0x05D2+x]-1) & 0xFF;
    if (r[0x05D2+x]) { break; }
    if (!this.segmentEnd2Load(x)) { return; }
  }
  this.tickY(x);
}; // pathYNormal

/** ★ `$5424`: the Y path's segment ran out (from the random and the table commands): reloaded, `$541F` goes on. */
Enemies.prototype.segmentEnd2 = function (x) {
  if (!this.segmentEnd2Load(x)) { return; }
  this.pathYNormal(x);
}; // segmentEnd2

/** @returns {boolean} false = the slot was freed. */
Enemies.prototype.segmentEnd2Load = function (x) {
  var r = this.ram, a = r[0x05FF+x];
  if (a & 0x80) { this.kill(x); return false; }
  var p = a ? (r[0x04C4+x] | r[0x04E2+x] << 8) : (((r[0x04D3+x] | r[0x04F1+x] << 8)+6) & 0xFFFF);
  r[0x7E] = r[0x04D3+x] = p & 0xFF; r[0x7F] = r[0x04F1+x] = p >> 8;
  this.copyPath2(x);
  return true;
}; // segmentEnd2Load

/** ★ `$5464`: the Y tick — every `$05B4` frames the Y moves. */
Enemies.prototype.tickY = function (x) {
  var r = this.ram;
  r[0x05C3+x] = (r[0x05C3+x]-1) & 0xFF;
  if (r[0x05C3+x]) { return; }
  r[0x05C3+x] = r[0x05B4+x];
  this.moveY(x, false);
}; // tickY

/** ★ `$5472`: the ground check of the Y path, then the move. */
Enemies.prototype.moveY = function (x, fromRandom) {
  var r = this.ram;
  if (r[0x05F0+x]) {
    if (!this.groundY(x)) { return; }
  }
  var d = r[0x05E1+x];
  if (!d) { return; }
  if (d & 0x80) { this.moveUp(x, d); } else { this.moveDown(x, d); }
}; // moveY

/** ★ `$5481`: Y down by `d`; past the bottom the slot dies; across a band's edge the slot changes group. */
Enemies.prototype.moveDown = function (x, d) {
  var r = this.ram;
  var v = (d+r[0xA0+x]) & 0xFF;
  if (v >= 0xCA) { this.kill(x); return; }
  if (r[0x0235]) { r[0xA0+x] = v; return; }
  r[0xCD] = v;
  if (this.bandDown(x, v)) { return; }
  r[0xA0+x] = r[0xCD];
}; // moveDown

/** ★ `$5499`: Y up by the low seven bits of `d`. */
Enemies.prototype.moveUp = function (x, d) {
  var r = this.ram;
  var v = (r[0xA0+x]-(d & 0x7F)) & 0xFF;
  if (v < 0x1E) { this.kill(x); return; }
  if (r[0x0235]) { r[0xA0+x] = v; return; }
  r[0xCD] = v;
  if (this.bandUp(x, v)) { return; }
  r[0xA0+x] = r[0xCD];
}; // moveUp

/**
 * ★ `$5528`: the cell under a ground enemy (row address `$D8` of the last
 * probe) — solid: the slot's step ends here, `$0479` cleared.
 * @returns {boolean} false = the step ends.
 */
Enemies.prototype.groundY = function (x) {
  var r = this.ram, s = this.ship;
  var a = r[0x02C6+x];
  if (a & 0x80) { return true; }
  if (!(r[0x0578+x] & 0x80)) { a = (a-2) & 0xFF; }
  var y = (a+0x29) & 0xFF;
  var ch = s.sc((r[0xD8] | r[0xD9] << 8)+y);
  if (s.flag(ch) & 0x80) { r[0x0479+x] = 0; return false; }
  r[0x0479+x] = 1;
  return true;
}; // groundY

/**
 * ★ `$5552` / `$5577`: a Y crossing the raster of the next group up or down
 * moves the slot into that group (`$55AD`) — into a free slot, else the Y
 * direction turns round and the slot's step ends.
 * @returns {boolean} true = the step ends (moved or turned).
 */
Enemies.prototype.bandUp = function (x, a) {
  var r = this.ram;
  if (x >= 10) { if (a >= r[0x023E]) { return false; } }
  else if (x >= 5) { if (a >= r[0x023B]) { return false; } }
  else { return false; }
  return this.bandMove(x, x-5);
}; // bandUp
Enemies.prototype.bandDown = function (x, a) {
  var r = this.ram;
  if (x < 5) { if (a < r[0x023B]) { return false; } }
  else if (x < 10) { if (a < r[0x023E]) { return false; } }
  else { return false; }
  return this.bandMove(x, x+5);
}; // bandDown

/** the fields `$55AD` copies between two slots (besides $82, $91, $A0, $AF, $BE) */
Enemies.SLOT_FIELDS = [0x045B, 0x046A, 0x0479, 0x0488, 0x0497, 0x04A6, 0x04B5, 0x04C4, 0x04D3, 0x04E2, 0x04F1,
                       0x0500, 0x050F, 0x051E, 0x052D, 0x053C, 0x054B, 0x055A, 0x0569, 0x0578, 0x0587, 0x0596,
                       0x05A5, 0x05B4, 0x05C3, 0x05D2, 0x05E1, 0x05F0, 0x05FF, 0x060E, 0x061D, 0x062C, 0x063B,
                       0x064A, 0x0659, 0x0668];

/**
 * ★ `$55AD`: the slot copied to `y` with the Y from `$CD`, `x` freed. A
 * taken target turns the Y direction round instead (`$559A`). Level 3's
 * window moves patch two bytes (`$55B0`, `$56B8`): the target is taken
 * over whatever is in it and the caller goes on (`vertical`).
 * @returns {boolean} true = the caller's step ends.
 */
Enemies.prototype.bandMove = function (x, y, vertical) {
  var r = this.ram;
  if (!vertical && r[0x044C+y]) {
    r[0x05E1+x] ^= 0x80;
    return true;
  }
  r[0x82+y] = r[0x82+x]; r[0x91+y] = r[0x91+x]; r[0xA0+y] = r[0xCD]; r[0xAF+y] = r[0xAF+x]; r[0xBE+y] = r[0xBE+x];
  for (var i = 0; i < Enemies.SLOT_FIELDS.length; i++) { r[Enemies.SLOT_FIELDS[i]+y] = r[Enemies.SLOT_FIELDS[i]+x]; }
  r[0x044C+y] = 1;
  r[0x82+x] = 0; r[0x91+x] = 0; r[0x0479+x] = 0; r[0x044C+x] = 0; r[0xA0+x] = 0x64;
  return !vertical;
}; // bandMove

// ---------------------------------------------------------------- the enemy loop

/**
 * ★ `$17FB`: the loop over the fifteen slots from the tail of the raster-48
 * handler — for every active slot: the shooting (`$2498`), the Force, the
 * bits and the ship against it, the items picked up, the trail of a ground
 * enemy, the player's shots in the six cells around it, hits and deaths.
 * A formation's death ends the loop at once.
 *
 * ★ The loop is long and band 5 (raster 141: the spawner and the state
 * machine) nests into it — in the middle of a slot as often as between two.
 * So the loop is written as the original's steps, each at the address of
 * the instructions it stands for, with the registers and the carry as
 * state: `nest` (`{pc, x, slot}`, measured — `timing.json`) says where band
 * 5 came in, `onNest` runs it there, and the slot in hand goes on with what
 * it had loaded before, the slots after it see the state machine's work —
 * including `$CD`, which the state machine uses for a new Y, and which the
 * loop reloads X from after a shot, an explosion, a hit and a death.
 * @param {?Object} [nest] - Where band 5 nested: the PC, the X register and `$CD`.
 * @param {?Function} [onNest] - Band 5 itself.
 */
Enemies.prototype.loop = function (nest, onNest) {
  var r = this.ram, s = this.ship;
  this.loopYielded = !nest;
  if (r[0x0236]) { return; }
  // the step band 5 came in at: the step holding its PC (a subroutine's PC by the step after the call)
  var at = nest ? Enemies.loopStepOf(nest.pc) : -1;
  var inDie = nest ? nest.pc >= 0x1A9C && nest.pc < 0x1AD2 : false;
  var st = {pc: 0x1802, x: 14, a: 0, c: 1, y: 0, ch: 0, hi: 0, e: 0, item: false};
  var x, m;
  for (;;) {
    x = st.x;
    if (!this.loopYielded && !inDie && st.pc === at && x === (nest.pc < 0x1811 ? nest.x : nest.slot)) {
      this.loopYielded = true;
      onNest();
      x = st.x;
    }
    if (this.loopTrace && (x === this.loopTrace || (this.loopTrace === 'cd' && st.pc === 0x180F))) { console.log('  $' + st.pc.toString(16), JSON.stringify(st)); }
    switch (st.pc) {
      // --- the search for the next active slot
      case 0x1802: st.a = r[0x044C+x]; st.pc = 0x1805; break;
      case 0x1805: st.pc = st.a === 1 ? 0x180F : 0x1809; break;
      case 0x1809: st.x = x-1; if (st.x < 0) { return; } st.pc = 0x1802; break;
      // --- the slot: the shooting
      case 0x180F: r[0xCD] = x; st.pc = 0x1811; break;
      case 0x1811: st.a = r[0x0596+x]; st.pc = 0x1814; break;
      case 0x1814: st.pc = st.a === 2 ? 0x1818 : 0x181D; break;
      case 0x1818: this.shoot(x); st.pc = 0x181B; break;
      case 0x181B: st.x = r[0xCD]; st.pc = 0x181D; break;
      // --- an item is not matched against the Force and the bits ($1831: the carry of CMP #$5D goes to $18E4)
      case 0x181D: st.a = r[0xBE+x]; st.pc = 0x181F; break;
      case 0x181F: st.c = 1; st.item = st.a === 0x81; st.pc = st.item ? 0x18E4 : 0x1823; break;
      case 0x1823: st.a = r[0xAF+x]; st.pc = 0x1825; break;
      case 0x1825:
        if (st.a === 0x4A || st.a === 0x5B || st.a === 0x5C || st.a === 0x5D) { st.item = true; st.c = 1; st.pc = 0x18E4; }
        else { st.c = st.a >= 0x5D ? 1 : 0; st.pc = 0x1835; }
        break;
      case 0x1835: st.pc = r[0x32] ? 0x183E : 0x1871; break;
      // --- the Force's box
      case 0x183E: st.a = (r[0x2C]-0x13) & 0xFF; st.pc = 0x1843; break;
      case 0x1843: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x1845; break;
      case 0x1845: st.pc = st.c ? 0x1871 : 0x1847; break;
      case 0x1847: st.a = (st.a+0x1E) & 0xFF; st.pc = 0x1849; break;
      case 0x1849: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x184B; break;
      case 0x184B: st.pc = st.c ? 0x184D : 0x1871; break;
      case 0x184D: r[0xD2] = (r[0x27] >> 1) | (r[0x28] ? 0x80 : 0); st.pc = 0x1858; break;
      case 0x1858: st.hi = r[0x91+x]; st.pc = 0x185E; break;
      case 0x185E: st.a = r[0x82+x]; st.pc = 0x1860; break;
      case 0x1860: st.a = (((st.a >> 1) | (st.hi ? 0x80 : 0))-0x0A) & 0xFF; st.pc = 0x1864; break;
      case 0x1864: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x1866; break;
      case 0x1866: st.pc = st.c ? 0x1871 : 0x1868; break;
      case 0x1868: st.a = (st.a+0x14) & 0xFF; st.pc = 0x186A; break;
      case 0x186A: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x186C; break;
      case 0x186C: st.pc = st.c ? 0x1A30 : 0x1871; break;
      // --- the upper bit's box
      case 0x1871: st.pc = r[0x3079] ? 0x1879 : 0x18E4; break;
      case 0x1879: st.a = (r[0x2B]-0x13) & 0xFF; st.pc = 0x187E; break;
      case 0x187E: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x1880; break;
      case 0x1880: st.pc = st.c ? 0x18AC : 0x1882; break;
      case 0x1882: st.a = (st.a+0x19) & 0xFF; st.pc = 0x1884; break;
      case 0x1884: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x1886; break;
      case 0x1886: st.pc = st.c ? 0x1888 : 0x18AC; break;
      case 0x1888: r[0xD2] = (r[0x25] >> 1) | (r[0x26] ? 0x80 : 0); st.pc = 0x1893; break;
      case 0x1893: st.hi = r[0x91+x]; st.pc = 0x1899; break;
      case 0x1899: st.a = r[0x82+x]; st.pc = 0x189B; break;
      case 0x189B: st.a = (((st.a >> 1) | (st.hi ? 0x80 : 0))-8) & 0xFF; st.pc = 0x189F; break;
      case 0x189F: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x18A1; break;
      case 0x18A1: st.pc = st.c ? 0x18AC : 0x18A3; break;
      case 0x18A3: st.a = (st.a+0x0E) & 0xFF; st.pc = 0x18A5; break;
      case 0x18A5: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x18A7; break;
      case 0x18A7: st.pc = st.c ? 0x1A30 : 0x18AC; break;
      // --- the lower bit's box
      case 0x18AC: st.pc = r[0x307A] ? 0x18B1 : 0x18E4; break;
      case 0x18B1: st.a = (r[0x2B]+0x0D) & 0xFF; st.pc = 0x18B6; break;
      case 0x18B6: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x18B8; break;
      case 0x18B8: st.pc = st.c ? 0x18E4 : 0x18BA; break;
      case 0x18BA: st.a = (st.a+0x19) & 0xFF; st.pc = 0x18BC; break;
      case 0x18BC: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x18BE; break;
      case 0x18BE: st.pc = st.c ? 0x18C0 : 0x18E4; break;
      case 0x18C0: r[0xD2] = (r[0x25] >> 1) | (r[0x26] ? 0x80 : 0); st.pc = 0x18CB; break;
      case 0x18CB: st.hi = r[0x91+x]; st.pc = 0x18D1; break;
      case 0x18D1: st.a = r[0x82+x]; st.pc = 0x18D3; break;
      case 0x18D3: st.a = (((st.a >> 1) | (st.hi ? 0x80 : 0))-8) & 0xFF; st.pc = 0x18D7; break;
      case 0x18D7: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x18D9; break;
      case 0x18D9: st.pc = st.c ? 0x18E4 : 0x18DB; break;
      case 0x18DB: st.a = (st.a+0x0E) & 0xFF; st.pc = 0x18DD; break;
      case 0x18DD: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x18DF; break;
      case 0x18DF: st.pc = st.c ? 0x1A30 : 0x18E4; break;
      // --- the ship's box (the carry of the last compare goes into the SBC)
      case 0x18E4: st.a = (r[0x2B]-3-(1-st.c)) & 0xFF; st.pc = 0x18E8; break;
      case 0x18E8: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x18EA; break;
      case 0x18EA: st.pc = st.c ? 0x1919 : 0x18EC; break;
      case 0x18EC: st.a = (st.a+0x1C) & 0xFF; st.pc = 0x18EE; break;
      case 0x18EE: st.c = st.a >= r[0xA0+x] ? 1 : 0; st.pc = 0x18F0; break;
      case 0x18F0: st.pc = st.c ? 0x18F2 : 0x1919; break;
      case 0x18F2: r[0xD2] = (r[0x25] >> 1) | (r[0x26] ? 0x80 : 0); st.pc = 0x18FD; break;
      case 0x18FD: st.hi = r[0x91+x]; st.pc = 0x1903; break;
      case 0x1903: st.a = r[0x82+x]; st.pc = 0x1905; break;
      case 0x1905: st.a = (((st.a >> 1) | (st.hi ? 0x80 : 0))-9) & 0xFF; st.pc = 0x1909; break;
      case 0x1909: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x190B; break;
      case 0x190B: st.pc = st.c ? 0x1919 : 0x190D; break;
      case 0x190D: st.a = (st.a+0x11) & 0xFF; st.pc = 0x190F; break;
      case 0x190F: st.c = st.a >= r[0xD2] ? 1 : 0; st.pc = 0x1911; break;
      case 0x1911: st.pc = st.c ? 0x1913 : 0x1919; break;
      case 0x1913:
        // $1B61 decides by the pointer, not by the flash ($BE = $81 only skipped the Force and the bits)
        st.a = r[0xAF+x];
        if (st.a === 0x4A || st.a === 0x5B || st.a === 0x5C || st.a === 0x5D) { s.pickup(x); st.pc = 0x1919; }   // … $1C42: LDX #<slot> (operand $1C43), then $1919
        else {
          // ★ $1C1E: JMP collision — its RTS returns to $1916 and the enemy dies; when the ship died, the
          // sound routine of $31A2 left X = 2 ($340E), so enemyDie picks the sound from slot 2's colour
          st.soundX = s.collision() ? 2 : x;
          st.pc = 0x1A74;
        }
        break;
      // --- the colour of a formation restored, an item has no cell
      case 0x1919: st.a = r[0xBE+x]; st.pc = 0x191B; break;
      case 0x191B: st.pc = (st.a & 0x80) ? 0x191D : 0x1925; break;
      case 0x191D: r[0xBE+x] = r[0x7C4A+r[0x046A+x]]; st.pc = 0x1925; break;
      case 0x1925: st.a = r[0xAF+x]; st.pc = 0x1927; break;
      case 0x1927: st.pc = (st.a === 0x4A || st.a === 0x5B || st.a === 0x5C || st.a === 0x5D) ? 0x1809 : 0x193A; break;
      // --- the cell of the enemy
      case 0x193A: st.a = r[0x91+x]; st.pc = 0x193C; break;
      case 0x193C: st.a = st.a ? 0x20 : 0; st.pc = 0x1940; break;
      case 0x1940: r[0x02C6+x] = st.a; st.pc = 0x1943; break;
      case 0x1943: st.a = r[0xA0+x]; st.pc = 0x1946; break;
      case 0x1946: st.a = ((st.a-0x32) & 0xFF) >> 3; st.pc = 0x194B; break;
      case 0x194B: st.pc = st.a >= 0x19 ? 0x1809 : 0x194F; break;
      case 0x194F: r[0x02D5+x] = st.a; st.y = st.a; st.pc = 0x1953; break;
      case 0x1953: st.a = r[0x2F72+st.y]; st.pc = 0x1956; break;
      case 0x1956: r[0x02A8+x] = st.a; st.pc = 0x1959; break;
      case 0x1959: r[0xD2] = st.a; st.pc = 0x195B; break;
      case 0x195B: st.a = r[0x2F8B+st.y]; st.pc = 0x195E; break;
      case 0x195E: r[0x02B7+x] = st.a; st.pc = 0x1961; break;
      case 0x1961: r[0xD3] = st.a; st.pc = 0x1963; break;
      case 0x1963: st.a = r[0x82+x]; st.pc = 0x1965; break;
      case 0x1965: st.a = st.a >> 3; st.pc = 0x1969; break;
      case 0x1969: st.a = st.a+r[0x02C6+x]; st.pc = 0x196C; break;
      case 0x196C: st.a -= 3; st.pc = st.a < 0 ? 0x1809 : 0x1973; break;
      case 0x1973: st.pc = st.a >= 0x25 ? 0x1809 : 0x1977; break;
      case 0x1977: r[0x02C6+x] = st.a; st.pc = 0x197A; break;
      // --- the trail of a ground enemy
      case 0x197A: st.a = r[0xBE+x]; st.pc = 0x197C; break;
      case 0x197C: st.pc = st.a === 0x12 ? 0x1980 : 0x19B3; break;
      case 0x1980: st.a = r[0x02A8+x]; st.pc = 0x1983; break;
      case 0x1983: st.pc = (st.a === 0xA8 || st.a === 0xD0) ? 0x19B3 : 0x198B; break;
      case 0x198B: m = st.a+0x51; r[0xE2] = r[0xE4] = m & 0xFF; st.c = m > 0xFF ? 1 : 0; st.pc = 0x1992; break;
      case 0x1992: st.a = r[0x02B7+x]; st.pc = 0x1995; break;
      case 0x1995:
        m = st.a+st.c; r[0xE3] = m & 0xFF;
        r[0xE5] = ((m & 0xFF)+0x0C+(m > 0xFF ? 1 : 0)) & 0xFF;
        st.pc = 0x199D;
        break;
      case 0x199D: st.y = r[0x02C6+x]; st.pc = 0x19A0; break;
      case 0x19A0: st.ch = s.sc((r[0xE2] | r[0xE3] << 8)+st.y); st.pc = 0x19A2; break;
      case 0x19A2: st.pc = s.flag(st.ch) === 0 ? 0x19A8 : 0x19B3; break;
      case 0x19A8: st.y = r[0x02C6+x]; m = (r[0xE2] | r[0xE3] << 8)+st.y; s.sw(m, 0xB2); s.cw(m, 0x0D); st.pc = 0x19B3; break;
      // --- a shot in the six cells (the row address in $D2/$D3)
      case 0x19B3: st.y = r[0x02C6+x]; st.pc = 0x19B6; break;
      case 0x19B6: st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19B8; break;
      case 0x19B8: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x19BC; break;
      case 0x19BC: st.y++; st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19BF; break;
      case 0x19BF: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x19C3; break;
      case 0x19C3: m = (r[0xD2] | r[0xD3] << 8)+0x28; r[0xD2] = m & 0xFF; r[0xD3] = (m >> 8) & 0xFF; st.pc = 0x19CD; break;
      case 0x19CD: st.y--; st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19D0; break;
      case 0x19D0: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x19D4; break;
      case 0x19D4: st.y++; st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19D7; break;
      case 0x19D7: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x19DB; break;
      case 0x19DB: m = (r[0xD2] | r[0xD3] << 8)+0x28; r[0xD2] = m & 0xFF; r[0xD3] = (m >> 8) & 0xFF; st.pc = 0x19E5; break;
      case 0x19E5: st.y--; st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19E8; break;
      case 0x19E8: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x19EC; break;
      case 0x19EC: st.y++; st.ch = s.sc((r[0xD2] | r[0xD3] << 8)+st.y); st.pc = 0x19EF; break;
      case 0x19EF: st.pc = st.ch >= 0xCC ? 0x19F6 : 0x1809; break;
      // --- what the cell holds
      case 0x19F6:
        st.pc = st.ch < 0xD4 ? 0x1A09 : st.ch < 0xDA ? 0x1A57 : st.ch < 0xE5 ? 0x1A09 : st.ch < 0xED ? 0x1A6C : 0x1809;
        break;
      // --- a shot, a missile, a laser bolt: an explosion where it was, one hit
      case 0x1A09: st.e = s.freeExplosion(); st.pc = st.e < 0 ? 0x1A74 : 0x1A15; break;
      case 0x1A15:
        r[0x022C] = st.e;
        s.sw((r[0xD2] | r[0xD3] << 8)+st.y, 0xC1);
        r[0x48] = r[0xD2]; r[0x49] = r[0xD3];
        r[0x2441+st.e] = st.y;
        s.explosionType(st.e, 0);
        s.explosionDraw(st.e);
        st.pc = 0x1A30;
        break;
      case 0x1A30: st.x = x = r[0xCD]; st.pc = this.damage(x, 1) ? 0x1A52 : 0x1A74; break;
      case 0x1A52: st.x = r[0xCD]; st.pc = 0x1809; break;
      // --- the beam, by its level; a laser
      case 0x1A57: r[0x1A67] = (r[0x428C]*4+2) & 0xFF; st.pc = 0x1A62; break;
      case 0x1A62: st.pc = this.damage(x, r[0x1A67], true) ? 0x1A52 : 0x1A74; break;
      case 0x1A6C: st.pc = this.damage(x, 5, true) ? 0x1A52 : 0x1A74; break;
      // --- the death
      case 0x1A74: { var sx = st.soundX; st.soundX = undefined; if (this.die(x, nest, onNest, sx)) { return; } st.pc = 0x1A52; break; }
      default: throw new Error('enemy loop: no step at $' + st.pc.toString(16));
    }
  }
}; // loop

/** the steps of the loop, by address — every instruction that reads the slots' memory or branches on it is one */
Enemies.LOOP_STEPS = [
  0x1802, 0x1805, 0x1809, 0x180F, 0x1811, 0x1814, 0x1818, 0x181B, 0x181D, 0x181F, 0x1823, 0x1825, 0x1835,
  0x183E, 0x1843, 0x1845, 0x1847, 0x1849, 0x184B, 0x184D, 0x1858, 0x185E, 0x1860, 0x1864, 0x1866, 0x1868, 0x186A, 0x186C,
  0x1871, 0x1879, 0x187E, 0x1880, 0x1882, 0x1884, 0x1886, 0x1888, 0x1893, 0x1899, 0x189B, 0x189F, 0x18A1, 0x18A3, 0x18A5, 0x18A7,
  0x18AC, 0x18B1, 0x18B6, 0x18B8, 0x18BA, 0x18BC, 0x18BE, 0x18C0, 0x18CB, 0x18D1, 0x18D3, 0x18D7, 0x18D9, 0x18DB, 0x18DD, 0x18DF,
  0x18E4, 0x18E8, 0x18EA, 0x18EC, 0x18EE, 0x18F0, 0x18F2, 0x18FD, 0x1903, 0x1905, 0x1909, 0x190B, 0x190D, 0x190F, 0x1911, 0x1913,
  0x1919, 0x191B, 0x191D, 0x1925, 0x1927, 0x193A, 0x193C, 0x1940, 0x1943, 0x1946, 0x194B, 0x194F, 0x1953, 0x1956, 0x1959, 0x195B,
  0x195E, 0x1961, 0x1963, 0x1965, 0x1969, 0x196C, 0x1973, 0x1977,
  0x197A, 0x197C, 0x1980, 0x1983, 0x198B, 0x1992, 0x1995, 0x199D, 0x19A0, 0x19A2, 0x19A8,
  0x19B3, 0x19B6, 0x19B8, 0x19BC, 0x19BF, 0x19C3, 0x19CD, 0x19D0, 0x19D4, 0x19D7, 0x19DB, 0x19E5, 0x19E8, 0x19EC, 0x19EF,
  0x19F6, 0x1A09, 0x1A15, 0x1A30, 0x1A52, 0x1A57, 0x1A62, 0x1A6C, 0x1A74,
  0x1A9C, 0x1A9E, 0x1AA3, 0x1AA7, 0x1ABD, 0x1AC1, 0x1AC5, 0x1ACA, 0x1ACF];   // ($1A9C-$1ACF: the formation's loop in `die`)

/**
 * The step of the loop that holds the PC `pc` — the last step at or before
 * it (`$180A`, the branch after DEX, is the search step with the new X); a
 * PC in a subroutine the loop calls is the step after the call: the
 * shooting (`$2498`) → `$181B`, the pickup (`$1B61`) → `$1919`, the
 * explosion (`$2154`, `$23B0`) → `$1A30`, a hit's tail (`$1A3C`), a sound
 * (`$33FB`, `$3440`) and the death's tail → `$1A52`.
 * @param {number} pc
 * @returns {number}
 */
Enemies.loopStepOf = function (pc) {
  if (pc === 0x180A) { return 0x1802; }
  if (pc >= 0x2498 && pc < 0x2563) { return 0x181B; }
  if (pc >= 0x1B61 && pc < 0x1C47) { return 0x1919; }
  if (pc >= 0x2154 && pc < 0x2335) { return 0x1A30; }
  if (pc >= 0x23B0 && pc < 0x2430) { return 0x1A30; }
  if (pc >= 0x1A18 && pc < 0x1A30) { return 0x1A30; }   // (the explosion's stores and calls: the step is done)
  if ((pc >= 0x33FB && pc < 0x3414) || (pc >= 0x3440 && pc < 0x34C0) || (pc >= 0x1A3C && pc < 0x1A52)
      || (pc >= 0x1A74 && pc < 0x1A9C) || (pc >= 0x1AD2 && pc < 0x1B61)) { return 0x1A52; }
  var best = 0x1802;
  for (var i = 0; i < Enemies.LOOP_STEPS.length; i++) { if (Enemies.LOOP_STEPS[i] <= pc) { best = Enemies.LOOP_STEPS[i]; } }
  return best;
}; // loopStepOf

/**
 * ★ `$1A30` / `$1A3C`: the hits of a slot reduced; it flashes (`$BE` = `$81`)
 * and sounds. `$1A30` dies at zero as well, the beam and the lasers only below.
 * @returns {boolean} false = the enemy is dead (the caller runs `$1A74`).
 */
Enemies.prototype.damage = function (x, by, belowOnly) {
  var r = this.ram, s = this.ship;
  var v = r[0x045B+x]-by;
  if (v < 0 || (!belowOnly && v === 0)) { return false; }
  r[0x045B+x] = v;
  var snd = (r[0xBE+x] & 0x80) ? 0x13 : 0x11;
  r[0xBE+x] = 0x81;
  s.sound(snd);
  return true;
}; // damage

/**
 * ★ `$1A74`: an enemy dies — the sound by its colour, then the slot from
 * `$CD` (`$1A89`): a carrier becomes its item (`$1B01`), a formation takes
 * its neighbours with it (`$1A9C`, and the loop ends), anything else scores
 * and explodes. Band 5 nests into the formation's loop too (`nest`, as in
 * `loop`): the neighbours not reached yet then still fly in the state
 * machine, one marked but not yet freed (`$1ACC`) flies with the pointer
 * of an explosion.
 * @param {number} x - The slot (the X register of the loop).
 * @param {?Object} [nest] - Where band 5 nested (`loop`).
 * @param {?Function} [onNest] - Band 5 itself.
 * @returns {boolean} true = the enemy loop ends here.
 */
Enemies.prototype.die = function (x, nest, onNest, soundX) {
  var r = this.ram, s = this.ship;
  var c = r[0xBE+(soundX === undefined ? x : soundX)];     // $1A74: LDA $BE,X — X as the caller left it
  s.sound((c & 0x80) ? 0x0E : ((c & 8) ? 0x0C : 0x09));
  x = r[0xCD];                                            // $1A89
  c = r[0xBE+x];
  var ptr = r[0xAF+x];
  if (ptr === 0x78 || ptr === 0x79) {                     // $1B01: the item the carrier had
    var y = r[0x046A+x];
    r[0xBE+x] = r[0x1B49+y]; r[0xAF+x] = r[0x1B4F+y];
    r[0x0479+x] = 1;
    r[0x3388] = 4;
    r[0x7C] = r[0x0488+x] = r[0x0497+x] = 0x55; r[0x7D] = r[0x04A6+x] = r[0x04B5+x] = 0x1B;
    r[0x7E] = r[0x04C4+x] = r[0x04D3+x] = 0x5B; r[0x7F] = r[0x04E2+x] = r[0x04F1+x] = 0x1B;
    this.copyPath1(x); this.copyPath2(x);
    return false;
  }
  if (c & 0x80) {                                         // $1A9C: the whole formation
    var at = nest && nest.pc >= 0x1A9C && nest.pc < 0x1AD2 ? Enemies.loopStepOf(nest.pc) : -1;
    var pc = 0x1A9C, k = 14, a = 0;
    for (;;) {
      if (!this.loopYielded && pc === at && k === nest.x) { this.loopYielded = true; onNest(); }
      switch (pc) {
        case 0x1A9C: a = r[0xA0+x]; pc = 0x1A9E; break;
        case 0x1A9E: r[0x0B62] = a; pc = 0x1AA3; break;
        case 0x1AA3: pc = (r[0xBE+k] & 0x80) ? 0x1AA7 : 0x1ACF; break;
        case 0x1AA7:
          a = r[0xA0+k];
          if (a === r[0x0B62]) { pc = 0x1ABD; break; }
          a = (a-0x20) & 0xFF;
          if (a >= r[0x0B62]) { pc = 0x1ACF; break; }
          pc = ((a+0x40) & 0xFF) < r[0x0B62] ? 0x1ACF : 0x1ABD;
          break;
        case 0x1ABD: r[0xBE+k] = 7; pc = 0x1AC1; break;
        case 0x1AC1: r[0xAF+k] = 0x61; pc = 0x1AC5; break;
        case 0x1AC5: r[0x060E+k] = 3; pc = 0x1ACA; break;
        case 0x1ACA: r[0x044C+k] = 0x80; pc = 0x1ACF; break;
        case 0x1ACF: k--; pc = k < 0 ? 0x1AD2 : 0x1AA3; break;
        case 0x1AD2: r[0x3387] = 1; return true;
      }
    }
  }
  r[0x3388] = (c & 7) | 1;                                // $1ADA
  r[0xBE+x] = 7;
  r[0xAF+x] = r[0x0587+x] === 2 ? 0x65 : 0x61;
  r[0x060E+x] = 3;
  r[0x044C+x] = 0x80;
  return false;
}; // die

/**
 * ★ `$2498`: an enemy of the shooting kind (`$0596` = 2) fires a bullet —
 * a timed one (`$024A`, reloaded at random while the game runs), a formation
 * or the `$1E` kind every `$018` frames; the bullet aimed at the ship by
 * quarters of randomness, or straight for the two special kinds.
 */
Enemies.prototype.shoot = function (x) {
  var r = this.ram, s = this.ship;
  r[0x024A] = (r[0x024A]-1) & 0xFF;
  if (r[0x024A] === 0) {
    if (r[0x0B5D]) { return; }
    r[0x024A] = ((s.rnd() & 0x7F)+0x29) & 0xFF;          // ★ ADC #$28 with the carry of CMP #$02
  } else {
    var c = r[0xBE+x];
    if (!(c & 0x80) && c !== 0x1E) { return; }
    r[0x024B] = (r[0x024B]-1) & 0xFF;
    if (r[0x024B]) { return; }
    r[0x024B] = 0x18;
  }
  var y;
  for (y = 9; y >= 0; y--) { if (!r[0x02E5+y]) { break; } }
  if (y < 0) { return; }
  var colour = r[0xBE+x];
  if (colour & 0x80) {
    r[0x02EF+y] = 1; r[0x0334+y] = 0x88; r[0x033E+y] = 0;
  } else if (colour === 0x1E) {
    r[0x02EF+y] = 2; r[0x0334+y] = 0; r[0x033E+y] = 0x88;
  } else {
    r[0x250C] = r[0x26] ? 1 : 0;
    r[0x250E] = r[0x91+x] ? 1 : 0;
    var shipX = r[0x25] | r[0x250C] << 8, ex = r[0x82+x] | r[0x250E] << 8;
    var v = (s.rnd() & 3) | 2;
    if (shipX < ex) { v |= 0x80; }
    r[0x0334+y] = v;
    var below = r[0x2B] >= r[0xA0+x];
    v = s.rnd() & 3;
    if (!below) { v |= 0x80; }
    r[0x033E+y] = v;
  }
  var hx = (r[0x82+x] >> 1) | (r[0x91+x] ? 0x80 : 0);     // $252D
  if (hx < 8) { return; }
  hx -= 8;
  if (hx < 0x28 || hx >= 0xA0) { return; }
  r[0x0348+y] = hx;
  var vy = (r[0xA0+x]-0x28) & 0xFF;
  if (vy < 8 || vy >= 0x96) { return; }
  r[0x0352+y] = vy;
  r[0x0366+y] = 0xD3;
  r[0x02E5+y] = 1;
}; // shoot

// ---------------------------------------------------------------- level 3: the window moves

/**
 * ★ `$3A68` / `$3A9F`: level 3's window moving down or up moves every
 * enemy sprite (pointer ≥ `$80`) a pixel the other way, across the groups
 * of the multiplexer with the band test patched to take the slot over.
 * @param {boolean} up - The window moves up (`$3A9F`: the enemies go down).
 */
Enemies.prototype.verticalMove = function (up) {
  var r = this.ram;
  for (var x = 14; x >= 0; x--) {
    if (!r[0x044C+x] || r[0xAF+x] < 0x80) { continue; }
    r[0xA0+x] = (r[0xA0+x]+(up ? 1 : -1)) & 0xFF;
    if (r[0xA0+x] === 0) { r[0x044C+x] = 0; continue; }
    r[0xCD] = r[0xA0+x];
    var a = r[0xCD], y = -1;
    if (up) {                                             // $5577 with the patches
      if (x < 5) { if (a >= r[0x023B]) { y = x+5; } }
      else if (x < 10) { if (a >= r[0x023E]) { y = x+5; } }
    } else {                                              // $5552
      if (x >= 10) { if (a < r[0x023E]) { y = x-5; } }
      else if (x >= 5) { if (a < r[0x023B]) { y = x-5; } }
    }
    if (y >= 0) { this.bandMove(x, y, true); }
  }
}; // verticalMove

// ---------------------------------------------------------------- the boss

/**
 * ★ `$56CF`: the end object of the level — an entry `$80`-`$FA` of the wave
 * table. Its record in `M` (`$7AC0`, index = the low seven bits) gives the
 * tables the core copies into the state page: the hit zones (`$0417`,
 * `$58F0`), the sprite pointers (`$03A6`), colours (`$03C9`) and X
 * positions (`$03EC`) of 5 × 7 sprites, the Y of the first row (`$0398`,
 * rows 21 apart, the raster of each 11 below its Y), the weak spot
 * (`$0416`), the hits (`$58EC/$58ED`) and the level's step (`$57F8`).
 * Every slot is cleared, `$024C` switches the chain to the boss's own and
 * the boss music starts.
 */
Enemies.prototype.endObject = function (type) {
  var r = this.ram, x = type & 0x7F, y;
  r[0x58E9] = x;
  r[0x58EE] = r[0x7AC3+x]; r[0x58EA] = r[0x7AC4+x]; r[0x0416] = r[0x7ACF+x];
  r[0x58EC] = r[0x7AD0+x]; r[0x58ED] = r[0x7AD1+x];
  r[0x57F8] = r[0x7ACD+x]; r[0x57F9] = r[0x7ACE+x];
  r[0x573E] = r[0x7AC5+x]; r[0x573F] = r[0x7AC6+x];
  r[0x5744] = r[0x7AC7+x]; r[0x5745] = r[0x7AC8+x];
  r[0x574F] = r[0x7AC9+x]; r[0x5750] = r[0x7ACA+x];
  r[0x5755] = r[0x7ACB+x]; r[0x5756] = r[0x7ACC+x];
  r[0x5760] = r[0x7AC0+x]; r[0x5761] = r[0x7AC1+x];
  var ta = r[0x573E] | r[0x573F] << 8, tb = r[0x5744] | r[0x5745] << 8, tc = r[0x574F] | r[0x5750] << 8;
  var td = r[0x5755] | r[0x5756] << 8, te = r[0x5760] | r[0x5761] << 8;
  for (y = 0; y <= 0x11; y++) { r[0x0417+y] = r[ta+y]; r[0x58F0+y] = r[tb+y]; }
  for (y = 0; y <= 0x22; y++) { r[0x03A6+y] = r[tc+y]; r[0x03C9+y] = r[td+y]; }
  for (y = 0; y <= 0x29; y++) { r[0x03EC+y] = r[te+y]; }
  r[0x74] = 0;
  var a = r[0x7AC2+x];
  r[0x0398] = a;
  for (y = 0; ; y++) {                                    // $5771: Y of row n = Y0 + 21n, its raster 11 below
    a = (a+0x0B) & 0xFF;
    r[0x039F+y] = a;
    if (y+1 === 7) { break; }
    a = (a+0x0A) & 0xFF;
    r[0x0398+y+1] = a;
  }
  for (x = 14; x >= 0; x--) { r[0x044C+x] = 0; r[0x82+x] = 0; r[0x91+x] = 0; r[0xA0+x] = 0; }
  r[0x024C] = (r[0x024C]+1) & 0xFF;
  r[0x0B5E] = 0;
  this.ship.music(0);                                     // $57AC: JMP $6379 with A = 0 (M6)
}; // endObject

/** the raster-48 handler's part of the boss: `$5902` — hits, the death animation */
Enemies.prototype.bossFrame = function () {
  var r = this.ram, s = this.ship;
  if (r[0x0249]) { this.bossDeath(); return; }
  if (r[0x0236]) { return; }
  var what = this.bossCollision();
  if (what === 'exit') { return; }
  if (what === 'end') { this.levelEnd(); return; }
  if (what !== 'continue') { this.bossHit(what.ch, what.y, what.p); return; }   // level 4: a part was hit
  var row = ((r[0x0398]-0x32) & 0xFF) >> 3;
  r[0x75] = r[0x2F72+row]; r[0x76] = r[0x2F8B+row];
  r[0x79] = r[0x78] ? 0x20 : 0;
  var a = (r[0x77] >> 3)+r[0x79]-4;                       // ★ $5936: SBC #3 after an ADC that never carries
  if (a < 0) { return; }
  r[0x79] = a;
  if (a >= 0x26) { return; }
  r[0x58EF] = 0;
  for (;;) {
    var x = r[0x58EF], p = r[0x75] | r[0x76] << 8;
    var off = r[0x0417+x];
    if (off !== 0xD3) {
      a = (off+r[0x79]) & 0xFF;
      if (a < 0x25) {
        var y = a, ch;
        ch = s.sc(p+y);
        if (ch >= 0xCC && ch < 0xEE) { this.bossHit(ch, y, p); return; }
        ch = s.sc(p+y+1);
        if (ch >= 0xCC && ch < 0xEE) { this.bossHit(ch, y+1, p); return; }
        a = (y+r[0x58F0+x]) & 0xFF;
        if (a < 0x25) {
          ch = s.sc(p+a);
          if (ch >= 0xCC && ch < 0xEE) { this.bossHit(ch, a, p); return; }
          ch = s.sc(p+a-1);
          if (ch >= 0xCC && ch < 0xEE) { this.bossHit(ch, a-1, p); return; }
        }
      }
    }
    r[0x58EF] = (r[0x58EF]+1) & 0xFF;                     // $598F
    if (r[0x58EF] >= r[0x58EE]) { return; }
    p = (p+0x28) & 0xFFFF;
    r[0x75] = p & 0xFF; r[0x76] = p >> 8;
  }
}; // bossFrame

/**
 * ★ `$59AD`: a shot found on the boss at row `$58EF`, column `y` of the
 * screen row `p` — on the weak spot (or everywhere when `$0416` is
 * negative) the boss flashes and loses hits by the weapon: one for a shot,
 * the beam's level × 4 + 2, five for a laser; at none left the death
 * begins. A plain shot explodes where it was.
 */
Enemies.prototype.bossHit = function (ch, y, p) {
  var r = this.ram, s = this.ship, i;
  var weak = (r[0x0416] & 0x80) !== 0 || r[0x0416] === r[0x58EF];
  if (weak) {
    r[0x58EB] = 3;
    for (i = 0; i <= 0x22; i++) { r[0x03C9+i] = 0x81; }
  }
  var by;
  if (ch < 0xD4 || (ch >= 0xDA && ch < 0xE6)) {
    r[0x5A24] = 0;
    by = 1;
    if (weak && this.bossLoseHits(by)) { return; }
    var e = s.freeExplosion();
    if (e < 0) { return; }
    r[0x022C] = e;
    s.sw(p+y, 0xC1);
    r[0x48] = r[0x75]; r[0x49] = r[0x76];
    r[0x2441+e] = y;
    s.explosionType(e, 0);
    s.explosionDraw(e);
    return;
  }
  if (ch < 0xDA) {                                        // $5A2E: the beam
    r[0x429D] = (r[0x429D]+1) & 0xFF;
    if (!weak) { return; }
    r[0x5A4B] = (r[0x428C]*4+2) & 0xFF;
    this.bossLoseHits(r[0x5A4B]);
    return;
  }
  if (ch < 0xEE) {                                        // $5A5C: a laser
    if (s.levelIndex !== 0) { r[0x4EB6] = 1; }
    if (!weak) { return; }
    this.bossLoseHits(5);
  }
}; // bossHit

/** `$59ED`: the 16-bit hits down by `by`; below zero the boss starts dying. @returns {boolean} dying */
Enemies.prototype.bossLoseHits = function (by) {
  var r = this.ram;
  var v = r[0x58EC]-by;
  r[0x58EC] = v & 0xFF;
  if (v >= 0) { return false; }
  r[0x58ED] = (r[0x58ED]-1) & 0xFF;
  if (!(r[0x58ED] & 0x80)) { return false; }
  r[0x0249] = (r[0x0249]+1) & 0xFF;
  return true;
}; // bossLoseHits

/**
 * ★ `$5AE3`: the ship against the boss's hit zones (the zone of the ship's
 * row, from the boss's X) — a collision; level 4's boss has three parts
 * with their own test, hits and end (`$5BA0`).
 * @returns {string|Object} 'continue', 'exit' (the frame's boss part ends),
 *          'end' (the level ends), or `{ch, y, p}` for a shot on a part of level 4's boss.
 */
Enemies.prototype.bossCollision = function () {
  var r = this.ram, s = this.ship;
  if (s.levelIndex === 3) { return this.bossCollision4(); }
  if (!(r[0x040F] & 8) && r[0x03EC] < 0x18) { return 'continue'; }
  var a = ((r[0x58EE] << 3)+r[0x0398]) & 0xFF;
  if (a < r[0x2B]) { return 'continue'; }
  a = (r[0x2B]+0x0A) & 0xFF;
  if (a < r[0x0398]) { return 'continue'; }
  var x = ((a-r[0x0398]) & 0xFF) >> 3;
  var t = r[0x25]+0x15;
  r[0x0243] = t & 0xFF; r[0x0244] = ((r[0x26] ? 1 : 0)+(t > 0xFF ? 1 : 0)) & 0xFF;
  r[0x0246] = (r[0x040F] & 8) ? 1 : 0;
  r[0x0245] = r[0x03EC];
  a = r[0x0417+x];
  if (a & 0x80) { return 'continue'; }
  t = ((a << 3) & 0xFF)+r[0x0245];
  r[0x0247] = t & 0xFF; r[0x0248] = (r[0x0246]+(t > 0xFF ? 1 : 0)) & 0xFF;
  var ship16 = r[0x0243] | r[0x0244] << 8, zone16 = r[0x0247] | r[0x0248] << 8;
  if (ship16 < zone16) { return 'continue'; }
  t = ((r[0x58F0+x] << 3) & 0xFF)+r[0x0247];
  r[0x0247] = t & 0xFF; r[0x0248] = (r[0x0248]+(t > 0xFF ? 1 : 0)) & 0xFF;
  r[0x0244] = r[0x26] ? 1 : 0; r[0x0243] = r[0x25];
  ship16 = r[0x0243] | r[0x0244] << 8; zone16 = r[0x0247] | r[0x0248] << 8;
  if (ship16 >= zone16) { return 'continue'; }
  s.collision();
  return 'continue';
}; // bossCollision

/**
 * ★ `$5BA0`: level 4's boss — three parts (`$5DAB` state: 1 alive, 0 gone,
 * `$80` destroyed; `$5DAE` hits) at `$5D98` (X/2) and `$5D9B` (Y) with the
 * sizes `$5D9E`/`$5DA1` and the scan sizes `$5DA4`/`$5DA7`: the ship
 * against each, then — while the level runs — the end when every sprite
 * pointer is `$7A`, else the shots on one part a frame (`$5DAA` round-robin).
 */
Enemies.prototype.bossCollision4 = function () {
  var r = this.ram, s = this.ship, x, y;
  r[0x5D98] = (r[0x03EC] >> 1) | ((r[0x040F] & 8) ? 0x80 : 0);
  r[0x5D9B] = r[0x0399];
  r[0x5D99] = (r[0x0401] >> 1) | ((r[0x040F] & 0x40) ? 0x80 : 0);
  r[0x5D9C] = (r[0x0398]+0x0A+(r[0x0401] & 1)) & 0xFF;               // ★ ADC with the carry the ROR shifted out of $0401
  r[0x5D9A] = (r[0x03F6] >> 1) | ((r[0x0412] & 0x10) ? 0x80 : 0);
  r[0x5D9D] = r[0x039B];
  r[0xD2] = (r[0x25] >> 1) | (r[0x26] ? 0x80 : 0);
  for (x = 2; x >= 0; x--) {
    var st = r[0x5DAB+x];
    if ((st & 0x80) || st === 0) { continue; }
    var a = (r[0x2B]+0x16) & 0xFF;
    if (a < r[0x5D9B+x]) { continue; }
    a = (a-r[0x5D9E+x]) & 0xFF;
    if (a >= r[0x5D9B+x]) { continue; }
    a = (r[0xD2]+0x0A) & 0xFF;
    if (a < r[0x5D98+x]) { continue; }
    a = (a-r[0x5DA1+x]) & 0xFF;
    if (a >= r[0x5D98+x]) { continue; }
    s.collision();
    return 'continue';                                    // $5C1C: JMP collision — its RTS returns into $5912
  }
  if (r[0x0310] === 0) {                                  // $5C22
    var all = true;
    for (x = 0x1D; x >= 0; x--) { if (r[0x03A6+x] !== 0x7A) { all = false; break; } }
    if (all) { return 'end'; }
    x = r[0x5DAA]-1;
    if (x < 0) { x = 2; }
    r[0x5DAA] = x;
    for (; x >= 0; x--) { st = r[0x5DAB+x]; if (!(st & 0x80) && st !== 0) { break; } }
    if (x < 0) { return 'exit'; }
  } else { return 'exit'; }
  // $5C52: the shots on part x
  var row = ((r[0x5D9B+x]-0x32) & 0xFF) >> 3;
  r[0x75] = r[0x2F72+row]; r[0x76] = r[0x2F8B+row];
  a = r[0x5D98+x];
  if (a < 0x14 || a >= 0xA0) { return 'exit'; }
  a = (a >> 2)-2;
  if (a < 0) { return 'exit'; }
  r[0x79] = a; r[0x03] = x; r[0x04] = r[0x5DA4+x]; r[0x05] = r[0x5DA7+x];
  var cols = r[0x05];
  for (;;) {
    y = r[0x79];
    for (var k = cols; k > 0; k--) {
      var p = r[0x75] | r[0x76] << 8, ch = s.sc(p+y);
      if (ch >= 0xCC && ch < 0xEE) {
        r[0x06] = ch; r[0x07] = y;
        x = r[0x03];
        this.bossPartFlash(x);
        this.bossPartHits(x, ch);
        this.bossPartGone(x);
        return {ch: ch, y: r[0x07], p: p};
      }
      y++;
      if (y === 0x27) { return 'exit'; }
    }
    var q = ((r[0x75] | r[0x76] << 8)+0x28) & 0xFFFF;
    r[0x75] = q & 0xFF; r[0x76] = q >> 8;
    r[0x04] = (r[0x04]-1) & 0xFF;
    if (!r[0x04]) { return 'exit'; }
  }
}; // bossCollision4

/** ★ `$5CCB`: the colours of part `x` of level 4's boss flash (`$81`) for three frames. */
Enemies.prototype.bossPartFlash = function (x) {
  var r = this.ram, y;
  r[0x58EB] = 3;
  if (x === 2) { for (y = 2; y >= 0; y--) { r[0x03C9] = 0x81; r[0x03D3+y] = 0x81; r[0x03DA+y] = 0x81; } }
  else if (x === 1) { for (y = 2; y >= 0; y--) { r[0x03C9] = 0x81; r[0x03DE+y] = 0x81; r[0x03E5+y] = 0x81; } }
  else { for (y = 2; y >= 0; y--) { r[0x03C9+y] = 0x81; r[0x03D0+y] = 0x81; r[0x03D7+y] = 0x81; } }
}; // bossPartFlash

/** ★ `$5D0B`: the hits of part `x` down by the weapon (★ `SBC` with the carry of the compares: one less). */
Enemies.prototype.bossPartHits = function (x, ch) {
  var r = this.ram, by;
  if (ch < 0xD4 || (ch >= 0xDA && ch < 0xE6)) { by = 1+1; }       // $5D22: SBC #1 with C = 0 (CMP #$D4 / #$E6 fell through)
  else if (ch < 0xDA) { by = 10; }                                  // $5D2B: SBC #$0A with C = 1
  else { by = 5+1; }                                                // $5D19: SBC #5 with C = 0 (CMP #$E6 fell through)
  r[0x5DAE+x] = (r[0x5DAE+x]-by) & 0xFF;
}; // bossPartHits

/** ★ `$5D34`: a part with its hits below zero is destroyed — its pointers `$5E`, colours 7, state `$80`. */
Enemies.prototype.bossPartGone = function (x) {
  var r = this.ram, y;
  if (!(r[0x5DAE+x] & 0x80)) { return; }
  r[0x5DAB+x] = 0x80;
  if (x === 2) {
    for (y = 2; y >= 0; y--) { r[0x03C9] = 7; r[0x03D3+y] = 7; r[0x03DA+y] = 7; r[0x03B0+y] = 0x5E; r[0x03B7+y] = 0x5E; }
  } else if (x === 1) {
    for (y = 2; y >= 0; y--) { r[0x03C9] = 7; r[0x03DE+y] = 7; r[0x03E5+y] = 7; r[0x03BB+y] = 0x5E; r[0x03C2+y] = 0x5E; }
  } else {
    for (y = 1; y >= 0; y--) { r[0x03C9] = 7; r[0x03CA+y] = 7; r[0x03D1+y] = 7; r[0x03D8+y] = 7; r[0x03A7+y] = 0x5E; r[0x03AE+y] = 0x5E; r[0x03B5+y] = 0x5E; }
  }
}; // bossPartGone

/**
 * ★ `$5DB1`: the boss dies — every sprite not yet `$7A` becomes the explosion
 * `$5E` in colour 7, then every four frames the explosions step until one
 * reaches `$6C`: all become `$7A` and the level ends. Random explosion sounds.
 */
Enemies.prototype.bossDeath = function () {
  var r = this.ram, s = this.ship, x;
  if (!(r[0x0249] & 0x80)) {
    r[0x0249] = 0x80;
    r[0x024D] = 6;
    for (x = 0x22; x >= 0; x--) {
      if (r[0x03A6+x] === 0x7A) { continue; }
      r[0x03A6+x] = 0x5E; r[0x03C9+x] = 7; r[0x03C9] = 7;
    }
    return;
  }
  r[0x024D] = (r[0x024D]-1) & 0xFF;
  if (r[0x024D]) { return; }
  r[0x024D] = 4;
  for (x = 0x22; x >= 0; x--) {
    var a = r[0x03A6+x];
    if (a === 0x7A) { continue; }
    if (a === 0x6C) {
      for (x = 0x22; x >= 0; x--) { r[0x03A6+x] = 0x7A; }
      this.levelEnd();
      return;
    }
    r[0x03A6+x] = (a+1) & 0xFF;
  }
  s.sound(((s.rnd() & 3)+0x0E) & 0xFF);
}; // bossDeath

/** ★ `$5E17`: the level is over — the main loop takes the next one (M5). */
Enemies.prototype.levelEnd = function () {
  var r = this.ram;
  r[0x0249] = 0; r[0x0242] = 0; r[0x024C] = 0;
  r[0x0233] = 0;
  r[0x0232] = (r[0x0232]+1) & 0xFF;
  r[0x0310] = (r[0x0310]+1) & 0xFF;
  var x = r[0x0200]+1;
  if (x >= 8 && (r[0x2820] === 0 || r[0x281A] === 0)) { x = 0xD3; }
  r[0x0200] = x & 0xFF;
  this.ship.levelOver = true;
  if (this.ship.rules) { this.ship.rules.event('levelEnd'); }
}; // levelEnd

/**
 * ★ `$57AF`-`$57F9` after the last row: the flash of a hit counted down
 * (`$58EB`, the colours restored from the level's table), the level's own
 * boss step (`JSR ($57F8)`), and row 0's pointers patched into the row
 * handler for the next frame (`$5860`…). Unless the game is paused.
 */
Enemies.prototype.bossTail = function () {
  var r = this.ram;
  r[0x74] = 0;
  if (!r[0x024E]) {
    if (r[0x03C9] & 0x80) {
      r[0x58EB] = (r[0x58EB]-1) & 0xFF;
      if (!r[0x58EB]) {
        r[0x57EF] = r[0x7ACB]; r[0x57F0] = r[0x7ACC];
        var t = r[0x57EF] | r[0x57F0] << 8;
        for (var x = 0x22; x >= 0; x--) { r[0x03C9+x] = r[t+x]; }
      }
    }
    // ★ the raster-202 handler nests into the boss's step too (`irq202InBoss`): before the level's step
    // when it came before the JSR $57F7, else after it
    if (this.irqNest && !this.irqYielded && this.irqNest.pc < 0x57F7) { this.irqYielded = true; this.irqOnNest(); }
    if (this.levelCode) { this.levelCode.bossStep(); }
    if (this.irqNest && !this.irqYielded) { this.irqYielded = true; this.irqOnNest(); }
  }
  r[0x5860] = r[0x03A6]; r[0x5865] = r[0x03AD]; r[0x586A] = r[0x03B4]; r[0x586F] = r[0x03BB]; r[0x5874] = r[0x03C2];
}; // bossTail

/**
 * The boss's rows as the chain shows them (`$585D` per row): for row n of
 * `$58EA` the Y `$0398+n`, five X with their high bits (`$03EC+7k+n`,
 * `$040F+n`), pointers (`$03A6+7k+n`) and colours (`$03C9+7k+n`); level 1
 * expands sprites in X by `$58E2+n`.
 * @returns {Array<Object>} rows of `{y, sprites: [{x, pointer, color}], expand}`.
 */
Enemies.prototype.bossRows = function () {
  var r = this.ram, out = [];
  for (var n = 0; n < r[0x58EA]; n++) {
    var sprites = [];
    for (var k = 0; k < 5; k++) {
      sprites.push({x: r[0x03EC+7*k+n] | ((r[0x040F+n] >> (3+k)) & 1) << 8, pointer: r[0x03A6+7*k+n], color: r[0x03C9+7*k+n]});
    }
    var row = {y: r[0x0398+n], sprites: sprites};
    if (this.ship.levelIndex === 0) { row.expand = r[0x58E2+n]; }   // $58C4: only level 1 writes $D01D/$D01C
    out.push(row);
  }
  return out;
}; // bossRows

// ---------------------------------------------------------------- the multiplexer's listing

/**
 * The sprites 3-7 of a group as the bands of the chain write them
 * (`$0EC5`/`$0D5C` group 0, `$0F6C`/`$0FB7` group 1, `$1066`/`$10B6` group 2):
 * a slot in use gives Y, X with its high bit, the pointer and the colour.
 * @param {number} g - 0-2.
 * @returns {Array<?{x:number, y:number, pointer:number, color:number}>} five entries, null = not written.
 */
Enemies.prototype.group = function (g) {
  var r = this.ram, out = [];
  for (var i = 0; i < 5; i++) {
    var x = g*5+i;
    if (!r[0x044C+x]) { out.push(null); continue; }
    out.push({x: r[0x82+x] | (r[0x91+x] ? 0x100 : 0), y: r[0xA0+x], pointer: r[0xAF+x], color: r[0xBE+x]});
  }
  return out;
}; // group

// published as a global: `Ship` constructs it (the worker has `self`, a Node tool the real global)
if (typeof self !== 'undefined') { self.Enemies = Enemies; } else if (typeof globalThis !== 'undefined') { globalThis.Enemies = Enemies; }
if (typeof module !== 'undefined' && module.exports) { module.exports = Enemies; }
