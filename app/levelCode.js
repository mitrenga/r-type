// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The code every level brings in its own files — the original's, routine
 * by routine (`sources/asm/level<N>.asm`, `sources/docs/disasm_notes.md` §12):
 *
 * - the **hook of the interrupt chain** (`$13BA`, called at `$0E82` after
 *   the ship's step): what the level animates and how it ends when it has
 *   no boss of the core's kind — level 1's stars and the tail of its boss,
 *   level 2's glyphs and its end object in the screen, level 3's end when
 *   the window has climbed and the enemies are gone, levels 6 and 7 with the
 *   waves running on after the scroll;
 * - the **boss step** in `M` (`$7ACD/$7ACE`, called at `$57F7` after the
 *   boss's rows): the boss's movement and shooting of levels 1, 4, 5 and 8.
 *
 * The variables sit at their addresses in the {@link Ship}'s `ram`; glyphs
 * and sprite shapes the code draws go to the ship's `high` memory (what the
 * screen makes of them is M7).
 *
 * @constructor
 * @param {Ship} ship
 * @param {Enemies} enemies
 */
function LevelCode(ship, enemies) {
  this.ship = ship;
  this.enemies = enemies;
  this.ram = ship.ram;
} // LevelCode

/**
 * ★ What the level's init (`$139A`) leaves for this code: level 1's `$1224`
 * ends in `$9531` — the tail's phase `$0C` moved on and its segments drawn
 * into the sprites under the KERNAL; the other levels' inits touch glyphs
 * only (`levelScroll.js`, `charsets.json`).
 */
LevelCode.prototype.init = function () {
  if (this.ship.levelIndex === 0) { this.tailRedraw1(); }
}; // init

/** The level's hook of the chain (`$0E82`), by the level's index. */
LevelCode.prototype.hook = function () {
  switch (this.ship.levelIndex) {
    case 0: this.hook1(); break;
    case 1: this.hook2(); break;
    case 2: this.hook3(); break;
    case 3: this.hook4(); break;
    case 5: this.hook6(); break;
    case 6: this.hook7(); break;
  }
}; // hook

/**
 * ★ A hook ending the level (`PLA; PLA; JMP $5E17`) drops the rest of the
 * raster-202 handler — `$0B5F` is never cleared again and the handlers
 * skip the game from then on; the main loop takes the next level (M5).
 */
LevelCode.prototype.endFromHook = function () {
  this.enemies.levelEnd();
  this.ship.hookEnded = true;
}; // endFromHook

/** The level's boss step (`$57F7`), by the level's index. */
LevelCode.prototype.bossStep = function () {
  switch (this.ship.levelIndex) {
    case 0: this.boss1(); break;
    case 3: this.boss4(); break;
    case 4: this.boss5(); break;
    case 7: this.boss8(); break;
  }
}; // bossStep

// ---------------------------------------------------------------- level 1

/**
 * ★ `$940A`: level 1's hook — the stars: random bits into the star glyphs
 * (`$C578`, mirrored to `$E578`) while the map pointer is below `$9B5E`,
 * random bits cleared up to `$9BB0`, and past that the tail of the boss;
 * in the first columns (`$9A00`-`$9AD2`) the six shooting stars (`$945C`).
 */
LevelCode.prototype.hook1 = function () {
  var r = this.ram, s = this.ship;
  if (r[0x0202] === 0x9A && r[0x0201] < 0xD3) { this.stars1(); return; }
  var x = (r[0x94D6]+1) & 0xFF;
  if (x >= 0x88) { x = 0; }
  var v;
  if (r[0x0202] === 0x9A || r[0x0201] < 0x5E) {
    v = (s.hi(0xCA30+x) & s.rnd()) | s.hi(0xC578+x);
  } else if (r[0x0201] < 0xB0) {
    v = s.hi(0xC578+x) & s.rnd();
  } else {
    this.tail1();
    return;
  }
  s.hw(0xC578+x, v); s.hw(0xE578+x, v);
  r[0x94D6] = x;
}; // hook1

/** ★ `$945C`: six shooting stars, each a bit rolled through a row of glyph bytes on its own clock. */
LevelCode.prototype.stars1 = function () {
  var r = this.ram, s = this.ship;
  for (var y = 5; y >= 0; y--) {
    var x = (r[0x94BE+y]-1) & 0xFF;
    r[0x94BE+y] = x;
    if (x) { continue; }
    r[0x94BE+y] = r[0x94B8+y];
    x = (((r[0x94CA+y] << 3) & 0xFF)+r[0x94D0+y]) & 0xFF;
    var old = s.hi(0xC578+x), nv = (old << 1) & 0xFF;
    s.hw(0xC578+x, nv); s.hw(0xE578+x, nv);
    if (!(old & 0x80)) { continue; }
    var a = r[0x94CA+y], v;
    if (a) {
      r[0x94CA+y] = (a-1) & 0xFF;
      x -= 8;
      if (x >= 0) { s.hw(0xC578+x, 1); s.hw(0xE578+x, 1); continue; }
    }
    r[0x94CA+y] = 0x10;                                   // $9495: the star starts again at the top
    x = (0x80+r[0x94D0+y]) & 0xFF;
    v = r[0x0201] >= 0x96 ? 0 : 1;
    s.hw(0xC578+x, v); s.hw(0xE578+x, v);
  }
}; // stars1

/**
 * ★ `$94D7`: the tail of level 1's boss, eight segments of sprite shapes
 * under the KERNAL (`$FD40`…) redrawn every other frame from the tables of
 * `G` — while the scroll stands, the boss lives and its countdown runs.
 */
LevelCode.prototype.tail1 = function () {
  var r = this.ram, x, a;
  if (r[0x0221] || r[0x0249]) { return; }
  if ((r[0x8652] | r[0x8653]) === 0) { return; }
  if (r[0x0B]) { return; }
  r[0x0A] = (r[0x0A]-1) & 0xFF;
  if (r[0x0A]) { return; }
  r[0x0A] = 2;
  r[0x0B] = (r[0x0B]+1) & 0xFF;
  r[0x09] = 7;
  for (;;) {                                              // $94FC: the old segments erased
    x = r[0x09];
    this.tailSegment1(x);
    this.tailAt1(r[0x0C]);
    this.tailErase1();
    a = r[0x961D];
    if (a < 0x28) { this.tailSet1((a+8) & 0xFF, r[0x0C]); this.tailErase1(); }
    r[0x09] = (r[0x09]-1) & 0xFF;
    if (r[0x09] & 0x80) { break; }
  }
  this.tailRedraw1();
}; // tail1

/** ★ `$9531`: the tail's phase `$0C` moved on and its eight segments drawn (the init of level 1 enters here too). */
LevelCode.prototype.tailRedraw1 = function () {
  var r = this.ram, x, a;
  x = (r[0x0C]+1) & 0xFF;                                 // $9531
  if (x === 0x30) { x = 0; }
  r[0x0C] = x;
  r[0x09] = 7;
  for (;;) {                                              // $9540: the new ones drawn
    x = r[0x09];
    this.tailSegment1(x);
    this.tailAt1(r[0x0C]);
    r[0x07] = 0;
    this.tailDraw1();
    a = r[0x961D];
    if (a < 0x28) { this.tailSet1((a+8) & 0xFF, r[0x0C]); r[0x07] = 1; this.tailDraw1(); }
    r[0x09] = (r[0x09]-1) & 0xFF;
    if (r[0x09] & 0x80) { break; }
  }
  r[0x0B] = 0;
}; // tailRedraw1

/** `$94FE`-`$9513`: the operands of `$95C2` and `$95CC` point at segment `x`'s X and Y tables. */
LevelCode.prototype.tailSegment1 = function (x) {
  var r = this.ram;
  r[0x95C3] = r[0x95FD+x]; r[0x95C4] = r[0x9605+x];
  r[0x95CD] = r[0x960D+x]; r[0x95CE] = r[0x9615+x];
}; // tailSegment1

/** ★ `$95C0`: the segment's X at phase `x` → `$95C5`. */
LevelCode.prototype.tailAt1 = function (x) {
  var r = this.ram;
  this.tailSet1(r[(r[0x95C3] | r[0x95C4] << 8)+x], x);
}; // tailAt1

/** ★ `$95C5`: the sprite (`$02`) by X / 8, the row (`$961E`) by phase `x`, the shape column (`$04`) by X & 7. */
LevelCode.prototype.tailSet1 = function (a, x) {
  var r = this.ram;
  r[0x961D] = a;
  var y = a >> 3;
  r[0x961E] = r[(r[0x95CD] | r[0x95CE] << 8)+x];
  r[0x02] = r[0x991F+y]; r[0x03] = r[0x9925+y];
  var k = r[0x961D] & 7;
  r[0x04] = r[0x95ED+k]; r[0x05] = r[0x95F5+k];
}; // tailSet1

/** ★ `$95A7`: ten rows of the sprite cleared from row `$961E`. */
LevelCode.prototype.tailErase1 = function () {
  var r = this.ram, s = this.ship;
  var y = r[0x961E];
  r[0x06] = y;
  var p = r[0x02] | r[0x03] << 8;
  for (var x = 10; ; ) {
    s.hw(p+r[0x992B+y], 0);
    if (--x === 0) { break; }
    r[0x06] = (r[0x06]+1) & 0xFF;
    y = r[0x06];
  }
}; // tailErase1

/** ★ `$9582`: ten rows of the shape column ORed into the sprite from row `$961E`, every other byte from `$07`. */
LevelCode.prototype.tailDraw1 = function () {
  var r = this.ram, s = this.ship;
  r[0x06] = r[0x961E];
  var p = r[0x02] | r[0x03] << 8, q = r[0x04] | r[0x05] << 8;
  for (var x = 10; ; ) {
    r[0x08] = r[q+r[0x07]];
    var at = p+r[0x992B+r[0x06]];
    s.hw(at, s.hi(at) | r[0x08]);
    if (--x === 0) { break; }
    r[0x07] = (r[0x07]+2) & 0xFF;
    r[0x06] = (r[0x06]+1) & 0xFF;
  }
}; // tailDraw1

/**
 * ★ `$8528`: level 1's boss step — while the scroll stands, the hit zones
 * of the tail by its phase (`$0420`…, the weak spot `$0416` from `$99F7`),
 * a countdown (`$8652/$8653`) that opens the weak spot at row 11; every
 * other frame the arms (five sprite columns) move left a pixel; then,
 * while the game runs, a bullet from the middle column every `$024B` frames.
 */
LevelCode.prototype.boss1 = function () {
  var r = this.ram, s = this.ship, x, y;
  if (r[0x0249] || r[0x0236]) {
    r[0x8651] = 2; r[0x8653] = 2; r[0x8652] = 0xD6;
    return;
  }
  r[0x0777] = r[0x0221];
  var shoot = false;
  if (!r[0x0221]) {
    x = r[0x0C] >> 3;
    r[0x0420] = r[0x0421] = r[0x8659+x];
    r[0x0422] = r[0x0423] = r[0x8661+x];
    r[0x0424] = r[0x0425] = r[0x8669+x];
    r[0x0426] = r[0x0427] = r[0x8671+x];
    r[0x0416] = r[0x99F7+x];
    if (r[0x8653] || r[0x8652]) {
      if (!r[0x8652]) { r[0x8653] = (r[0x8653]-1) & 0xFF; }
      r[0x8652] = (r[0x8652]-1) & 0xFF;
      if (r[0x8652] | r[0x8653]) { shoot = true; }
      else { r[0x0416] = 0x0B; }
    }
  }
  if (!shoot) {                                           // $859A
    r[0x8651] = (r[0x8651]-1) & 0xFF;
    if (r[0x8651]) { shoot = true; }
    else {
      r[0x8651] = 2;
      for (x = 4; x >= 0; x--) {
        var p = r[0x8647+x] | r[0x864C+x] << 8;
        r[0x39] = p & 0xFF; r[0x3A] = p >> 8;
        for (y = 6; y >= 0; y--) {
          var v = r[p+y]-1;
          r[p+y] = v & 0xFF;
          if (v < 0) { r[0x040F+y] ^= r[0x8654+x]; }
        }
      }
      r[0x77] = r[0x03EC];
      r[0x78] = r[0x040F] & 8;
      return;
    }
  }
  // $85D7
  if (r[0x0B5D] || r[0x0221]) { return; }
  r[0x024B] = (r[0x024B]-1) & 0xFF;
  if (r[0x024B]) { return; }
  r[0x024B] = ((s.rnd() & 0x19)+0x10) & 0xFF;             // ★ ADC #$0F with the carry of $57B2's CPX
  for (y = 9; y >= 0; y--) { if (!r[0x02E5+y]) { break; } }
  if (y < 0) { return; }
  r[0x02EF+y] = s.rnd() & 1;
  r[0x0334+y] = (((s.rnd() & 7)+1) | 0x80) & 0xFF;
  r[0x033E+y] = s.rnd() & 0x83;
  var hx = (r[0x03FA] >> 1) | ((r[0x040F] & 8) ? 0x80 : 0);
  if (hx < 8) { return; }
  hx -= 8;
  if (hx < 0x28 || hx >= 0xA0) { return; }
  r[0x0348+y] = hx;
  r[0x0352+y] = 0x5C;
  r[0x0366+y] = 0xD3;
  r[0x02E5+y] = 1;
}; // boss1

// ---------------------------------------------------------------- level 2

/** ★ `$9478` / `$93C1`: twelve glyph rows of the upper set rotated right by a byte chain, three groups of four (levels 2 and 7). */
LevelCode.prototype.rotateRight = function () {
  var s = this.ship;
  for (var x = 7; x >= 0; x--) {
    for (var g = 0; g < 3; g++) {
      var base = 0xC5A0+g*0x20+x;
      var c = s.hi(base) & 1;
      var chain = [base+8, base+0x10, base+0x18, base];
      for (var i = 0; i < 4; i++) {
        var v = s.hi(chain[i]), c2 = v & 1;
        s.hw(chain[i], (v >> 1) | (c << 7));
        c = c2;
      }
    }
  }
}; // rotateRight

/**
 * ★ `$943B`: level 2's hook. While the scroll runs: the end object's hits
 * reset to 8, every third frame the glyphs rotate (copied to the lower set
 * past column `$9B49`), and at column `$9B4A` the colour table and the
 * upper set switch (the scroll's part) and the music changes. After it: the
 * wave column goes on every 16 frames (back from `$BE` to `$1A` with the wave
 * pointer `$A0` back — the last waves loop), a flash of the background,
 * and the end object: four chars at row 9 redrawn every frame, a shot on
 * them flashes, costs a hit and animates the glyphs; at eight hits every
 * slot explodes and the level ends.
 */
LevelCode.prototype.hook2 = function () {
  var r = this.ram, s = this.ship, x;
  if (r[0x0221]) {
    r[0x95DA] = r[0x9444];                                // ★ LDA #$08 — an operand (the harness sets it to 1)
    r[0x95D4] = (r[0x95D4]-1) & 0xFF;
    if (r[0x95D4]) {
      if (r[0x0202] === 0x9B && r[0x0201] === 0x4A) {
        r[0x64] = 0x38;
        r[0x3685] = 0x7B; r[0x3686] = 0x93;
        r[0x0B5E] = 0;
        s.music(0);
      }
      return;
    }
    r[0x95D4] = 3;
    this.rotateRight();
    if (r[0x0202] === 0x9B && r[0x0201] >= 0x49) {
      for (x = 0x5F; x >= 0; x--) { s.hw(0xE5A0+x, s.hi(0xC5A0+x)); }
    }
    return;
  }
  if (r[0x0202] === 0x9A) { return; }                     // $94C7
  r[0x95D5] = (r[0x95D5]-1) & 0xFF;
  if (!r[0x95D5]) {
    r[0x95D5] = 0x10;
    var p = ((r[0x0201] | r[0x0202] << 8)+1) & 0xFFFF;
    r[0x0201] = p & 0xFF; r[0x0202] = p >> 8;
    if (r[0x0201] === 0xBE) {
      r[0x0201] = 0x1A;
      var w = ((r[0x7A] | r[0x7B] << 8)-0xA0) & 0xFFFF;
      r[0x7A] = w & 0xFF; r[0x7B] = w >> 8;
    }
    s.scroll.pointer = r[0x0201] | r[0x0202] << 8;
  }
  if (r[0x021E] === 1) {                                  // $94F9
    r[0x95D9] = (r[0x95D9]-1) & 0xFF;
    if (!r[0x95D9]) { r[0x021E] = 8; r[0x021F] = 9; }
  }
  if (r[0x95D8]) { r[0x95D8] = (r[0x95D8]-1) & 0xFF; return; }   // $951B
  r[0x95D6] = (r[0x95D6]-1) & 0xFF;
  if (r[0x95D6]) {
    if (r[0x0236]) { return; }                            // $951F
    var hit = false;
    for (x = 3; x >= 0; x--) {
      if (s.sc(0xCD79+x) >= 0xCC) { hit = true; break; }
      s.sw(0xCD79+x, x+0x24); s.cw(0xCD79+x, 0x0E);
    }
    if (!hit) { return; }
    r[0x021E] = 1; r[0x021F] = 0x0E;                      // $953D
    r[0x95D9] = 5;
    r[0x95D8] = 0xFF;
    r[0x95D7] = 0;
    r[0x95DA] = (r[0x95DA]-1) & 0xFF;
    if (!r[0x95DA]) {                                     // $955A: the end
      for (x = 14; x >= 0; x--) { r[0xBE+x] = 7; r[0xAF+x] = 0x61; r[0x060E+x] = 3; r[0x044C+x] = 0x80; }
      r[0x3685] = 0xAC; r[0x3686] = 0x8C;
      this.endFromHook();
      return;
    }
    r[0x95A0] = r[0x95DB]; r[0x95A1] = r[0x95E1]; r[0x95A6] = r[0x95E7]; r[0x95A7] = r[0x95ED];   // $9580 with X = 0
  }
  r[0x95D6] = 7;                                          // $9598
  var src1 = r[0x95A0] | r[0x95A1] << 8, src2 = r[0x95A6] | r[0x95A7] << 8;
  for (x = 0x1F; x >= 0; x--) { s.hw(0xE120+x, r[src1+x]); s.hw(0xE208+x, r[src2+x]); }
  x = (r[0x95D7]+1) & 0xFF;
  if (x >= 6) { x = 0; }
  r[0x95D7] = x;
  r[0x95A0] = r[0x95DB+x]; r[0x95A1] = r[0x95E1+x]; r[0x95A6] = r[0x95E7+x]; r[0x95A7] = r[0x95ED+x];
}; // hook2

// ---------------------------------------------------------------- level 3

/**
 * ★ `$9586`: level 3's hook — the music changes when the map pointer reaches
 * `$9C00`; once the window's script is past phase `$16` and no slot is in
 * use, the level ends.
 */
LevelCode.prototype.hook3 = function () {
  var r = this.ram, s = this.ship;
  if (r[0x0202] === 0x9C && r[0x0B5E]) { r[0x0B5E] = 0; s.music(0); }
  if (r[0x3AD7] < 0x16) { return; }
  if (r[0x0310]) { return; }
  for (var x = 14; x >= 0; x--) { if (r[0x044C+x]) { return; } }
  this.endFromHook();
}; // hook3

// ---------------------------------------------------------------- level 4

/** ★ `$918D`: level 4's six shooting stars — as level 1's, without the random bits (glyphs `$C598`). */
LevelCode.prototype.hook4 = function () {
  var r = this.ram, s = this.ship;
  for (var y = 5; y >= 0; y--) {
    var x = (r[0x91DB+y]-1) & 0xFF;
    r[0x91DB+y] = x;
    if (x) { continue; }
    r[0x91DB+y] = r[0x91D5+y];
    x = (((r[0x91E7+y] << 3) & 0xFF)+r[0x91ED+y]) & 0xFF;
    var old = s.hi(0xC598+x);
    s.hw(0xC598+x, (old << 1) & 0xFF);
    if (!(old & 0x80)) { continue; }
    var a = r[0x91E7+y];
    if (a) {
      r[0x91E7+y] = (a-1) & 0xFF;
      x -= 8;
      if (x >= 0) { s.hw(0xC598+x, 1); continue; }
    }
    r[0x91E7+y] = 0x0D;
    x = (0x68+r[0x91ED+y]) & 0xFF;
    s.hw(0xC598+x, 1);
  }
}; // hook4

/**
 * ★ `$845C`: level 4's boss step — three parts (`$5DAB` alive, `$5DAE`
 * hits) reset while the level is over or the ship dies; otherwise the parts
 * move by a script of twenty phases (`$91F4`: X of the columns and Y of the
 * rows per part, destroyed parts explode), part 1 shoots downwards from its
 * sprite, part 0 aimed bullets.
 */
LevelCode.prototype.boss4 = function () {
  var r = this.ram;
  if (!r[0x0310] && !r[0x0236]) {
    var c = this.parts4();
    if (r[0x5DAC]) { c = this.shoot4b(c); }
    if (!r[0x5DAB]) { return; }
    this.shoot4a(c);
    return;
  }
  r[0x94BD] = 1;                                          // $8466
  r[0x5DAB] = r[0x5DAC] = r[0x5DAD] = 1;
  r[0x94BE] = 0xFF;
  r[0x5DAE] = r[0x5DAF] = r[0x5DB0] = 0x7F;
  r[0x94BA] = r[0x94BB] = r[0x94BC] = 5;
  r[0x0777] = 0;
}; // boss4

/**
 * ★ `$91F4`: the parts of level 4's boss — the phase every `$94C4` frames,
 * the three parts' X steps and their rows' Y steps, destroyed parts
 * animating to `$7A`. Rows of columns: part 0 columns 0-2 rows 0-2, part 1
 * columns 3-4 rows 0-2, part 2 columns 1-2 rows 3-5.
 * @returns {number} the carry the routine leaves (the next add counts on it).
 */
LevelCode.prototype.parts4 = function () {
  var r = this.ram, x, y, c = 1;
  r[0x94BD] = (r[0x94BD]-1) & 0xFF;
  if (!r[0x94BD]) {
    y = (r[0x94BE]+1) & 0xFF;
    if (y >= 0x14) { y = 1; }
    r[0x94BE] = y;
    r[0x94BD] = r[0x94C4+y];
    r[0x94B4] = r[0x94D8+y]; r[0x94B5] = r[0x94EC+y]; r[0x94B6] = r[0x9500+y];
    r[0x94B7] = r[0x9514+y]; r[0x94B8] = r[0x9528+y]; r[0x94B9] = r[0x953C+y];
  }
  for (x = 2; x >= 0; x--) {
    if (r[0x5DAB+x] & 0x80) {                             // $923E: a destroyed part explodes
      r[0x94BA+x] = (r[0x94BA+x]-1) & 0xFF;
      if (!r[0x94BA+x]) {
        r[0x94BA+x] = 4;
        var ptrs, cols, rows;
        if (x === 2) { ptrs = [0x03B0, 0x03B7]; cols = [0x03D3, 0x03DA]; rows = 2; }
        else if (x === 1) { ptrs = [0x03BB, 0x03C2]; cols = [0x03DE, 0x03E5]; rows = 2; }
        else { ptrs = [0x03A7, 0x03AE, 0x03B5]; cols = [0x03CA, 0x03D1, 0x03D8]; rows = 1; }
        if (r[ptrs[0]] >= 0x6C) {
          for (y = rows; y >= 0; y--) { for (var i = 0; i < ptrs.length; i++) { r[ptrs[i]+y] = 0x7A; } }
          r[0x5DAB+x] = 0;
        } else {
          for (y = rows; y >= 0; y--) {
            for (i = 0; i < ptrs.length; i++) { r[ptrs[i]+y] = (r[ptrs[i]+y]+1) & 0xFF; r[cols[i]+y] = 7; }
          }
        }
      }
    }
    // $9312: the part's X step
    r[0x02] = x;
    r[0x9321] = r[0x94AE+x]; r[0x9322] = r[0x94B1+x];
    var d = r[0x94B4+x];
    if (d) {
      var columns = x === 0 ? [0x03EC, 0x03F3, 0x03FA] : x === 1 ? [0x0401, 0x0408] : [0x03F3, 0x03FA];
      var bits = x === 0 ? [0x08, 0x10, 0x20] : x === 1 ? [0x40, 0x80] : [0x10, 0x20];
      var from = x === 2 ? 5 : 2, to = x === 2 ? 3 : 0;
      for (y = from; y >= to; y--) {
        for (i = 0; i < columns.length; i++) {
          var v = r[columns[i]+y]+(d & 0x80 ? 1 : -1);
          r[columns[i]+y] = v & 0xFF;
          if (v < 0 || v > 0xFF) { r[0x040F+y] ^= bits[i]; }
        }
      }
    }
    // $946A: the rows' Y step
    r[0x0777] = r[0x039B] >= 0x73 ? 1 : 0;
    c = r[0x039B] >= 0x73 ? 1 : 0;
    y = r[0x02];
    var x2 = r[0x94A8+y], dy = r[0x94B7+y];
    if (dy) {
      do {
        r[0x0398+x2] = (r[0x0398+x2]+(dy & 0x80 ? -1 : 1)) & 0xFF;
        r[0x039F+x2] = (r[0x039F+x2]+(dy & 0x80 ? -1 : 1)) & 0xFF;
        x2 = (x2-1) & 0xFF;
      } while (x2 !== r[0x94AB+y]);
      c = 1;
    }
  }
  return c;
}; // parts4

/** ★ `$84A8`: part 1 shoots a straight bullet downwards every `$024B` frames (random 4-19, plus the carry). */
LevelCode.prototype.shoot4b = function (c) {
  var r = this.ram, s = this.ship;
  if (r[0x0B5D]) { return c; }
  r[0x024B] = (r[0x024B]-1) & 0xFF;
  if (r[0x024B]) { return c; }
  var t = (s.rnd() & 0x0F)+4+c;
  r[0x024B] = t & 0xFF;
  c = t > 0xFF ? 1 : 0;
  var y;
  for (y = 9; y >= 0; y--) { if (!r[0x02E5+y]) { break; } }
  if (y < 0) { return c; }
  r[0x02EF+y] = 1; r[0x0334+y] = 8; r[0x033E+y] = 0;
  var hx = (r[0x0408] >> 1) | ((r[0x040F] & 0x80) ? 0x80 : 0);
  if (hx >= 0xA0) { return 1; }
  r[0x0348+y] = hx;
  t = (s.rnd() & 0x1F)+r[0x0398];                         // ADC with C = 0 (the CMP fell through), then SBC with its carry
  var cc = t > 0xFF ? 1 : 0;
  var v = (t & 0xFF)-0x1C-(1-cc);
  r[0x0352+y] = v & 0xFF;
  r[0x0366+y] = 0xD3;
  r[0x02E5+y] = 1;
  return v < 0 ? 0 : 1;
}; // shoot4b

/** ★ `$8503`: part 0 shoots an aimed bullet every `$024A` frames (random 5-12, plus the carry). */
LevelCode.prototype.shoot4a = function (c) {
  var r = this.ram, s = this.ship;
  if (r[0x0B5D]) { return; }
  r[0x024A] = (r[0x024A]-1) & 0xFF;
  if (r[0x024A]) { return; }
  r[0x024A] = ((s.rnd() & 7)+5+c) & 0xFF;
  var y;
  for (y = 9; y >= 0; y--) { if (!r[0x02E5+y]) { break; } }
  if (y < 0) { return; }
  r[0x02EF+y] = 0; r[0x0334+y] = 0x83; r[0x033E+y] = s.rnd() & 0x83;
  var hx = (r[0x03EC] >> 1) | ((r[0x040F] & 8) ? 0x80 : 0);
  if (hx < 8) { return; }
  hx -= 8;
  if (hx < 8 || hx >= 0xA0) { return; }
  r[0x0348+y] = hx;
  var t = (s.rnd() & 0x0F)+r[0x0398];
  var cc = t > 0xFF ? 1 : 0;
  r[0x0352+y] = ((t & 0xFF)-0x14-(1-cc)) & 0xFF;
  r[0x0366+y] = 0xD3;
  r[0x02E5+y] = 1;
}; // shoot4a

// ---------------------------------------------------------------- level 5

/**
 * ★ `$82F8`: level 5's boss step — reset while it dies or the ship does;
 * else a random walk in X (`$8330`: columns 0-4 by `$8463` a frame, turning
 * at the edges) and in Y (`$83C4`: all rows a pixel, between `$33` and
 * `$6E`), and every ninth frame one sprite's pointer flips its low bit
 * (`$8414`); the boss's X and high bit into `$77`/`$78` for the hit scan.
 */
LevelCode.prototype.boss5 = function () {
  var r = this.ram, s = this.ship, x, y;
  if (r[0x0249] || r[0x0236]) {
    r[0x8461] = r[0x8462] = 0x32;
    r[0x845F] = 1; r[0x8460] = 0; r[0x8463] = 4;
    return;
  }
  // $8330: X
  r[0x8461] = (r[0x8461]-1) & 0xFF;
  if (!r[0x8461]) {
    var v = s.rnd();
    r[0x845F] = v & 0x80;
    r[0x8461] = v | 1;
    r[0x8463] = (v | 1) & 3;
  }
  var dir = r[0x845F];
  if (dir & 0x80) {
    if (r[0x0411] & 8) { r[0x845F] = 1; }
    else {
      for (x = 4; x >= 0; x--) {
        var p = r[0x8455+x] | r[0x845A+x] << 8;
        r[0x39] = p & 0xFF; r[0x3A] = p >> 8;
        for (y = 4; y >= 0; y--) {
          var t = r[p+y]+r[0x8463];
          r[p+y] = t & 0xFF;
          if (t > 0xFF) { r[0x040F+y] |= r[0x8464+x]; }
        }
      }
    }
  } else if (dir) {
    if (!(r[0x0411] & 8) && r[0x03EE] < 0x18) { r[0x845F] = 0x80; }
    else {
      for (x = 4; x >= 0; x--) {
        p = r[0x8455+x] | r[0x845A+x] << 8;
        r[0x39] = p & 0xFF; r[0x3A] = p >> 8;
        for (y = 4; y >= 0; y--) {
          t = r[p+y]-r[0x8463];
          r[p+y] = t & 0xFF;
          if (t < 0) { r[0x040F+y] &= (~r[0x8464+x]) & 0xFF; }
        }
      }
    }
  }
  // $83C4: Y
  r[0x8462] = (r[0x8462]-1) & 0xFF;
  if (!r[0x8462]) {
    v = s.rnd();
    r[0x8460] = v & 0x80;
    r[0x8462] = (v & 0x3F) | 1;
  }
  dir = r[0x8460];
  if (dir & 0x80) {
    if (r[0x0398] >= 0x6E) { r[0x8460] = 1; }
    else { for (x = 6; x >= 0; x--) { r[0x0398+x] = (r[0x0398+x]+1) & 0xFF; r[0x039F+x] = (r[0x039F+x]+1) & 0xFF; } }
  } else if (dir) {
    if (r[0x0398] < 0x33) { r[0x8460] = 0x80; }
    else { for (x = 6; x >= 0; x--) { r[0x0398+x] = (r[0x0398+x]-1) & 0xFF; r[0x039F+x] = (r[0x039F+x]-1) & 0xFF; } }
  }
  // $8414: every sprite's own counter; at zero its pointer flips its low bit
  for (x = 0x22; x >= 0; x--) {
    r[0x8432+x] = (r[0x8432+x]-1) & 0xFF;
    if (r[0x8432+x]) { continue; }
    r[0x8432+x] = 9;
    if (r[0x03A6+x] !== 0x7A) { r[0x03A6+x] ^= 1; }
  }
  r[0x77] = r[0x03EE];
  r[0x78] = r[0x0411] & 8;
}; // boss5

// ---------------------------------------------------------------- level 6

/** ★ `$9298`: sixteen glyph rows of the upper set rotated left by a byte chain, four groups of four. */
LevelCode.prototype.rotateLeft6 = function () {
  var s = this.ship;
  for (var x = 7; x >= 0; x--) {
    for (var g = 0; g < 4; g++) {
      var base = 0xC400+g*0x20+x;
      var c = s.hi(base+0x18) >> 7;
      var chain = [base+0x10, base+8, base, base+0x18];
      for (var i = 0; i < 4; i++) {
        var v = s.hi(chain[i]), c2 = v >> 7;
        s.hw(chain[i], ((v << 1) & 0xFF) | c);
        c = c2;
      }
    }
  }
}; // rotateLeft6

/**
 * ★ `$9286`: level 6's hook — while the scroll runs the glyphs rotate every
 * third frame; after it the music changes at `$9B46`, the wave column goes
 * on every 16 frames (held while the ship dies), and at `$9C00` the level
 * ends.
 */
LevelCode.prototype.hook6 = function () {
  var r = this.ram, s = this.ship;
  if (r[0x0221]) {
    r[0x9328] = (r[0x9328]-1) & 0xFF;
    if (r[0x9328]) { return; }
    r[0x9328] = 3;
    this.rotateLeft6();
    return;
  }
  if (r[0x0202] === 0x9B && r[0x0201] === 0x46 && r[0x0B5E]) { r[0x0B5E] = 0; s.music(0); }
  if (r[0x0236]) { r[0x9329] = 0x10; return; }
  if (r[0x0202] === 0x9C) {
    if (!r[0x0310]) { this.endFromHook(); }
    return;
  }
  r[0x9329] = (r[0x9329]-1) & 0xFF;
  if (r[0x9329]) { return; }
  r[0x9329] = 0x10;
  var p = ((r[0x0201] | r[0x0202] << 8)+1) & 0xFFFF;
  r[0x0201] = p & 0xFF; r[0x0202] = p >> 8;
  s.scroll.pointer = p;
}; // hook6

// ---------------------------------------------------------------- level 7

/**
 * ★ `$93B6`: level 7's hook — as level 6's with level 2's glyph rotation;
 * after the scroll the end's glyph animation (`$9484`: 96 bytes into
 * `$C540` by phase, started over when the ship dies) and the end at `$9C96`.
 */
LevelCode.prototype.hook7 = function () {
  var r = this.ram, s = this.ship, x;
  if (r[0x0221]) {
    r[0x9490] = (r[0x9490]-1) & 0xFF;
    if (r[0x9490]) { return; }
    r[0x9490] = 3;
    this.rotateRight();
    return;
  }
  if (r[0x0202] === 0x9B && r[0x0201] === 0x31 && r[0x0B5E]) { r[0x0B5E] = 0; s.music(0); }
  if (r[0x0236]) {
    r[0x9492] = 0; r[0x9491] = 0x10;
    r[0x9487] = 0x9C; r[0x9488] = 0x94;
    r[0x9493] = 0x28;
  } else {
    if (r[0x0202] === 0x9C && r[0x0201] === 0x96) {
      if (!r[0x0310]) { this.endFromHook(); return; }
    } else {
      r[0x9491] = (r[0x9491]-1) & 0xFF;
      if (!r[0x9491]) {
        r[0x9491] = 0x10;
        var p = ((r[0x0201] | r[0x0202] << 8)+1) & 0xFFFF;
        r[0x0201] = p & 0xFF; r[0x0202] = p >> 8;
        s.scroll.pointer = p;
      }
    }
    x = r[0x9492];                                        // $9462
    if (x >= 4) { return; }
    r[0x9493] = (r[0x9493]-1) & 0xFF;
    if (r[0x9493]) { return; }
    r[0x9493] = 7;
    r[0x9487] = r[0x9494+x]; r[0x9488] = r[0x9498+x];
    r[0x9492] = (r[0x9492]+1) & 0xFF;
  }
  var src = r[0x9487] | r[0x9488] << 8;                   // $9484
  for (x = 0x5F; x >= 0; x--) { s.hw(0xC540+x, r[src+x]); }
}; // hook7

// ---------------------------------------------------------------- level 8

/**
 * ★ `$814C`: level 8's boss step — reset while it dies or the ship does;
 * while the scroll still runs the five columns move left a pixel every
 * other frame; then the mouth (`$81C1`: twelve phases of two pointers, the
 * weak spot and three zones every sixth frame), the eyes (`$81F8`: nine
 * phases of four pointers every ninth, a pause of 100 after), the
 * jaw glyphs (`$8240`: three phases every third frame, 72 bytes of the
 * panel set into `$C550`) and the char beam (`$8270`: three rows at `$CD40`
 * drawn back from column `$8325`).
 */
LevelCode.prototype.boss8 = function () {
  var r = this.ram, s = this.ship, x, y;
  if (r[0x0249] || r[0x0236]) {
    r[0x82BE] = 1; r[0x82C4] = 6; r[0x82C5] = 0; r[0x8324] = 0;
    r[0x82F6] = 0x64; r[0x82F7] = 0xFF;
    return;
  }
  if (r[0x0221]) {
    r[0x82BE] = (r[0x82BE]-1) & 0xFF;
    if (!(r[0x82BE] & 0x80)) { return; }
    r[0x82BE] = 1;
    for (x = 4; x >= 0; x--) {
      var p = r[0x82B4+x] | r[0x82B9+x] << 8;
      r[0x39] = p & 0xFF; r[0x3A] = p >> 8;
      for (y = 6; y >= 0; y--) {
        var v = r[p+y]-1;
        r[p+y] = v & 0xFF;
        if (v < 0) { r[0x040F+y] ^= r[0x82BF+x]; }
      }
    }
  }
  r[0x77] = r[0x03EC];                                    // $81A8
  r[0x78] = r[0x040F] & 8;
  // $81C1: the mouth
  r[0x82C4] = (r[0x82C4]-1) & 0xFF;
  if (!r[0x82C4]) {
    r[0x82C4] = 6;
    x = (r[0x82C5]+1) & 0xFF;
    if (x >= 0x0C) { x = 0; }
    r[0x82C5] = x;
    r[0x03AF] = r[0x82C6+x]; r[0x03B6] = r[0x82D2+x];
    r[0x0416] = r[0x82DE+x];
    r[0x041D] = r[0x041E] = r[0x041F] = r[0x82EA+x];
  }
  // $81F8: the eyes
  r[0x82F6] = (r[0x82F6]-1) & 0xFF;
  if (!r[0x82F6]) {
    r[0x82F6] = 9;
    x = (r[0x82F7]+1) & 0xFF;
    if (x >= 9) {
      r[0x82F7] = 0xFF;
      r[0x82F6] = 0x64;
    } else {
      if (x === 4) { r[0x8324] = 1; r[0x8325] = 0x24; }
      r[0x82F7] = x;
      r[0x03BC] = r[0x82F8+x]; r[0x03C3] = r[0x8301+x];
      r[0x03BD] = r[0x830A+x]; r[0x03C4] = r[0x8313+x];
    }
  }
  // $8240: the jaw glyphs
  r[0x831C] = (r[0x831C]-1) & 0xFF;
  if (!r[0x831C]) {
    r[0x831C] = 3;
    x = (r[0x831D]+1) & 0xFF;
    if (x >= 3) { x = 0; }
    r[0x831D] = x;
    r[0x8267] = r[0x831E+x]; r[0x8268] = r[0x8321+x];
    var src = r[0x8267] | r[0x8268] << 8;
    for (x = 0x47; x >= 0; x--) { s.hw(0xC550+x, s.hi(src+x)); }
  }
  // $8270: the beam in chars
  if (!r[0x8324]) { return; }
  y = r[0x8325];
  for (x = 2; x >= 0; x--) { s.sw(0xCD40+y, 0); s.sw(0xCD68+y, 0); s.sw(0xCD90+y, 0); y = (y-1) & 0xFF; }
  y = (r[0x8325]-1) & 0xFF;
  if (y === 2) { r[0x8324] = 0; return; }
  r[0x8325] = y;
  for (x = 2; x >= 0; x--) {
    s.sw(0xCD40+y, r[0x8326+x]); s.sw(0xCD68+y, r[0x8329+x]); s.sw(0xCD90+y, r[0x832C+x]);
    y = (y-1) & 0xFF;
  }
}; // boss8

if (typeof self !== 'undefined') { self.LevelCode = LevelCode; } else if (typeof globalThis !== 'undefined') { globalThis.LevelCode = LevelCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = LevelCode; }
