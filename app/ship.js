// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The ship and everything the player fires — the original's code, routine
 * by routine (`sources/docs/disasm_notes.md` §11, `sources/asm/main.asm`):
 * the ship step `$2821` (joystick, tilt, Force, collision with the terrain),
 * the game step `$3D74` (basic shots, the beam, the Force's shots, the three
 * lasers, missiles, explosions), the pickup of items `$1B61`, death `$31A2`
 * and the panel the ship writes to (BEAM meter, score, 1UP, lives).
 *
 * ★ **The variables live where the original keeps them.** `ram` is a flat
 * array of the first 24 KB of the machine, and the ship's state, the tables
 * it reads and the operands of its self-modifying instructions sit at their
 * addresses (`data/ship.json`, `tools/dumpship.py`). Screen pointers are
 * kept as the original keeps them too — low and high byte of a `$CCxx`
 * address — so `tools/matchship.mjs` compares the same bytes against the
 * running original, frame by frame, in every level. The screen and colour
 * RAM are the {@link LevelScroll}'s, the sprite shapes under the I/O are
 * `spriteRAM`, the VIC registers `vic`.
 *
 * ★ Where the original reads the CIA timer `$DC04` (its only entropy) this
 * code reads {@link Ship#rnd}, a 16-bit LFSR — the same generator the
 * measuring harness puts into the original (`tools/traceship.py`).
 *
 * The frame (`frame()`) follows the interrupt chain: the raster-48 handler
 * (blink, scroll step, the enemy loop `$17FB`), the main loop's wait for
 * `$0232`, the raster-202 handler `$0DE6` (bits into the sprite, score, the
 * game step, the ship step or the death animation, the level's hook). A
 * frame in which the screen shifted by a column skips the game step, as the
 * original does when the interrupt lands in the shift (`$0225`, §8).
 *
 * @constructor
 * @param {LevelScroll} scroll - The level in memory.
 */
function Ship(scroll) {
  this.scroll = scroll;
  /** $0000-$9FFF: zero page, the game's state pages, the variables of the core, the level's `M` and `G` (M4) */
  this.ram = new Uint8Array(0xA000);
  /** $D000-$DFFF under the I/O: the sprite shapes */
  this.spriteRAM = new Uint8Array(0x1000);
  /** $D000-$D02E */
  this.vic = new Uint8Array(0x2F);
  /** $C6E8-$C6EF: glyph $DD of the shared set, animated by the yellow laser */
  this.glyphDD = new Uint8Array(8);
  /** the joystick byte as port 2 gives it ($7F idle) and the space bar */
  this.joystick = 0x7F;
  this.space = false;
  /** a script of (byte, frames) segments replaces the live input (the harness) */
  this.script = null;
  /** ★ the harness patch $319C = RTS — the tools set it from the recording's metadata, the worker from `init` */
  this.immortal = false;
  /** the LFSR state ($6004/$6005 in the harness) */
  this.seed = 1;
  /**
   * ★ Where the main loop `$08C1` stands between two interrupts (M5,
   * `app/gameRules.js`): `top` — polling `$0B5D` and `$0232` (`$08D6`-`$093A`);
   * `wait` — in the 20-tick wait `$094B` with `y` ticks counted (a tick is
   * `$0977`, set by every raster-48 handler and cleared by the wait, so the
   * first tick of a wait entered during play is free: 19 frames); `ready` —
   * inside READY (`$0B6C`); `off` — the level-end sequence or tapeEnd.
   * `entered` is false until `$08C1` ran (the lives panel). `raceSkip`: the
   * poll had loaded `$0B5D` before the handler of a death set it (`irq202`).
   */
  this.loop = {at: 'top', y: 0, entered: false, raceSkip: false};
  /** M5: the rules around the level — READY, the restart, the level end, the game over (`app/gameRules.js`) */
  this.rules = null;
  /** harness scenario `c` (`tools/tracerules.py`): immortal while the joystick-read counter $6002/$6003 is below this */
  this.mortalAfter = 0;
  /** the live F7 key — the original's pause (`$0E96`) */
  this.f7 = false;
  /** set by the main loop: READY began in this frame / the level-end sequence began (no raster-202 handler then) */
  this.readyBegun = false;
  this.sequenceBegun = false;
  /** set by the frame: the screen shifted by a column ($0225 at raster 202) */
  this.shifted = false;
  /**
   * ★ The column shift outlasts the frame: the next raster-48 handler nests
   * into it (`$0225` still set — measured on every 16th sample of every
   * horizontal level), so that frame has no enemy loop either and the main
   * loop loses a pass. Level 3's redraw is done by then.
   */
  this.shiftedLast = false;
  /**
   * ★ The column shift is ~16 000 cycles of work the chain's handlers nest
   * into (`LevelScroll.stepHorizontal`): band 5 with the state machine and
   * the raster-202 handler of the shift's frame, and those of the next one
   * if it is still running — each sees the rows copied so far, the map
   * pointer old or new, the new column's rows drawn so far. `columnTiming`
   * is the measured state of the shift at those points in a recording
   * (`tools/traceenemies.py --timing`, `timing.json`: frame →
   * `{band5: {progress}, irq202: {progress, gameStep}, ends}`); without it
   * {@link Ship#shiftEstimate} stands in — the typical state measured.
   */
  this.columnTiming = null;
  /** the running shift: the frame it started in and the frame its RTI falls in */
  this.shiftInfo = null;
  this.frameCount = 0;
  /** whether the raster-202 handler of this frame found the shift over ($0225 clear): the game step runs */
  this.shiftGameStep = true;
  /** ★ measured: the raster-202 handler of the frame before was still running ($0B5F) — this one does nothing ($0E49) */
  this.irqOuter = false;
  /** level 3: the enemy loop of a redraw frame runs after the redraw, at the end of the frame */
  /** the slot the enemy loop goes on from after band 5 (measured: band 5 nested into the loop there), -1 none */
  this.band5Done = false;
  /** group 0 of the multiplexer after the frame's enemy loop, before its state machine */
  this.groupAfterLoop = null;
  /** ★ $0D30: whether this frame's chain is the boss's (decided at raster 48, kept for the frame) */
  this.bossChain = false;
  /** the life is over: the main loop goes to READY and the restart (M5) */
  this.ready = false;
  this.gameOver = false;
  /** the level is over (`$5E17`): the main loop loads the next one (M5) */
  this.levelOver = false;
  /** a level's hook ended the level inside the raster-202 handler: its tail is dropped (`$0B5F` stays) */
  this.hookEnded = false;
  /** a tool's hook: sound n triggered ($33FB -> $6376) */
  this.onSound = null;
  /** a tool's hook: music n started ($6379) */
  this.onMusic = null;
  /**
   * ★ M6: the SID player of the level's `M` (`$6370`-`$6D3F`, `app/sidPlayer.js`) over this `ram` —
   * its variables and the song live at the original's addresses; what it writes into `$D400`-`$D418`
   * the worker sends as `frame.sid` (`SidPlayer.take`). Null in a tool that did not load the script.
   */
  this.sid = (typeof SidPlayer !== 'undefined') ? new SidPlayer(this.ram) : null;
  /** M6: the song of the level (`data/music.json`), copied into `ram` with the level's `M` */
  this.musicData = null;
  // ★ M6: the two steps of the player outside the raster-202 handler — `$361B` at the end of the column
  // shift's copy (the handler of the shift's frame skipped the music, $0E41; not while that handler runs,
  // $0B5F) and `$393B` at the end of level 3's redraw, before its own RTI
  var self = this;
  scroll.onCopyEnd = function () { if (!self.ram[0x0B5F]) { self.musicPlay('shiftEnd'); } };
  scroll.onRedrawEnd = function () { self.musicPlay('redrawEnd'); };
  /** $A000-$FFFF: the character sets, the level's sprites, the sprites under the KERNAL — the level code draws into them */
  this.high = new Uint8Array(0x6000);
  /** set by `hw`: the worker sends `high` again */
  this.highDirty = false;
  /** level data: $8D6C */
  this.charFlags = null;
  this.level = null;
  this.levelIndex = 0;
  /** the enemies, the waves and the bosses — the original's code too (`app/enemies.js`, M4) */
  this.enemies = new Enemies(this);
  this.enemies.levelCode = new LevelCode(this, this.enemies);
  var self = this;
  scroll.onShift = function () { self.onColumnShift(); };
  scroll.onShiftV = function (dir) { self.onVerticalShift(dir); };
  scroll.deferColumn = true;
} // Ship

Ship.SCREEN = 0xCC00;
Ship.ROW = 40;

/**
 * The tables and start values into `ram`, the shapes into `spriteRAM`, the
 * enemy code's memory (its core part now, the level's at `init`).
 * @param {Object} shipData - `data/ship.json`.
 * @param {Object} spritesData - `data/sprites.json`.
 * @param {Object} [enemiesData] - `data/enemies.json` (M4).
 */
Ship.prototype.loadData = function (shipData, spritesData, enemiesData, charsetsData, musicData) {
  this.charsetsData = charsetsData || null;
  this.musicData = musicData || null;
  for (var i = 0; i < shipData.regions.length; i++) {
    var reg = shipData.regions[i];
    this.ram.set(reg.bytes, parseInt(reg.addr.slice(1), 16));
  }
  var blocks = spritesData.globalBlocks.blocks;
  for (var b = 0; b < blocks.length; b++) {
    var at = parseInt(blocks[b].addr.slice(1), 16)-0xD000;
    this.spriteRAM.set(blocks[b].bytes, at);
  }
  this.enemiesData = enemiesData || null;
  if (enemiesData) { this.ram.set(enemiesData.core.bytes, parseInt(enemiesData.core.addr.slice(1), 16)); }
  this.spritesData = spritesData;
}; // loadData

// ---------------------------------------------------------------- helpers

/** @returns {number} the screen byte at a $CC00-based address. */
Ship.prototype.sc = function (a) {
  var i = (a-Ship.SCREEN) & 0xFFFF;
  return i < 1024 ? this.scroll.screen[i] : 0;
}; // sc
Ship.prototype.sw = function (a, v) {
  var i = (a-Ship.SCREEN) & 0xFFFF;
  if (i < 1024) { this.scroll.screen[i] = v & 0xFF; }
}; // sw
/** the colour RAM cell of a screen address (the original adds $0C00) */
Ship.prototype.cc = function (a) {
  var i = (a-Ship.SCREEN) & 0xFFFF;
  return i < 1000 ? this.scroll.color[i] : 0;
}; // cc
Ship.prototype.cw = function (a, v) {
  var i = (a-Ship.SCREEN) & 0xFFFF;
  if (i < 1000) { this.scroll.color[i] = v & 0x0F; }
}; // cw
Ship.prototype.w16 = function (a) { return this.ram[a] | this.ram[a+1] << 8; };
Ship.prototype.s16 = function (a, v) { this.ram[a] = v & 0xFF; this.ram[a+1] = (v >> 8) & 0xFF; };
/** the character property $8D6C: 0 empty, positive destructible, negative solid */
Ship.prototype.flag = function (ch) { return this.charFlags[ch & 0xFF]; };

/**
 * ★ The generator the remake runs where the original reads `$DC04`: a
 * 16-bit LFSR, taps `$B400`, the low byte returned.
 * @returns {number} 0-255.
 */
Ship.prototype.rnd = function () {
  var s = this.seed;
  var c = s & 1;
  s >>>= 1;
  if (c) { s ^= 0xB400; }
  this.seed = s;
  this.ram[0x6004] = s & 0xFF; this.ram[0x6005] = s >> 8;   // where the harness keeps it
  return s & 0xFF;
}; // rnd

/**
 * ★ `$2824 LDA $DC00`: the joystick byte, from the live input or from the
 * script (`tools/traceship.py` hook at $6010 — the same segments).
 * @returns {number} Port 2, active low, bits 5-6 set, bit 7 clear.
 */
Ship.prototype.readJoystick = function () {
  var r = this.ram;
  r[0x6002] = (r[0x6002]+1) & 0xFF;
  if (r[0x6002] === 0) { r[0x6003] = (r[0x6003]+1) & 0xFF; }
  if (!this.script) { return (this.joystick & 0x1F) | 0x60; }
  var t = this.script, idx = r[0x6000];
  var value = t[idx];
  r[0x6001] = (r[0x6001]-1) & 0xFF;
  if (r[0x6001] === 0) {
    if (t[idx+3]) { r[0x6001] = t[idx+3]; r[0x6000] = (idx+2) & 0xFF; } else { r[0x6001] = 1; }
  }
  return (value & 0x1F) | 0x60;
}; // readJoystick

/** ★ `$2A2A`/`$2AB0 LDA $DC01`: bit 4 clear while the space bar is down. */
Ship.prototype.readSpace = function () {
  if (!this.script) { return this.space ? 0xEF : 0xFF; }
  return (this.script[this.ram[0x6000]] & 0x20) ? 0xEF : 0xFF;
}; // readSpace

/**
 * ★ `$33FB`: a sound, by priority — `$3413` counts the running one down
 * and a sound of priority 0 waits for it; then `$340E`: `LDX #2 ; JMP $6376`,
 * the player's effect request (`$63C1`/`$63C2`), which the player's next step
 * starts on voice 3 (`SidPlayer.fxStart`, M6).
 */
Ship.prototype.sound = function (n) {
  var r = this.ram;
  if (r[0x342A+n] === 0) {
    r[0x3413] = (r[0x3413]-1) & 0xFF;
    if (r[0x3413] !== 0) { return; }
  }
  r[0x3413] = r[0x3414+n];
  r[0x63C1] = n; r[0x63C2] = 2;                           // $6376: STX $63C2 ; STA $63C1
  if (this.onSound) { this.onSound(n); }
}; // sound

/**
 * ★ `$6379`: a tune requested — A the tune (3 the level, 0 the boss, 2 the
 * level-end sequence, 1 GAME OVER), X kept in `$63C0` and never read. The
 * player starts it in its next step (`SidPlayer.tuneStart`, M6).
 * @param {number} a - The tune.
 * @param {number} [x] - What X held.
 */
Ship.prototype.music = function (a, x) {
  this.ram[0x63BF] = a & 0xFF;
  if (x !== undefined) { this.ram[0x63C0] = x & 0xFF; }
  if (this.onMusic) { this.onMusic(a, x); }
}; // music

/**
 * ★ M6: where in a PAL frame (a cycle of the 6510, 63 a line) the player's
 * writes belong — **a model of the cadence, not a measurement** (R-044),
 * read against the rasters `tools/tracesound.py` recorded: the raster-202
 * handler reaches the player after the VIC writes of the panel (`$0E46`)
 * and its writes fall on lines 210-229 (median 221); the end of a column
 * shift's copy (`$361B`) lies around line 61-90 of the frame after the
 * shift's; READY's step (`$0C09`) comes after the colours of two rows from
 * `$42`, about `$50`; the sequence's after waiting for `$FA` (`$0A38`), its
 * end `$0A4E` right after the last iteration; tapeEnd's `$D418` ← 0
 * (`$5E69`) after READY's fire, at the top of the next frame.
 */
Ship.MUSIC_LINES = {irq202: 221*63, shiftEnd: 70*63, redrawEnd: 70*63, ready: 0x50*63, sequence: 0xFA*63, sequenceEnd: 0xFA*63+400, tapeEnd: 0};

/**
 * ★ `$6370`: the player's step, once a frame (M6).
 * @param {string} where - A key of {@link Ship.MUSIC_LINES}: who calls it.
 */
Ship.prototype.musicPlay = function (where) {
  if (this.sid) { this.sid.play(Ship.MUSIC_LINES[where] || 0); }
  if (this.onMusicPlay) { this.onMusicPlay(where); }
}; // musicPlay
/**
 * ★ `$6373`: the player silenced (M6).
 * @param {string} where - A key of {@link Ship.MUSIC_LINES}.
 */
Ship.prototype.musicInit = function (where) {
  if (this.sid) { this.sid.init(Ship.MUSIC_LINES[where] || 0); }
  if (this.onMusicInit) { this.onMusicInit(where); }
}; // musicInit
/** ★ `$637C` with X/Y = `$6D40` (`$0896`): the player's pointer table from the level's song, and silence (M6). */
Ship.prototype.musicStop = function () {
  if (this.sid) { this.sid.setup(SidPlayer.TABLE); }
  if (this.onMusicStop) { this.onMusicStop(); }
}; // musicStop
/**
 * ★ A write into the SID outside the player — `$5E69` (`$D418` ← 0 after
 * GAME OVER's fire) is the only one in the core (M6).
 * @param {number} reg - The register.
 * @param {number} value - The byte.
 * @param {string} where - A key of {@link Ship.MUSIC_LINES}.
 */
Ship.prototype.sidPoke = function (reg, value, where) {
  if (!this.sid) { return; }
  this.sid.pos = Ship.MUSIC_LINES[where] || 0;
  this.sid.poke(reg, value);
}; // sidPoke
/**
 * ★ `$11FA`: the level's upper set copied from `G` (`$86AC`) to `$C000` —
 * byte `i` of all six pages an iteration, so a handler nesting into it
 * (M5, the init's layout `set: n`) sees every page copied up to `n`. The
 * level's code reads the glyphs there (the stars of level 1 at `$C578`).
 * @param {number} from - The first byte offset.
 * @param {number} to - One past the last.
 */
Ship.prototype.copySet = function (from, to) {
  for (var i = from; i < to; i++) {
    for (var b = 0; b < 6; b++) { this.high[0xC000+b*256+i-0xA000] = this.ram[0x86AC+b*256+i]; }
  }
  if (to > from) { this.highDirty = true; }
}; // copySet

/**
 * ★ `$1192`: rows 0-18 of the screen cleared (the colour RAM stays) —
 * X from 0 to 255, three stores an iteration (`$CC00,X`, `$CD00,X`,
 * `$CDF8,X`), some 12 000 cycles: a handler nesting into it sees cells
 * X, 256 + X and 504 + X cleared up to its X (READY's clear, M5).
 * @param {number} [from] - The first iteration (0).
 * @param {number} [to] - One past the last (256).
 */
Ship.prototype.clearPlayfield = function (from, to) {
  var scr = this.scroll.screen, a = from || 0, b = to === undefined ? 256 : to;
  for (var x = a; x < b; x++) { scr[x] = 0; scr[256+x] = 0; scr[504+x] = 0; }
}; // clearPlayfield

/** a byte of the high memory $A000-$FFFF (the sets, the sprites) */
Ship.prototype.hi = function (a) { return this.high[(a-0xA000) & 0xFFFF]; };
Ship.prototype.hw = function (a, v) { if (a >= 0xA000) { this.high[a-0xA000] = v & 0xFF; this.highDirty = true; } };

/** ★ `$0CD5`: the lives in the panel ($CF49..). */
Ship.prototype.livesPanel = function (lives) {
  for (var x = 0; x < 8; x++) { this.sw(0xCF49+x, 0); }
  var n = lives & 7;
  for (var i = n; i > 0; i--) { this.sw(0xCF48+i, 0x1F); this.cw(0xCF48+i, 9); }
}; // livesPanel

/** ★ `$32CD`: the score — increments per digit added, digits printed at $CF9D (player 2 $CFB9). */
Ship.prototype.printScore = function () {
  var r = this.ram;
  var digits = r[0x2819] ? 0x3391 : 0x338B, at = r[0x2819] ? 0xCFB9 : 0xCF9D, lives = r[0x2819] ? 0x281E : 0x281D;
  var y = 5;
  r[0x3384] = y;
  for (;;) {
    var a = r[0x3385+y];
    if (a !== 0) {
      a = (a+r[digits+y]) & 0xFF;
      if (a >= 10) {
        for (;;) {                                        // $32E4
          a = (a-10) & 0xFF;
          r[digits+y] = a;
          y--;
          if (y < 0) { break; }
          if (y === 0) {                                  // the top digit wrapped: a life
            r[lives] = (r[lives]+1) & 0xFF;
            this.livesPanel(r[lives]);
            this.sound(6);
            y = 0;
          }
          a = (r[digits+y]+1) & 0xFF;                     // $32FE
          if (a < 10) { r[digits+y] = a; break; }
        }
        if (y < 0) { break; }
      } else {
        r[digits+y] = a;
      }
    }
    r[0x3384] = (r[0x3384]-1) & 0xFF;                     // $330D
    if (r[0x3384] & 0x80) { break; }
    y = r[0x3384];
  }
  for (y = 5; y >= 0; y--) {                              // $3317
    r[0x3385+y] = 0;
    this.sw(at+y, (r[digits+y]+1) & 0xFF);
  }
}; // printScore

/** ★ `$33A5`: 1UP blinks every 16 frames. */
Ship.prototype.blinkOneUp = function () {
  var r = this.ram;
  r[0x33F1] = (r[0x33F1]-1) & 0xFF;
  if (r[0x33F1] !== 0) { return; }
  r[0x33F1] = 0x10;
  var two = r[0x2819] !== 0;
  r[0x33F2] ^= 1;
  var at = two ? 0xCFB5 : 0xCF99, glyphs = two ? 0x33F7 : 0x33F3;
  for (var x = 3; x >= 0; x--) { this.sw(at+x, r[0x33F2] ? r[glyphs+x] : 0); }
}; // blinkOneUp

/** ★ `$116C`: the invulnerable ship blinks (sprites 1 and 2) for $1191 frames. */
Ship.prototype.blink = function () {
  var r = this.ram;
  if (r[0x1190] & 0x80) { return; }
  r[0x1191] = (r[0x1191]-1) & 0xFF;
  if (r[0x1191] !== 0) { this.vic[0x15] ^= 0x06; return; }
  r[0x1191] = 0x78;
  r[0x1190] = 0x80;
  this.vic[0x15] = 0xFF;
}; // blink

/** ★ `$2FFA`: the bits drawn into the ship's current tilt frame. */
Ship.prototype.bitsIntoSprite = function () {
  var r = this.ram;
  if (r[0x0777]) { return; }
  if ((r[0x3079] | r[0x307A]) === 0) { return; }
  r[0x307B] = (r[0x307B]-1) & 0xFF;
  if (r[0x307B] === 0) {
    r[0x307B] = 6;
    var x = r[0x307C]+1;
    if (x >= 8) { x = 0; }
    r[0x305C] = r[0x308C+x]; r[0x305D] = r[0x3094+x];
    r[0x306C] = r[0x309C+x]; r[0x306D] = r[0x30A4+x];
    r[0x307C] = x;
  }
  var t = ((this.scroll.screen[1017]-0x40) & 0xFF) >> 1;
  r[0x305F] = r[0x307D+t]; r[0x306F] = r[0x3082+t]; r[0x3060] = r[0x3087+t]; r[0x3070] = r[0x3087+t];
  var src = this.w16(0x305C), dst = this.w16(0x305F);
  for (var i = 0x1D; i >= 0; i--) { this.spriteRAM[(dst+i-0xD000) & 0xFFF] = r[src+i]; }
  if (r[0x307A]) {
    src = this.w16(0x306C); dst = this.w16(0x306F);
    for (i = 0x1D; i >= 0; i--) { this.spriteRAM[(dst+i-0xD000) & 0xFFF] = r[src+i]; }
  }
}; // bitsIntoSprite

// ---------------------------------------------------------------- the ship

/** ★ `$2F05`: the Force's six values by its level $33. */
Ship.prototype.forceTables = function () {
  var r = this.ram, y = r[0x33];
  r[0x2FC2] = r[0x2FA4+y]; this.scroll.screen[1016] = r[0x2FC2];
  r[0x2FC3] = r[0x2FA9+y]; r[0x2FC4] = r[0x2FAE+y]; r[0x2FC5] = r[0x2FB3+y];
  r[0x2FC6] = r[0x2FB8+y]; r[0x2FC7] = r[0x2FBD+y];
}; // forceTables

/** ★ `$2E9C`: the ship into the sprite registers, its row and column for the shots. */
Ship.prototype.shipRegs = function () {
  var r = this.ram, v = this.vic;
  v[2] = v[4] = r[0x25];
  v[0x10] = (v[0x10] & 0xF9) | r[0x26];
  v[3] = r[0x2B];
  var a = r[0x2B]+0x15;
  v[5] = a & 0xFF;
  var row = (((a & 0xFF)-0x32) & 0xFF) >> 3;
  r[0x02E4] = row;
  r[0x2D] = r[0x2F72+row]; r[0x3EEE] = r[0x2D];
  r[0x2E] = r[0x2F8B+row]; r[0x3EEF] = r[0x2E];
  r[0x3EED] = r[0x26] ? 0x20 : 0;
  a = r[0x25] >> 3;
  var c = a >= 3 ? 1 : 0;                                 // CLC; SBC #2
  a = (a-3) & 0xFF;
  r[0x3EED] = (a+r[0x3EED]+c) & 0xFF;
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  this.forceRegs();
}; // shipRegs

/** ★ `$2EF0`: the Force into sprite 0 (Y and X). */
Ship.prototype.forceRegs = function () {
  this.vic[1] = this.ram[0x2C];
  this.forceRegsX();
}; // forceRegs

/** ★ `$2EF5`: the Force's X into sprite 0. */
Ship.prototype.forceRegsX = function () {
  this.vic[0] = this.ram[0x27];
  this.vic[0x10] = (this.vic[0x10] & 0xFE) | this.ram[0x28];
}; // forceRegsX

/** ★ `$1425`: the ship at a start — a new game, or a life with the Force kept. */
Ship.prototype.shipInit = function () {
  var r = this.ram, v = this.vic;
  r[0x1190] = 0; v[0x10] = 0; r[0x0236] = 0;
  var parts = [0x000, 0x061, 0x080, 0x0E1, 0x100, 0x161, 0x180, 0x1E1, 0x200, 0x261];
  for (var x = 0x1D; x >= 0; x--) { for (var p = 0; p < parts.length; p++) { this.spriteRAM[parts[p]+x] = 0; } }
  v[0x15] = 0xFF; v[0x1C] = 0xFF; v[0x25] = 0x0B; v[0x26] = 0x0F; v[0x27] = 2; v[0x28] = 0x0E; v[0x29] = 0x0E;
  this.scroll.screen[1017] = 0x44; this.scroll.screen[1018] = 0x45;
  r[0x24] = 1; r[0x021D] = 4; r[0x25] = 0x3F; r[0x26] = 0; r[0x2B] = 0x72;
  if (r[0x32] !== 0 && (r[0x281C] !== 0 || r[0x0310] !== 0)) {
    if (r[0x33] === 3) { r[0x33]--; this.forceTables(); }
    this.scroll.screen[1016] = r[0x2FC2];
    r[0x28] = 0;
    r[0x27] = (r[0x25]+r[0x2FC6]) & 0xFF;
    r[0x2C] = (r[0x2B]+r[0x2FC7]) & 0xFF;
    r[0x32] = 1; r[0x022A] = 1;
  } else {
    r[0x27] = 0; r[0x28] = 0; v[0] = 0; r[0x31] = 0; r[0x32] = 0; r[0x33] = 0; r[0x34] = 0;
    r[0x2C] = 0xA0; v[1] = 0xA0;
    this.scroll.screen[1016] = 0x4A;
  }
  r[0x0310] = 0; r[0x281C] = 0;
  this.shipRegs();
}; // shipInit

/** ★ `$2DBD`: the tilt toward `target`, a frame down every 4 frames, at once up. */
Ship.prototype.tiltDown = function (target) {
  var scr = this.scroll.screen, r = this.ram;
  if (target === scr[1017]) { return; }
  if (target > scr[1017]) { scr[1017] = target; scr[1018] = (target+1) & 0xFF; return; }
  r[0x021D] = (r[0x021D]-1) & 0xFF;
  if (r[0x021D] !== 0) { return; }
  r[0x021D] = 4;
  scr[1017] = (scr[1017]-2) & 0xFF; scr[1018] = (scr[1018]-2) & 0xFF;
}; // tiltDown

/** ★ `$2DE4`: the tilt toward `target`, a frame up every 4 frames, at once down. */
Ship.prototype.tiltUp = function (target) {
  var scr = this.scroll.screen, r = this.ram;
  if (target === scr[1017]) { return; }
  if (target < scr[1017]) { scr[1017] = target; scr[1018] = (target+1) & 0xFF; return; }
  r[0x021D] = (r[0x021D]-1) & 0xFF;
  if (r[0x021D] !== 0) { return; }
  r[0x021D] = 4;
  scr[1017] = (scr[1017]+2) & 0xFF; scr[1018] = (scr[1018]+2) & 0xFF;
}; // tiltUp

/** ★ `$2E02`: right by the speed $24, the Force with the ship. */
Ship.prototype.moveRight = function () {
  var r = this.ram;
  if (r[0x26] !== 0 && r[0x25] >= 0x38) { r[0x25] = 0x38; return; }
  var a = r[0x25]+r[0x24];
  r[0x25] = a & 0xFF;
  if (a > 0xFF) { r[0x26] = 6; }
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  a = r[0x27]+r[0x24];
  r[0x27] = a & 0xFF;
  if (a > 0xFF) { r[0x28] = 1; }
}; // moveRight

/** ★ `$2E32`: left. */
Ship.prototype.moveLeft = function () {
  var r = this.ram;
  if (r[0x26] === 0 && r[0x25] < 0x24) { r[0x25] = 0x23; return; }
  var a = r[0x25]-r[0x24];
  r[0x25] = a & 0xFF;
  if (a < 0) { r[0x26] = 0; }
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  a = r[0x27]-r[0x24];
  r[0x27] = a & 0xFF;
  if (a < 0) { r[0x28] = 0; }
}; // moveLeft

/** ★ `$2E62`: down; returns A as the routine leaves it (the caller compares it with $AF). */
Ship.prototype.moveDown = function () {
  var r = this.ram;
  if (r[0x2B] >= 0xAF) { r[0x2B] = 0xAF; return 0xAF; }
  r[0x2B] = (r[0x2B]+r[0x24]) & 0xFF;
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return r[0x32]; }
  r[0x2C] = (r[0x2C]+r[0x24]) & 0xFF;
  return r[0x2C];
}; // moveDown

/** ★ `$2E7F`: up; returns A (the caller compares it with $32). */
Ship.prototype.moveUp = function () {
  var r = this.ram;
  if (r[0x2B] < 0x33) { r[0x2B] = 0x32; return 0x32; }
  r[0x2B] = (r[0x2B]-r[0x24]) & 0xFF;
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return r[0x32]; }
  r[0x2C] = (r[0x2C]-r[0x24]) & 0xFF;
  return r[0x2C];
}; // moveUp

/**
 * ★ `$2821`: the ship's step from the raster-202 handler — the Force first
 * (`$2A12`), then the joystick, the moves, the tilt, the Force's attachment,
 * the bits against the terrain and the ship against the terrain.
 */
Ship.prototype.shipStep = function () {
  var r = this.ram;
  this.forceStep();
  var a = this.readJoystick();
  r[0x23] = a;
  if ((a & 0x0A) === 0) {                                 // $2CF7 down + right
    this.tiltBy(this.moveDown() === 0xAF, 0x44, 0x48, false);
    this.moveRight(); this.shipRegs(); r[0x31] = 0;
  } else if ((a & 0x06) === 0) {                          // $2D17 down + left
    this.tiltBy(this.moveDown() === 0xAF, 0x44, 0x48, false);
    this.moveLeft(); this.shipRegs(); r[0x31] = 0;
  } else if ((a & 0x09) === 0) {                          // $2D33 up + right
    this.tiltBy(this.moveUp() === 0x32, 0x44, 0x40, true);
    this.moveRight(); this.shipRegs(); r[0x31] = 1;
  } else if ((a & 0x05) === 0) {                          // $2D53 up + left
    this.tiltBy(this.moveUp() === 0x32, 0x44, 0x40, true);
    this.moveLeft(); this.shipRegs(); r[0x31] = 1;
  } else if ((a & 0x08) === 0) {                          // $2D6F right
    this.moveRight(); this.shipRegs(); this.tiltLevel();
  } else if ((a & 0x04) === 0) {                          // $2D78 left
    this.moveLeft(); this.shipRegs(); this.tiltLevel();
  } else if ((a & 0x02) === 0) {                          // $2D81 down
    this.tiltBy(this.moveDown() === 0xAF, 0x44, 0x48, false);
    this.shipRegs(); r[0x31] = 0;
  } else if ((a & 0x01) === 0) {                          // $2D9F up
    this.tiltBy(this.moveUp() === 0x32, 0x44, 0x40, true);
    this.shipRegs(); r[0x31] = 1;
  } else {
    this.tiltLevel();
  }
  this.shipTail();
}; // shipStep

/** ★ `$286F`: no vertical input — back to level ($44) from the side the ship tilted to. */
Ship.prototype.tiltLevel = function () {
  if (this.ram[0x31] === 0) { this.tiltDown(0x44); } else { this.tiltUp(0x44); }
}; // tiltLevel

/**
 * The tilt after a vertical move: clamped at the edge -> toward level with
 * the routine of the opposite side, else toward the tilt frame.
 * @private
 */
Ship.prototype.tiltBy = function (clamped, level, tilt, up) {
  if (up) {
    if (clamped) { this.tiltUp(level); } else { this.tiltDown(tilt); }
  } else {
    if (clamped) { this.tiltDown(level); } else { this.tiltUp(tilt); }
  }
}; // tiltBy

/** ★ `$287E`-`$2952`: after the move — the Force detached (drift, attach test) or attached (scan, colour), the bits, the terrain. */
Ship.prototype.shipTail = function () {
  var r = this.ram;
  var f = r[0x32];
  if (f !== 0) {
    var scan = true;                                      // $2894: the attached Force's path
    if (f & 0x80) {                                       // $2884: detached
      if (r[0x2FD2] === 0 && r[0x2FD3] === 0) { this.forceDrift(); }
      scan = this.forceAttach();                          // not attached -> JMP $2894; attached -> JMP $28A5
    }
    if (scan) {
      if (!this.shiftGameStep) { return; }                // $2894: LDA $0225 — a shift still running at this handler
      this.forceScan();
      this.forceColor();
      if (r[0x0232]) { return; }
    }
  }
  // $28A5: the bits against the terrain
  var y = r[0x3EED], ch;
  if (r[0x3079]) {
    if (r[0x2B] >= 0x3A) {
      var p = (this.w16(0x2D)-0x50) & 0xFFFF;
      this.s16(0x29, p);
      ch = this.sc(p+y);
      var fl = this.flag(ch);
      if (fl !== 0 && !(fl & 0x80)) { this.explodeAt(p, ch); }
    }
    if (r[0x307A]) {
      var row = this.w16(0x2D);
      if (!(r[0x2E] === 0xCE && r[0x2D] >= 0xA8)) {
        p = (row+0x50) & 0xFFFF;
        this.s16(0x29, p);
        ch = this.sc(p+y);
        fl = this.flag(ch);
        if (fl !== 0 && !(fl & 0x80)) { this.explodeAt(p, ch); }
      }
    }
  }
  // $28FD: the ship against the terrain
  var at = this.w16(0x2D)+r[0x3EED];
  if (this.flag(this.sc(at)) !== 0) { this.collision(); return; }
  if (this.flag(this.sc(at+1)) !== 0) { this.collision(); }
}; // shipTail

/**
 * ★ `$291B`: a destructible character under a bit explodes (`$2154`), or,
 * for a character from $C0 up, becomes $C1 with the smallest explosion.
 * @param {number} p - The row address in $29/$2A.
 * @param {number} ch - The character there.
 */
Ship.prototype.explodeAt = function (p, ch) {
  var r = this.ram;
  var x = this.freeExplosion();
  if (x < 0) { return; }
  r[0x022C] = x;
  r[0x2441+x] = r[0x3EED];
  this.s16(0x48, p);
  if (ch < 0xC0) { this.explode(); return; }
  this.sw(p+r[0x3EED], 0xC1);
  this.explosionType(x, 0);
  this.explosionDraw(x);
}; // explodeAt

/** @returns {number} a free explosion slot 5..0, or -1 ($242F). */
Ship.prototype.freeExplosion = function () {
  for (var x = 5; x >= 0; x--) { if (this.ram[0x242F+x] === 0) { return x; } }
  return -1;
}; // freeExplosion

/**
 * ★ `$2953`: the detached Force within reach attaches, in front or behind.
 * @returns {boolean} true = not attached (the caller goes on at $2894).
 */
Ship.prototype.forceAttach = function () {
  var r = this.ram;
  if (r[0x2B] >= r[0x2C]) { return true; }
  if (((r[0x2B]+0x1A) & 0xFF) < r[0x2C]) { return true; }
  var hi = r[0x26] ? 1 : 0;
  r[0x2FD4] = hi;
  var shipLeft;                                           // ship X < Force X
  if (hi < r[0x28]) { shipLeft = true; }
  else if (hi !== r[0x28]) { shipLeft = false; }
  else { shipLeft = r[0x25] < r[0x27]; }
  var d;
  if (shipLeft) {                                         // $2974
    d = (r[0x27]-r[0x25]) & 0xFF;
    r[0xD0] = d;
    r[0xD1] = (r[0x28]-hi-(r[0x27] < r[0x25] ? 1 : 0)) & 0xFF;
    if (r[0xD1] !== 0) { return true; }
    if (d >= 0x18) { return true; }
  } else {                                                // $298C
    d = (r[0x25]-r[0x27]) & 0xFF;
    r[0xD0] = d;
    r[0xD1] = (hi-r[0x28]-(r[0x25] < r[0x27] ? 1 : 0)) & 0xFF;
    if (r[0xD1] !== 0) { return true; }
    if (d >= 0x14) { return true; }
  }
  // $29A2: ship X >= Force X (16-bit) -> behind, else in front
  var full = (hi << 8 | r[0x25])-(r[0x28] << 8 | r[0x27]);
  var c;
  if (full < 0) {                                         // in front
    c = r[0x33] >= 3 ? 1 : 0;
    if (r[0x33] === 3) { r[0x33]--; this.forceTables(); }
    r[0x022A] = 1;
    r[0x28] = r[0x2FD4];
    var a = r[0x25]+r[0x2FC6]+c;
    r[0x27] = a & 0xFF;
    if (a > 0xFF) { r[0x28] = 1; }
  } else {                                                // $29F3 behind
    r[0x022A] = 0;
    c = r[0x33] >= 2 ? 1 : 0;
    if (r[0x33] === 2) { r[0x33]++; this.forceTables(); }
    a = r[0x25]-r[0x2FC5]-(1-c);
    r[0x27] = a & 0xFF;
    if (a < 0) { r[0x28] = 0; }
  }
  r[0x2C] = (r[0x2B]+r[0x2FC7]) & 0xFF;                   // $29D4
  r[0x32] = 1;
  this.forceRegs();
  r[0x2FD2] = 0; r[0x2FD3] = 0;
  this.sound(5);
  return false;
}; // forceAttach

/** ★ `$2A12`: the Force — detaching on space, flying off, returning on space. */
Ship.prototype.forceStep = function () {
  var r = this.ram;
  r[0x2FD4] = r[0x26] ? 1 : 0;
  var s = r[0x34];
  if (s & 0x80) { this.forceFlyRight(); return; }
  if (s !== 0) { this.forceFlyLeft(); return; }
  var f = r[0x32];
  if (f === 0) { return; }
  if (f & 0x80) { this.forceReturn(); return; }
  // $2A2A: attached — space detaches it
  if (this.readSpace() & 0x10) { return; }
  this.sound(3);
  var full = (r[0x2FD4] << 8 | r[0x25])-(r[0x28] << 8 | r[0x27]);
  if (full < 0) { r[0x34] = 0x80; this.forceFlyRight(); return; }
  r[0x34] = 1;
  this.forceFlyLeft();
}; // forceStep

/** ★ `$2A4C`: the detached Force flies left by 8 until X $17, or stops at the terrain ($59). */
Ship.prototype.forceFlyLeft = function () {
  var r = this.ram;
  if (r[0x59] === 0) {
    if (r[0x28] === 0) {
      if (r[0x27] < 0x17) { r[0x27] = 0x18; this.forceStop(); this.forceRegsX(); return; }
      r[0x27] = (r[0x27]-8) & 0xFF;                       // $2A6B with C = 1
      this.forceRegsX();
      return;
    }
    var a = r[0x27]-8;                                    // $2A68
    r[0x27] = a & 0xFF;
    if (a < 0) { r[0x28] = 0; }
    this.forceRegsX();
    return;
  }
  this.forceStop();
  this.forceRegsX();
}; // forceFlyLeft

/** ★ `$2A5E`: the flight ends — detached. */
Ship.prototype.forceStop = function () {
  this.ram[0x34] = 0;
  this.ram[0x32] = 0x80;
}; // forceStop

/** ★ `$2A79`: the detached Force flies right by 8 until X $140. */
Ship.prototype.forceFlyRight = function () {
  var r = this.ram;
  if (r[0x59] !== 0) { this.forceStop(); this.forceRegsX(); return; }
  if (r[0x28] !== 0) {
    if (r[0x27] >= 0x3F) { r[0x27] = 0x40; this.forceStop(); this.forceRegsX(); return; }
    r[0x27] = (r[0x27]+8) & 0xFF;                         // $2A90 with C = 0
    this.forceRegsX();
    return;
  }
  var a = r[0x27]+8;
  r[0x27] = a & 0xFF;
  if (a > 0xFF) { r[0x28] = 1; }
  this.forceRegsX();
}; // forceFlyRight

/** ★ `$2A9C`: the detached Force called back by space flies to the ship, 3 px a frame. */
Ship.prototype.forceReturn = function () {
  var r = this.ram;
  for (;;) {
    var dx = r[0x2FD2];
    if (dx & 0x80) {                                      // $2AE5: the Force is left of the ship
      var full = (r[0x28] << 8 | r[0x27])-(r[0x2FD4] << 8 | r[0x25]);
      if (full >= 0) { r[0x2FD2] = 0; }
      else {
        var a = r[0x27]+3;
        r[0x27] = a & 0xFF;
        if (a > 0xFF) { r[0x28] = 1; }
        this.forceRegsX();
      }
    } else if (dx !== 0) {                                // $2B07: right of the ship
      full = (r[0x28] << 8 | r[0x27])-(r[0x2FD4] << 8 | r[0x25]);
      if (full < 0) { r[0x2FD2] = 0; }
      else {
        a = r[0x27]-3;
        r[0x27] = a & 0xFF;
        if (a < 0) { r[0x28] = 0; }
        this.forceRegsX();
      }
    }
    // $2AA3
    var dy = r[0x2FD3];
    if (dy & 0x80) {                                      // $2B2D: down
      a = (r[0x2C]-0x0F) & 0xFF;
      if (a >= r[0x2B]) { r[0x2FD3] = 0; return; }
      r[0x2C] = (a+0x12) & 0xFF;
      this.vic[1] = r[0x2C];
      return;
    }
    if (dy !== 0) {                                       // $2B44: up
      a = (r[0x2C]-0x0F) & 0xFF;
      if (a < r[0x2B]) { r[0x2FD3] = 0; return; }
      r[0x2C] = (a+0x0C) & 0xFF;
      this.vic[1] = r[0x2C];
      return;
    }
    // $2AB0: idle — space calls it back
    if (this.readSpace() & 0x10) { return; }
    full = (r[0x2FD4] << 8 | r[0x25])-(r[0x28] << 8 | r[0x27]);
    var c = full >= 0 ? 1 : 0;
    r[0x2FD2] = c ? 0x80 : 1;
    a = (r[0x2B]+0x0F+c) & 0xFF;
    r[0x2FD3] = a >= r[0x2C] ? 0x80 : 1;
    // JMP $2A9C
  }
}; // forceReturn

/** ★ `$2B5B`: the detached Force drifts — new directions from the generator, kept inside the field. */
Ship.prototype.forceDrift = function () {
  var r = this.ram;
  r[0x2FD7] = (r[0x2FD7]-1) & 0xFF;
  if (r[0x2FD7] === 0) {
    r[0x2FD7] = this.rnd() & 7;
    r[0x2FD9] = (this.rnd() & 0x80) | 1;
  }
  r[0x2FD8] = (r[0x2FD8]-1) & 0xFF;
  if (r[0x2FD8] === 0) {
    r[0x2FD8] = this.rnd() & 7;
    r[0x2FDA] = (this.rnd() & 0x80) | 1;
  }
  var a;
  if (!(r[0x2FD9] & 0x80)) {                              // $2B8E: right
    if (r[0x28] !== 0 && r[0x27] >= 0x28) { r[0x2FD7] = 1; }
    else {
      a = r[0x27]+r[0x2FD9];
      r[0x27] = a & 0xFF;
      if (a > 0xFF) { r[0x28] = 1; }
    }
  } else {                                                // $2BB0: left
    if (r[0x28] === 0 && r[0x27] < 0x17) { r[0x2FD7] = 1; }
    else {
      a = r[0x27]+((r[0x2FD9] & 0x7F) ^ 0xFF);
      r[0x27] = a & 0xFF;
      if (a <= 0xFF) { r[0x28] = 0; }
    }
  }
  var vertical = true;
  if (!(r[0x2FDA] & 0x80)) {                              // $2BD3: down
    if (r[0x2C] >= 0xAE) { r[0x2FD8] = 1; vertical = false; }
    else {
      a = r[0x2C]+r[0x2FDA];
      r[0x2C] = a & 0xFF;
      if (a <= 0xFF) { vertical = false; }                // BCC $2C05 — else falls into $2BEC
    }
  }
  if (vertical) {                                         // $2BEC: up
    if (r[0x2C] < 0x38) { r[0x2FD8] = 1; }
    else { r[0x2C] = (r[0x2C]+((r[0x2FDA] & 0x7F) ^ 0xFF)) & 0xFF; }
  }
  this.forceRegs();
}; // forceDrift

/** ★ `$2C08`: the attached Force scans the characters it covers — solid ones block ($59), destructible ones explode. */
Ship.prototype.forceScan = function () {
  var r = this.ram;
  r[0x58] = r[0x28] ? 0x20 : 0;
  var row = ((r[0x2C]-0x32) & 0xFF) >> 3;
  r[0x2F] = r[0x2F72+row]; r[0x40CF] = r[0x2F];
  r[0x30] = r[0x2F8B+row]; r[0x40D0] = r[0x30];
  var a = (r[0x27] >> 3)+r[0x58];
  var c = a > 0xFF ? 1 : 0;
  a = ((a & 0xFF)-2-(1-c)) & 0xFF;
  if (a & 0x80) { r[0x59] = 0; return; }
  r[0x58] = a; r[0x40CE] = a;
  var y = a, lv = r[0x33];
  r[0x56] = 0; r[0x57] = 0;
  for (;;) {
    var p = this.w16(0x2F);
    var ch = this.sc(p+y);
    r[0x2C51] = y;
    var fl = this.flag(ch);
    if (fl & 0x80) {                                      // $2C8A: solid
      r[0x59] = (r[0x59]+1) & 0xFF;
      if (r[0x56] === 0) { r[0x2FD9] &= 0x7F; } else { r[0x2FD9] |= 0x80; }
      if (r[0x57] === 0) { r[0x2FDA] &= 0x7F; } else { r[0x2FDA] |= 0x80; }
      return;
    }
    if (fl !== 0) {                                       // $2CBB: destructible
      var x = this.freeExplosion();
      if (x < 0) { r[0x59] = 0; return; }
      r[0x022C] = x;
      r[0x2441+x] = r[0x2C51];
      this.s16(0x48, p);
      if (ch < 0xC8) { this.explode(); r[0x59] = 0; return; }
      this.sw(p+r[0x2C51], 0xC1);
      this.explosionType(x, 0);
      this.explosionDraw(x);
      r[0x59] = 0;
      return;
    }
    y = (y+1) & 0xFF;
    r[0x56] = (r[0x56]+1) & 0xFF;
    if (r[0x56] !== r[0x2FC8+lv]) { continue; }
    y = r[0x58];
    r[0x56] = 0;
    r[0x57] = (r[0x57]+1) & 0xFF;
    if (r[0x57] === r[0x2FCD+lv]) { r[0x59] = 0; return; }
    if (r[0x30] === 0xCE && r[0x2F] === 0xD0) { r[0x59] = 0; return; }
    this.s16(0x2F, (p+0x28) & 0xFFFF);
  }
}; // forceScan

/** ★ `$2F2F`: the Force's colour cycle and its sprite animation. */
Ship.prototype.forceColor = function () {
  var r = this.ram, scr = this.scroll.screen;
  var x;
  if (r[0x2FD6] === 0) {
    r[0x2FD5] = (r[0x2FD5]+1) & 0xFF;
    x = r[0x2FD5];
    if (x >= 0x1F) {
      r[0x2FD6] = (r[0x2FD6]+1) & 0xFF;
      r[0x2FD5] = (r[0x2FD5]-1) & 0xFF;
      if (r[0x2FD5] === 0) { r[0x2FD6] = (r[0x2FD6]-1) & 0xFF; }
      x = r[0x2FD5];
    }
  } else {
    r[0x2FD5] = (r[0x2FD5]-1) & 0xFF;
    if (r[0x2FD5] === 0) { r[0x2FD6] = (r[0x2FD6]-1) & 0xFF; }
    x = r[0x2FD5];
  }
  this.vic[0x27] = r[0x2FDB+x];
  r[0x2FC4] = (r[0x2FC4]-1) & 0xFF;
  if (r[0x2FC4] !== 0) { return; }
  r[0x2FC4] = r[0x2FAE+r[0x33]];
  if (scr[1016] === r[0x2FC3]) { scr[1016] = r[0x2FC2]; return; }
  scr[1016] = (scr[1016]+1) & 0xFF;
}; // forceColor

/** ★ `$319C`: a collision kills when the ship is vulnerable ($1190 bit 7); the harness patches it to RTS. */
Ship.prototype.collision = function () {
  if (this.immortal) { return false; }
  // the hook of scenario `c` at $5FC0: A = 0 while the frames counted by the joystick hook are below K
  if (this.mortalAfter && (this.ram[0x6002] | this.ram[0x6003] << 8) < this.mortalAfter) { return false; }
  if (this.ram[0x1190] & 0x80) { this.death(); return true; }
  return false;
}; // collision // collision

/** ★ `$31A2`: the ship explodes — sprite 1 becomes the explosion, $0E69 points the handler at `$31FC`. */
Ship.prototype.death = function () {
  var r = this.ram, v = this.vic;
  r[0x0239] = 3; r[0x1FF0] = 0xD3;
  r[0x3B99] = 0xFA; r[0x3B9A] = 0x17;
  r[0x0E69] = 0xFC; r[0x0E6A] = 0x31;
  r[0x3079] = 0; r[0x307A] = 0; r[0x32] = 0;
  r[0x23] = 0xFF;
  v[0x15] = 0xFA; v[0x1C] = 0xFD; v[0x28] = 1;
  r[0x2B] = (r[0x2B]+0x0C) & 0xFF;
  v[3] = r[0x2B];
  this.scroll.screen[1017] = 0x5E;
  r[0x32C8] = 2; r[0x32C9] = 4;
  r[0x0236] = (r[0x0236]+1) & 0xFF;
  this.sound(4);
}; // death

/** ★ `$31FC`: the explosion's frames, then `$3219`: the life is over. */
Ship.prototype.deathAnim = function () {
  var r = this.ram, v = this.vic;
  r[0x32C9] = (r[0x32C9]-1) & 0xFF;
  if (r[0x32C9] !== 0) { return; }
  var x = r[0x32C8];
  if (x !== 0) {
    r[0x32C9] = 4;
    this.scroll.screen[1017] = (this.scroll.screen[1017]+1) & 0xFF;
    v[0x28] = r[0x32CA+x];
    r[0x32C8] = (x-1) & 0xFF;
    return;
  }
  for (x = 5; x >= 0; x--) { r[0x3ED5+x] = 0; v[x] = 0; }   // $3219
  v[0x10] = 0;
  if (this.rules) { this.rules.event('death'); }
  r[0x0232] = (r[0x0232]+1) & 0xFF;
  r[0x0233] = 0; r[0x024C] = 0; r[0x0221] = 0;
  this.scroll.running = 0;
  if (r[0x2820] === 0) {                                  // $329D: one player
    r[0x281D] = (r[0x281D]-1) & 0xFF;
    if (r[0x281D] === 0) { r[0x281F] = 0xD3; this.gameOver = true; return; }   // $32AB -> tapeEnd (M5)
    this.livesPanel(r[0x281D]);
  } else {
    this.twoPlayersDeath();
  }
  r[0x281C] = (r[0x281C]+1) & 0xFF;                       // $32B3
  if (r[0x0B5E] !== 3) { r[0x0B5E] = 3; this.music(3, 1); }   // $32BE-$32C5: back from the boss's tune (M6)
}; // deathAnim

/** `$323C`-`$329A`: the two-player bookkeeping after a death — M5 (the mode is switched off in this version). */
Ship.prototype.twoPlayersDeath = function () {
  throw new Error('two players: M5');
}; // twoPlayersDeath

// ---------------------------------------------------------------- the game step

/**
 * ★ `$3D74`: the game step of the raster-202 handler — every weapon, the
 * explosions, the basic shots and the fire button. Not run in a frame that
 * shifted the screen (`$0225`).
 */
Ship.prototype.gameStep = function () {
  if (!this.shiftGameStep) { return; }                    // $3D74: LDA $0225; BNE -> RTS (a shift still running at this handler)
  this.laserRedStep();
  this.laserBlueStep();
  this.laserYellowStep();
  this.forceShotsStep();
  this.missilesStep();
  this.explosionsStep();
  this.enemyBulletsStep();
  if (this.ram[0x0223]) { this.beamStep(); }
  this.shotsStep();
  this.fireButton();
}; // gameStep

/** `$3DE9`: a basic shot slot is free again. */
Ship.prototype.shotOff = function (x) {
  this.ram[0x3ED5+x] = 0; this.ram[0x3EE1+x] = 0; this.ram[0x3EE5+x] = 0xD3;
}; // shotOff

/** ★ `$3D97`-`$3ED4`: the four basic shots, two columns a frame, as characters $CC. */
Ship.prototype.shotsStep = function () {
  var r = this.ram;
  for (var x = 3; x >= 0; x--) {
    var st = r[0x3ED5+x];
    if (st === 0) { continue; }
    var p = r[0x3ED9+x] | r[0x3EDD+x] << 8;
    this.s16(0x3F, p); r[0x41] = r[0x3F]; r[0x42] = (r[0x40]+0x0C) & 0xFF;
    var y, ch, fl;
    if (st & 0x80) {                                      // $3DA6: the flash after a hit
      y = (r[0x3EE1+x]-1) & 0xFF;
      var found = false;
      for (;;) {
        ch = this.sc(p+y);
        if (ch >= 0xF2) { found = true; break; }
        y = (y+1) & 0xFF;
        if (y >= 0x26) { break; }
      }
      if (found) {
        r[0x3EE1+x] = y;
        if (ch !== 0xF3) { this.sw(p+y, ch+1); continue; }
      } else {
        y = r[0x3EE1+x];
      }
      this.sw(p+y, r[0x3EE5+x]); this.cw(p+y, r[0x3EE9+x]);
      this.shotOff(x);
      continue;
    }
    y = r[0x3EE1+x];
    if (r[0x3EE5+x] !== 0xD3) {                           // $3E13: a shot on the screen
      if (this.levelIndex !== 2 && this.sc(p+y) !== 0xCC) {
        y = (y-1) & 0xFF;
        if (this.sc(p+y) !== 0xCC) { this.shotOff(x); continue; }
      }
      this.sw(p+y, r[0x3EE5+x]); this.cw(p+y, r[0x3EE9+x]);   // $3E2D
      if (y >= 0x26) { this.shotOff(x); continue; }
      y = (y+1) & 0xFF;
      r[0x43] = y;
      ch = this.sc(p+y);
      if (ch >= 0xCB) { this.shotOff(x); continue; }
      fl = this.flag(ch);
      if (fl !== 0) { this.shotHit(x, p, fl); continue; }
      y = (r[0x43]+1) & 0xFF;
      r[0x3EE1+x] = y;
    }
    ch = this.sc(p+y);                                    // $3E57
    if (ch >= 0xCB) { this.shotOff(x); continue; }
    r[0x43] = y;
    fl = this.flag(ch);
    if (fl === 0) {                                       // $3EBF: draw
      r[0x3EE5+x] = ch;
      r[0x3EE9+x] = this.cc(p+y);
      this.sw(p+y, 0xCC); this.cw(p+y, 1);
      continue;
    }
    this.shotHit(x, p, fl);
  }
}; // shotsStep

/** ★ `$3E68`: a shot meets a character — destructible: explode; solid: the flash $F2 one column back. */
Ship.prototype.shotHit = function (x, p, fl) {
  var r = this.ram;
  if (!(fl & 0x80)) {                                     // $3E8E
    r[0x0226] = x;
    this.sound(0x0F);
    var e = this.freeExplosion();
    if (e >= 0) {
      r[0x022C] = e;
      r[0x2441+e] = r[0x43];
      this.s16(0x48, p);
      this.explode();
    }
    this.shotOff(x);
    return;
  }
  r[0x43] = (r[0x43]-1) & 0xFF;
  var y = r[0x43];
  r[0x3EE5+x] = this.sc(p+y);
  r[0x3EE9+x] = this.cc(p+y);
  r[0x3EE1+x] = y;
  this.sw(p+y, 0xF2); this.cw(p+y, 1);
  r[0x3ED5+x] = 0x80;
}; // shotHit

/** ★ `$3B74`: the fire button — a tap fires, holding charges the beam, letting go releases it. */
Ship.prototype.fireButton = function () {
  var r = this.ram;
  if (r[0x0249]) { return; }
  if (r[0x0236]) { return; }
  if (r[0x23] & 0x10) { r[0x3D73] = 0x10; this.beamRelease(); return; }
  if (r[0x3D73] === 0) { this.beamCharge(); return; }
  r[0x3D73] = 0;
  this.fireRoutine();
  var skip = r[0x3B9A] === r[0x1C06] && r[0x32] !== 0 && !(r[0x32] & 0x80) && r[0x022A] !== 0;
  if (!skip) {
    for (var x = 3; x >= 0; x--) {
      if (r[0x3ED5+x] === 0) {
        r[0x3EE1+x] = (r[0x3EED]+2) & 0xFF;
        r[0x3ED5+x] = 1;
        r[0x3ED9+x] = r[0x3EEE]; r[0x3EDD+x] = r[0x3EEF];
        break;
      }
    }
  }
  this.missilesLaunch();
  if (r[0x3B9A] === 0x17) { this.sound(0); }
  if (!(r[0x32] & 0x80)) { return; }
  if (r[0x0239]) { r[0x0239]--; return; }
  this.forceDetachedFire();
}; // fireButton

/** ★ `JSR ($3B99)`: the Force's fire routine by the crystal picked ($1BE6). */
Ship.prototype.fireRoutine = function () {
  switch (this.w16(0x3B99)) {
    case 0x17FA: return;
    case 0x42FA: this.laserBlueFire(); return;
    case 0x47A1: this.laserYellowFire(); return;
    case 0x4CB3: this.laserRedFire(); return;
    default: throw new Error('fire routine $'+this.w16(0x3B99).toString(16));
  }
}; // fireRoutine

/** ★ `$3BF1`-`$3CED`: the detached Force fires by its level — one, two or four shots. */
Ship.prototype.forceDetachedFire = function () {
  var r = this.ram, x, a, c;
  var lv = r[0x33];
  if (lv === 1) {
    for (x = 3; x >= 0 && r[0x40AA+x]; x--) {}
    if (x < 0) { return; }
    a = r[0x40CE]+1;
    r[0x40B6+x] = a & 0xFF; c = a > 0xFF ? 1 : 0;
    r[0x40AA+x] = 1; r[0x40C2+x] = 0x80; r[0x40C6+x] = 0; r[0x40CA+x] = 0xCD;
    a = r[0x40CF]+0x28+c;
    r[0x40AE+x] = a & 0xFF;
    r[0x40B2+x] = (r[0x40D0]+(a > 0xFF ? 1 : 0)) & 0xFF;
    return;
  }
  if (lv !== 4) {
    if (r[0x40AA] || r[0x40AB]) {
      if (r[0x40AD] || r[0x40AC]) { return; }
      x = 2;
    } else {
      x = 0;
    }
    for (var i = 0; i < 2; i++, x++) {
      r[0x40AA+x] = 1;
      r[0x40B6+x] = (r[0x40CE]+1) & 0xFF;
      a = r[0x40CF]+r[0x3CEE+x];
      r[0x40AE+x] = a & 0xFF;
      r[0x40B2+x] = (r[0x40D0]+(a > 0xFF ? 1 : 0)) & 0xFF;
      r[0x40C6+x] = r[0x3CF2+x];
      if (r[0x022A]) { r[0x40C2+x] = 0x80; r[0x40CA+x] = r[0x3CF6+x]; }
      else { r[0x40C2+x] = 1; r[0x40CA+x] = r[0x3CFA+x]; }
    }
    return;
  }
  for (x = 3; x >= 0; x--) { if (r[0x40AA+x]) { return; } }
  for (x = 3; x >= 0; x--) {
    r[0x40AA+x] = 1;
    a = r[0x40CE]+r[0x3D57+x];
    r[0x40B6+x] = a & 0xFF;
    a = r[0x40CF]+r[0x3D5B+x]+(a > 0xFF ? 1 : 0);
    r[0x40AE+x] = a & 0xFF;
    r[0x40B2+x] = (r[0x40D0]+(a > 0xFF ? 1 : 0)) & 0xFF;
    r[0x40C6+x] = r[0x3D5F+x];
    if (r[0x022A]) { r[0x40C2+x] = r[0x3D63+x]; r[0x40CA+x] = r[0x3D6B+x]; }
    else { r[0x40C2+x] = r[0x3D67+x]; r[0x40CA+x] = r[0x3D6F+x]; }
  }
}; // forceDetachedFire

/** ★ `$40D1`: a frame of charging — the BEAM meter fills, three steps a cell. */
Ship.prototype.beamCharge = function () {
  var r = this.ram;
  if (r[0x0223]) { return; }
  var x = r[0x0222];
  if (this.sc(0xCF58+x) === 0x1C) {
    if (x === 0x15) { return; }
    x++;
    r[0x0222] = x;
  }
  this.sw(0xCF58+x, this.sc(0xCF58+x)+1);
}; // beamCharge

/** ★ `$40EC`: fire let go — the meter empties and from 6 cells up the beam is launched. */
Ship.prototype.beamRelease = function () {
  var r = this.ram;
  if (this.sc(0xCF58) !== 0x1A) { this.sw(0xCF58, 0x1A); }
  var y = r[0x0222];
  if (y === 0) { return; }
  for (var x = 0x16; x >= 1; x--) { this.sw(0xCF57+x, 0x1A); }
  r[0x0222] = 0;
  if (y < 6) { return; }
  r[0x4114] = y;
  this.sound(2);
  r[0x44] = r[0x3EEE]; r[0x46] = r[0x44]; r[0x45] = r[0x3EEF]; r[0x47] = (r[0x45]+0x0C) & 0xFF;
  r[0x428D] = (r[0x3EED]+2) & 0xFF;
  r[0x4291] = 0xD3;
  r[0x0223] = 1;
  if (y >= 0x14) { r[0x428C] = 2; r[0x428E] = 0xD7; r[0x428F] = 0xD8; r[0x4290] = 0xD9; }
  else if (y >= 0x0C) { r[0x428C] = 1; r[0x428E] = 0xD5; r[0x428F] = 0xD6; }
  else { r[0x428C] = 0; r[0x428E] = 0xD4; }
}; // beamRelease

/** ★ `$416C`: the beam — one to three characters, a column a frame, animated, exploding what it meets. */
Ship.prototype.beamStep = function () {
  var r = this.ram;
  var x = r[0x0224];
  if (x === 5) { x = 0; }
  r[0x4284] = r[0x4297+x];
  r[0x0224] = x+1;
  var p = this.w16(0x44);
  var y = r[0x428D], ch, fl, i;
  var xch = 0xFF;                                         // X after the restore loop
  if (r[0x4291] !== 0xD3) {
    if (this.levelIndex !== 2) {
      for (;;) {
        ch = this.sc(p+y);
        if (ch === r[0x4290] || ch === r[0x428F] || ch === r[0x428E]) { break; }
        y = (y-1) & 0xFF;
        if (y & 0x80) { r[0x0223]--; return; }
      }
    }
    r[0x428D] = y;
    for (i = r[0x428C]; i >= 0; i--) {
      this.sw(p+y, r[0x4291+i]); this.cw(p+y, r[0x4294+i]);
      y = (y-1) & 0xFF;
    }
    if (r[0x429D] === 0) {
      y = r[0x428D];
      if (y >= 0x25) { r[0x0223]--; return; }
      y++;
      r[0x428D] = y;
      ch = this.sc(p+y);
      if (ch >= 0xF1) { r[0x0223]--; return; }
      xch = ch;
      fl = this.flag(ch);
      if (fl === 0) {
        y++;
        r[0x428D] = y;
        ch = this.sc(p+y);                                  // $41DE
        if (ch >= 0xF1) { r[0x0223]--; return; }
        xch = ch;
        fl = this.flag(ch);
        if (fl === 0) { this.beamDraw(y); return; }
      }
      if (fl & 0x80) { r[0x428D] = (r[0x428D]-1) & 0xFF; }
    }
  } else {
    ch = this.sc(p+y);                                      // $41DE
    if (ch >= 0xF1) { r[0x0223]--; return; }
    xch = ch;
    fl = this.flag(ch);
    if (fl === 0) { this.beamDraw(y); return; }
    if (fl & 0x80) { r[0x428D] = (r[0x428D]-1) & 0xFF; }
  }
  // $41F2: something in the way
  if (xch === 0xB2) { this.beamDraw(r[0x428D]); return; }
  r[0x429D] = 0;
  var e = this.freeExplosion();
  if (e < 0) { r[0x0223]--; return; }
  r[0x2441+e] = r[0x428D];
  y = r[0x428D];
  r[0x022C] = e;
  this.s16(0x48, p);
  var type = 1;
  if (r[0x428C] !== 0 && r[0x428C] !== 1) {
    var q = (p-0x28) & 0xFFFF;
    this.s16(0x48, q);
    if ((q & 0xFF) === 0xD8) {
      this.s16(0x48, (q+0x28) & 0xFFFF);
    } else if (this.flag(this.sc(q+y)) & 0x80) {
      y = (y-1) & 0xFF;
      if (this.flag(this.sc(q+y)) & 0x80) {
        y = (y+1) & 0xFF;
        this.s16(0x48, (q+0x28) & 0xFFFF);
      }
    }
    r[0x2441+e] = y;
    type = 6;
  }
  this.explosionType(e, type);
  this.explosionDraw(e);
  r[0x0223]--;
}; // beamStep

/** ★ `$426B`: the beam's characters drawn right to left from column `y`, what was there saved. */
Ship.prototype.beamDraw = function (y) {
  var r = this.ram, p = this.w16(0x44);
  for (var i = r[0x428C]; i >= 0; i--) {
    var ch = this.sc(p+y);
    r[0x4291+i] = ch === 0xB2 ? 0 : ch;
    r[0x4294+i] = this.cc(p+y);
    this.sw(p+y, r[0x428E+i]); this.cw(p+y, r[0x4284]);    // $4283: LDA #imm — the frame's colour
    y = (y-1) & 0xFF;
  }
}; // beamDraw

// ---------------------------------------------------------------- missiles

/** ★ `$1CBC`: fire with missiles owned launches two, above and below the ship, aimed at the nearest enemy. */
Ship.prototype.missilesLaunch = function () {
  var r = this.ram;
  if (r[0x0777]) { return; }
  if (r[0x2B] < 0x3A) { return; }
  if (r[0x1FF0] & 0x80) { return; }
  if (r[0x1FD8]) { return; }
  if (r[0x1FD9]) { return; }
  this.missileTarget();
  r[0x1FDE] = r[0x1FDF] = r[0x3EED];
  var p = this.w16(0x3EEE);
  var up = (p-0x28) & 0xFFFF, down = (p+0x28) & 0xFFFF;
  r[0x1FDB] = up & 0xFF; r[0x1FDD] = up >> 8;
  r[0x1FDA] = down & 0xFF; r[0x1FDC] = down >> 8;
  if (r[0x1FDA] === 0xF8) { return; }
  r[0x1FE6] = r[0x1FE7] = 0;
  r[0x1FE4] = r[0x1FE5] = 0x80;
  r[0x1FE8] = r[0x1FE9] = 0xDE;
  r[0x1FEA] = r[0x1FEB] = 5;
  r[0x1FD8] = r[0x1FD9] = 1;
}; // missilesLaunch

/** ★ `$1C47`: the nearest enemy (sprite from $8A up) by |dx| + |dy| in characters. */
Ship.prototype.missileTarget = function () {
  var r = this.ram;
  r[0x1CAE] = r[0x1CAC] = r[0x1CB0] = 0xFF;
  for (var x = 14; x >= 0; x--) {
    if (r[0x044C+x] === 0) { continue; }
    if (r[0xAF+x] < 0x8A) { continue; }
    var row = r[0x02D5+x], sr = r[0x02E4];
    r[0x1CAE] = row === sr ? row : (row > sr ? row-sr : sr-row) & 0xFF;
    var col = r[0x02C6+x], sc = r[0x3EED];
    r[0x1CAC] = (col >= sc ? col-sc : sc-col) & 0xFF;
    var sum = (r[0x1CAC]+r[0x1CAE]) & 0xFF;
    if (sum >= r[0x1CB0]) { continue; }
    r[0x1CB0] = sum;
    r[0x1FEC] = x;
  }
  x = r[0x1FEC];
  r[0x1FED] = r[0x02A8+x]; r[0x1FEE] = r[0x02B7+x]; r[0x1FEF] = r[0x02C6+x];
}; // missileTarget

/** ★ `$1D39`: a missile's direction toward the target, after its delay. */
Ship.prototype.missileSteer = function (x) {
  var r = this.ram;
  if (r[0x1FEA+x]) { r[0x1FEA+x]--; return; }
  if (r[0x1CAC] & 0x80) { return; }
  var target = r[0x1FEE] << 8 | r[0x1FED], at = r[0x1FDC+x] << 8 | r[0x1FDA+x];
  var d = target-at;
  var zero = d === 0, below = d >= 0;
  var tc = r[0x1FEF], c = r[0x1FDE+x];
  var set = function (dx, dy, ch) { r[0x1FE4+x] = dx; r[0x1FE6+x] = dy; r[0x1FE8+x] = ch; };
  if (zero) {
    if (tc === c) {
      // ★ $1DAF: on the target's cell the nearest enemy is looked up again; with one found ($1CAC
      // positive) the direction stays and the next frame steers to it ($1DBA: BPL $1DCB = RTS),
      // without one the missile flies left (M4 had this the other way round)
      r[0x1DB6] = x;
      this.missileTarget();
      x = r[0x1DB6];
      if (!(r[0x1CAC] & 0x80)) { return; }
      set(0x80, 0, 0xDE);
    } else if (tc < c) { set(1, 0, 0xDF); }
    else { set(0x80, 0, 0xDE); }
  } else if (!below) {
    if (tc === c) { set(0, 1, 0xE0); } else if (tc < c) { set(1, 1, 0xE3); } else { set(0x80, 1, 0xE2); }
  } else {
    if (tc === c) { set(0, 0x80, 0xE1); } else if (tc < c) { set(1, 0x80, 0xE5); } else { set(0x80, 0x80, 0xE4); }
  }
}; // missileSteer

/** `$1E27`: the row pointer back into the slot. */
Ship.prototype.missileStore = function (x) {
  this.ram[0x1FDA+x] = this.ram[0xDA]; this.ram[0x1FDC+x] = this.ram[0xDB];
}; // missileStore

/** `$1E77`: the slot is free. */
Ship.prototype.missileOff = function (x) {
  this.ram[0x1FD8+x] = 0; this.ram[0x1FDE+x] = 0; this.ram[0x1FE0+x] = 0xD3;
  this.missileStore(x);
}; // missileOff

/** ★ `$1E14`: the two homing missiles, a character each, a cell a frame. */
Ship.prototype.missilesStep = function () {
  var r = this.ram;
  if (r[0x1FF0] & 0x80) { return; }
  for (var x = 1; x >= 0; x--) {
    var st = r[0x1FD8+x];
    if (st === 0) { continue; }
    var p = r[0x1FDA+x] | r[0x1FDC+x] << 8;
    this.s16(0xDA, p); r[0xDC] = r[0xDA]; r[0xDD] = (r[0xDB]+0x0C) & 0xFF;
    var y, ch, fl;
    if (st & 0x80) {                                      // $1E33: the flash
      y = (r[0x1FDE+x]-1) & 0xFF;
      var found = false;
      for (;;) {
        ch = this.sc(p+y);
        if (ch >= 0xF2) { found = true; break; }
        y = (y+1) & 0xFF;
        if (y === 0x26) { break; }
      }
      if (found) {
        r[0x1FDE+x] = y;
        if (ch !== 0xF3) { this.sw(p+y, ch+1); this.missileStore(x); continue; }
      } else {
        y = r[0x1FDE+x];
      }
      this.sw(p+y, r[0x1FE0+x]); this.cw(p+y, r[0x1FE2+x]);
      this.missileOff(x);
      continue;
    }
    y = r[0x1FDE+x];
    if (r[0x1FE0+x] !== 0xD3) {                           // $1EA1: on the screen
      if (this.sc(p+y) !== r[0x1FE8+x]) {
        y = (y-1) & 0xFF;
        if (this.sc(p+y) !== r[0x1FE8+x]) { this.missileOff(x); continue; }
      }
      this.sw(p+y, r[0x1FE0+x]); this.cw(p+y, r[0x1FE2+x]);
      r[0x1EC7] = y;
      this.missileSteer(x);
      y = r[0x1EC7];
      var dx = r[0x1FE4+x];
      if (dx !== 0) {
        if (dx & 0x80) { if (y >= 0x26) { this.missileOff(x); continue; } y++; }
        else { if (y < 2) { this.missileOff(x); continue; } y--; }
      }
      var dy = r[0x1FE6+x];
      if (dy !== 0) {
        if (!(dy & 0x80)) {
          if (r[0xDB] === 0xCC && r[0xDA] === 0) { this.missileOff(x); continue; }
          p = (p-0x28) & 0xFFFF;
        } else {
          if (r[0xDB] === 0xCE && r[0xDA] === 0xD0) { this.missileOff(x); continue; }
          p = (p+0x28) & 0xFFFF;
        }
        this.s16(0xDA, p); r[0xDC] = r[0xDA]; r[0xDD] = (r[0xDB]+0x0C) & 0xFF;
      }
    }
    // $1F0D
    r[0x1FDE+x] = y; r[0x0237] = y;
    ch = this.sc(p+y);
    if (ch >= 0xC0) { this.missileOff(x); continue; }
    var result = this.missileMeet(x, ch);
    if (result === 'off') { this.missileOff(x); continue; }
  }
}; // missilesStep

/**
 * ★ `$1F36`-`$1FB7`: the missile meets a character — empty: drawn there;
 * destructible: explodes; solid: steps aside and leaves the flash.
 * @returns {string} 'off' when the slot is to be freed.
 */
Ship.prototype.missileMeet = function (x, ch) {
  var r = this.ram, p = this.w16(0xDA);
  for (;;) {
    var fl = this.flag(ch);
    if (fl === 0) {                                       // $1FA0: draw
      r[0x1FE0+x] = ch;
      var y = r[0x0237];
      r[0x1FE2+x] = this.cc(p+y);
      this.sw(p+y, r[0x1FE8+x]); this.cw(p+y, 0x0F);
      this.missileStore(x);
      return '';
    }
    if (!(fl & 0x80)) {                                   // $1F73: destructible
      r[0x0238] = x;
      var e = this.freeExplosion();
      if (e >= 0) {
        r[0x022C] = e;
        r[0x2441+e] = r[0x0237];
        this.s16(0x48, p);
        this.explode();
      }
      return 'off';
    }
    // $1F3E: solid
    if (r[0x1FE0+x] === 0xD3) { return 'off'; }
    var dy = r[0x1FE6+x];
    if (dy === 0) {
      r[0x0237] = (r[0x0237]-1) & 0xFF;                   // $1F4F
    } else {
      if (dy & 0x80) { p = (p-0x28) & 0xFFFF; } else { p = (p+0x28) & 0xFFFF; }
      this.s16(0xDA, p); r[0xDC] = r[0xDA]; r[0xDD] = (r[0xDB]+0x0C) & 0xFF;
      var dx = r[0x1FE4+x];                               // $1F25
      if (dx !== 0) {
        if (!(dx & 0x80)) { r[0x0237] = (r[0x0237]+1) & 0xFF; } else { r[0x0237] = (r[0x0237]-1) & 0xFF; }
        if (r[0x0237] === 0) { ch = dx; continue; }       // falls into $1F36 with A = the direction
      }
    }
    // $1F52: the flash where the missile was
    y = r[0x0237];
    r[0x1FE0+x] = this.sc(p+y);
    r[0x1FE2+x] = this.cc(p+y);
    r[0x1FDE+x] = y;
    this.sw(p+y, 0xF2); this.cw(p+y, 1);
    r[0x1FD8+x] = 0x80;
    this.missileStore(x);
    return '';
  }
}; // missileMeet

// ---------------------------------------------------------------- the Force's shots

/** `$3F4D`: a Force shot slot is free. */
Ship.prototype.forceShotOff = function (x) {
  this.ram[0x40AA+x] = 0; this.ram[0x40B6+x] = 0; this.ram[0x40BA+x] = 0xD3;
  this.forceShotStore(x);
}; // forceShotOff

/** `$3EFD`: the row pointer back into the slot. */
Ship.prototype.forceShotStore = function (x) {
  this.ram[0x40AE+x] = this.ram[0x5A]; this.ram[0x40B2+x] = this.ram[0x5B];
}; // forceShotStore

/** ★ `$3EF0`: the four shots of the Force and the bits — a character each, moving by $40C2/$40C6. */
Ship.prototype.forceShotsStep = function () {
  var r = this.ram;
  for (var x = 3; x >= 0; x--) {
    var st = r[0x40AA+x];
    if (st === 0) { continue; }
    var p = r[0x40AE+x] | r[0x40B2+x] << 8;
    this.s16(0x5A, p); r[0x5C] = r[0x5A]; r[0x5D] = (r[0x5B]+0x0C) & 0xFF;
    var y, ch, fl;
    if (st & 0x80) {                                      // $3F09: the flash
      y = (r[0x40B6+x]-1) & 0xFF;
      var found = false;
      for (;;) {
        ch = this.sc(p+y);
        if (ch >= 0xF2) { found = true; break; }
        y = (y+1) & 0xFF;
        if (y === 0x26) { break; }
      }
      if (found) {
        r[0x40B6+x] = y;
        if (ch !== 0xF3) { this.sw(p+y, ch+1); this.forceShotStore(x); continue; }
      } else {
        y = r[0x40B6+x];
      }
      this.sw(p+y, r[0x40BA+x]); this.cw(p+y, r[0x40BE+x]);
      this.forceShotOff(x);
      continue;
    }
    y = r[0x40B6+x];
    if (r[0x40BA+x] !== 0xD3) {                           // $3F77: on the screen
      if (this.levelIndex !== 2 && this.sc(p+y) !== r[0x40CA+x]) {
        y = (y-1) & 0xFF;
        if (this.sc(p+y) !== r[0x40CA+x]) { this.forceShotOff(x); continue; }
      }
      this.sw(p+y, r[0x40BA+x]); this.cw(p+y, r[0x40BE+x]);
      var dx = r[0x40C2+x];
      if (dx !== 0) {
        if (dx & 0x80) { if (y >= 0x26) { this.forceShotOff(x); continue; } y++; }
        else { if (y < 2) { this.forceShotOff(x); continue; } y--; }
      }
      var dy = r[0x40C6+x];
      if (dy !== 0) {
        if (!(dy & 0x80)) {
          if (r[0x5B] === 0xCC && r[0x5A] === 0) { this.forceShotOff(x); continue; }
          p = (p-0x28) & 0xFFFF;
        } else {
          if (r[0x5B] === 0xCE && r[0x5A] === 0xD0) { this.forceShotOff(x); continue; }
          p = (p+0x28) & 0xFFFF;
        }
        this.s16(0x5A, p); r[0x5C] = r[0x5A]; r[0x5D] = (r[0x5B]+0x0C) & 0xFF;
      }
    }
    r[0x40B6+x] = y; r[0x022E] = y;                       // $3FDF
    ch = this.sc(p+y);
    if (ch >= 0xCB) { this.forceShotOff(x); continue; }
    if (this.forceShotMeet(x, ch) === 'off') { this.forceShotOff(x); }
  }
}; // forceShotsStep

/** ★ `$4008`-`$4089`: the Force's shot meets a character (as `missileMeet`). */
Ship.prototype.forceShotMeet = function (x, ch) {
  var r = this.ram, p = this.w16(0x5A);
  for (;;) {
    var fl = this.flag(ch);
    if (fl === 0) {                                       // $4072
      r[0x40BA+x] = ch;
      var y = r[0x022E];
      r[0x40BE+x] = this.cc(p+y);
      this.sw(p+y, r[0x40CA+x]); this.cw(p+y, 1);
      this.forceShotStore(x);
      return '';
    }
    if (!(fl & 0x80)) {                                   // $4045
      r[0x022D] = x;
      var e = this.freeExplosion();
      if (e >= 0) {
        r[0x022C] = e;
        r[0x2441+e] = r[0x022E];
        this.s16(0x48, p);
        this.explode();
      }
      return 'off';
    }
    if (r[0x40BA+x] === 0xD3) { return 'off'; }           // $4010
    var dy = r[0x40C6+x];
    if (dy === 0) {
      r[0x022E] = (r[0x022E]-1) & 0xFF;
    } else {
      if (dy & 0x80) { p = (p-0x28) & 0xFFFF; } else { p = (p+0x28) & 0xFFFF; }
      this.s16(0x5A, p); r[0x5C] = r[0x5A]; r[0x5D] = (r[0x5B]+0x0C) & 0xFF;
      var dx = r[0x40C2+x];
      if (dx !== 0) {
        if (!(dx & 0x80)) { r[0x022E] = (r[0x022E]+1) & 0xFF; } else { r[0x022E] = (r[0x022E]-1) & 0xFF; }
        if (r[0x022E] === 0) { ch = dx; continue; }
      }
    }
    y = r[0x022E];                                        // $4024
    r[0x40BA+x] = this.sc(p+y);
    r[0x40BE+x] = this.cc(p+y);
    r[0x40B6+x] = y;
    this.sw(p+y, 0xF2); this.cw(p+y, 1);
    r[0x40AA+x] = 0x80;
    this.forceShotStore(x);
    return '';
  }
}; // forceShotMeet

/** ★ `$4EC0`: the bits fire — a shot from each into slots 0 and 1, two rows above and below the ship. */
Ship.prototype.bitsFire = function () {
  var r = this.ram, p;
  if (!r[0x3079]) { return; }
  if (!r[0x40AA] && r[0x2B] >= 0x3A) {
    r[0x40AA] = 1; r[0x40B6] = r[0x3EED];
    p = (this.w16(0x2D)-0x50) & 0xFFFF;
    r[0x40AE] = p & 0xFF; r[0x40B2] = p >> 8;
    r[0x40C6] = 0;
    if (r[0x022A]) { r[0x40C2] = 0x80; r[0x40CA] = 0xDE; } else { r[0x40C2] = 1; r[0x40CA] = 0xDF; }
  }
  if (!r[0x307A]) { return; }
  if (r[0x40AB]) { return; }
  if (r[0x2E] === 0xCE && r[0x2D] >= 0xA8) { return; }
  r[0x40AB] = 1; r[0x40B7] = r[0x3EED];
  p = (this.w16(0x2D)+0x50) & 0xFFFF;
  r[0x40AF] = p & 0xFF; r[0x40B3] = p >> 8;
  r[0x40C7] = 0;
  if (r[0x022A]) { r[0x40C3] = 0x80; r[0x40CB] = 0xDE; } else { r[0x40C3] = 1; r[0x40CB] = 0xDF; }
}; // bitsFire

// ---------------------------------------------------------------- the blue laser

/** ★ `$42FA`: the reflecting laser — two beams, one from the Force's row up and one from two rows below down. */
Ship.prototype.laserBlueFire = function () {
  var r = this.ram;
  if (r[0x2B] < 0x32) { return; }
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  if (r[0x4791]) { return; }
  if (r[0x4792]) { return; }
  var y = (r[0x40CE]+(r[0x022A] ? 1 : 2)) & 0xFF;
  r[0x4797] = y; r[0x4798] = y;
  var p = this.w16(0x40CF);
  this.s16(0x52, p); r[0x54] = r[0x52]; r[0x55] = (r[0x53]+0x0C) & 0xFF;
  var ch = this.sc(p+y);
  if (ch >= 0xCB || this.flag(ch) !== 0) {
    r[0x4791] = 0;
  } else {
    r[0x479D] = ch; r[0x479F] = this.cc(p+y);
    this.sw(p+y, r[0x022A] ? 0xDA : 0xDB); this.cw(p+y, 3);
    r[0x4791] = 1; r[0x4799] = 1; r[0x479B] = 0;
    if (!r[0x022A]) { r[0x4799] = 0; }
    r[0x4793] = r[0x52]; r[0x4795] = r[0x53];
  }
  p = (p+0x50) & 0xFFFF;
  this.s16(0x52, p); r[0x54] = r[0x52]; r[0x55] = (r[0x53]+0x0C) & 0xFF;
  if ((p & 0xFF) === 0xF8) { r[0x4792] = 0; return; }
  ch = this.sc(p+y);
  if (ch >= 0xCB || this.flag(ch) !== 0) { r[0x4792] = 0; return; }
  r[0x479E] = ch; r[0x47A0] = this.cc(p+y);
  this.sw(p+y, r[0x022A] ? 0xDB : 0xDA); this.cw(p+y, 3);
  r[0x4792] = 1; r[0x479C] = 1;
  r[0x479A] = r[0x022A] ? 1 : 0;
  r[0x4794] = r[0x52]; r[0x4796] = r[0x53];
  this.sound(0x12);
}; // laserBlueFire

/**
 * ★ `$43E1`: the two beams of the blue laser, a diagonal cell a frame,
 * bouncing off solid characters ($4799 X direction, $479B Y direction).
 */
Ship.prototype.laserBlueStep = function () {
  var r = this.ram;
  for (var x = 1; x >= 0; x--) {
    if (!r[0x4791+x]) { continue; }
    r[0x022B] = x;
    var p = r[0x4793+x] | r[0x4795+x] << 8;
    this.s16(0x52, p); r[0x54] = r[0x52]; r[0x55] = (r[0x53]+0x0C) & 0xFF;
    var y = r[0x4797+x];
    if (this.levelIndex !== 2) {
      y = (y-1) & 0xFF;
      for (;;) {
        var ch = this.sc(p+y);
        if (ch === 0xDA || ch === 0xDB || ch === 0xDC) { break; }
        y = (y+1) & 0xFF;
        if (y >= 0x27) { break; }
      }
      if (y === 0x27) { this.laserBlueOff(x); continue; }
    }
    r[0x4797+x] = y;
    var dirX = r[0x4799+x], dirY = r[0x479B+x];
    var b = dirX === 0 ? (dirY === 0 ? 2 : 3) : (dirY === 0 ? 1 : 0);
    if (this.laserBlueMove(x, b) === 'off') { this.laserBlueOff(x); }
  }
}; // laserBlueStep

/** `$444A`: a beam is over. */
Ship.prototype.laserBlueOff = function (x) {
  this.ram[0x4791+x] = 0;
}; // laserBlueOff

/**
 * ★ `$4440` / `$44EA` / `$4597` / `$4638`: one step of a beam in one of the
 * four diagonal directions — restore, step, meet, bounce, draw.
 * @param {number} b - 0 right-down, 1 right-up, 2 left-up, 3 left-down.
 * @returns {string} 'off' when the beam ends.
 */
Ship.prototype.laserBlueMove = function (x, b) {
  var r = this.ram, self = this;
  var p = function () { return self.w16(0x52); };
  var y = r[0x4797+x];
  var right = b <= 1, down = b === 0 || b === 3;
  this.sw(p()+y, r[0x479D+x]); this.cw(p()+y, r[0x479F+x]);       // $471C (also before the edge ends it, $4447)
  if (right ? y === 0x26 : y === 0) { return 'off'; }
  var step = function (dn) {                                        // $4727 / $474B
    var q = self.w16(0x52);
    if (dn) { if (r[0x53] === 0xCE && r[0x52] === 0xD0) { return false; } q = (q+0x28) & 0xFFFF; }
    else { if (r[0x53] === 0xCC && r[0x52] === 0) { return false; } q = (q-0x28) & 0xFFFF; }
    self.s16(0x52, q); r[0x54] = r[0x52]; r[0x55] = (r[0x53]+0x0C) & 0xFF;
    return true;
  };
  var fl = function () { return self.flag(self.sc(p()+y)); };
  var destructible = function (f) { return f !== 0 && !(f & 0x80); };
  var finish = function (chr, nx, ny) {                             // $448C / $44A0 ...: save, draw, store
    if (nx !== undefined) { r[0x4799+x] = nx; }
    if (ny !== undefined) { r[0x479B+x] = ny; }
    var saved = self.laserBlueSave(x, y);
    if (saved === 'off') { return 'off'; }
    self.sw(p()+y, saved === null ? chr : saved); self.cw(p()+y, 3);
    r[0x4797+x] = y;
    r[0x4793+x] = r[0x52]; r[0x4795+x] = r[0x53];
    return '';
  };
  var turn = function (chr, nx, ny) {                               // $44D3 / $4576 / $4621 / $46C2
    self.sw(p()+y, chr);
    r[0x4799+x] = nx; r[0x479B+x] = ny; r[0x4797+x] = y;
    r[0x4793+x] = r[0x52]; r[0x4795+x] = r[0x53];
    return '';
  };
  y = right ? y+1 : y-1;
  if (!step(down)) { return 'off'; }
  var f = fl();
  if (f === 0) { return finish(down ? (right ? 0xDB : 0xDA) : (right ? 0xDA : 0xDB)); }
  if (destructible(f)) { return this.laserBlueExplode(x, y); }
  // solid ahead: back a column, look there
  y = right ? y-1 : y+1;
  f = fl();
  if (destructible(f)) { return this.laserBlueExplode(x, y); }
  if (f === 0) {
    // $44B4 / $4557 / $4602 / $46A3: the other row
    y = right ? y+1 : y-1;
    if (!step(!down)) { return 'off'; }
    f = fl();
    if (destructible(f)) { return this.laserBlueExplode(x, y); }
    y = right ? y-1 : y+1;
    if (!step(down)) { return 'off'; }
    if (b === 0) { r[0x4799+x] = 0; return finish(0xDA); }
    if (b === 1) { r[0x4799+x] = 0; return finish(0xDB); }
    if (b === 2) { r[0x4799+x] = 1; return finish(0xDA); }
    r[0x4799+x] = 1; return finish(0xDB);
  }
  // solid there too: the other row
  y = right ? y+1 : y-1;
  if (!step(!down)) { return 'off'; }
  f = fl();
  if (f & 0x80) {
    y = right ? y-1 : y+1;
    if (b === 0) { return turn(0xDB, 0, 0); }
    if (b === 1) { return turn(0xDA, 0, 1); }
    if (b === 2) { return turn(0xDB, 1, 1); }
    return turn(0xDA, 1, 0);
  }
  if (f !== 0) { return this.laserBlueExplode(x, y); }
  if (b === 0) { r[0x479B+x] = 0; return finish(0xDA); }
  if (b === 1) { r[0x479B+x] = 1; return finish(0xDB); }
  if (b === 2) { r[0x479B+x] = 1; return finish(0xDA); }
  r[0x479B+x] = 0; return finish(0xDB);
}; // laserBlueMove

/**
 * ★ `$46DB`: what the beam covers is saved — crossing the other beam ($DA/$DB)
 * gives $DC and shifts the saved pair; another object ends the beam.
 * @returns {number|string|null} null = draw the caller's char, a char to draw, or 'off'.
 */
Ship.prototype.laserBlueSave = function (x, y) {
  var r = this.ram, p = this.w16(0x52);
  var ch = this.sc(p+y);
  if (ch < 0xCB) { r[0x479D+x] = ch; r[0x479F+x] = this.cc(p+y); return null; }
  var a;
  if (ch === 0xDB) { a = 0xDA; } else if (ch === 0xDA) { a = 0xDB; } else { return 'off'; }
  r[0x479D] = r[0x479E]; r[0x479F] = r[0x47A0];
  r[0x479E] = a; r[0x47A0] = this.cc(p+y);
  return 0xDC;
}; // laserBlueSave

/** ★ `$476D`: the beam meets a destructible character — explode it, the beam ends. */
Ship.prototype.laserBlueExplode = function (x, y) {
  var r = this.ram;
  var e = this.freeExplosion();
  if (e >= 0) {
    r[0x022C] = e;
    r[0x2441+e] = y;
    this.s16(0x48, this.w16(0x52));
    this.explode();
  }
  return 'off';
}; // laserBlueExplode

// ---------------------------------------------------------------- the yellow laser

/** ★ `$47A1`: the ground laser — three beams up from the Force's row and three down. */
Ship.prototype.laserYellowFire = function () {
  var r = this.ram, x, y, p;
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  this.sound(8);
  var lower = r[0x4C4F] || r[0x4C50] || r[0x4C51];
  if (!lower && !(r[0x40D0] === 0xCC && r[0x40CF] < 0x50)) {
    for (x = 2; x >= 0; x--) {
      y = r[0x40CE];
      if (y < 2) { break; }
      y++;
      r[0x4C61+x] = y;
      p = (this.w16(0x40CF)-r[0x4C81+x]) & 0xFFFF;
      r[0x4C55+x] = p & 0xFF; r[0x4C5B+x] = p >> 8;
      r[0x4C6D+x] = 1; r[0x4C4F+x] = 1; r[0x4C67+x] = 0; r[0x4C73+x] = 0;
    }
  }
  if (r[0x4C52] || r[0x4C53] || r[0x4C54]) { return; }
  if (r[0x40D0] === 0xCE && r[0x40CF] >= 0x80) { return; }
  for (x = 2; x >= 0; x--) {
    y = r[0x40CE];
    if (y < 2) { return; }
    y++;
    r[0x4C64+x] = y;
    p = (this.w16(0x40CF)+r[0x4C82+x]) & 0xFFFF;
    r[0x4C58+x] = p & 0xFF; r[0x4C5E+x] = p >> 8;
    r[0x4C70+x] = 0x80; r[0x4C6A+x] = 0; r[0x4C76+x] = 0;
    r[0x4C52+x]++;
  }
}; // laserYellowFire

/**
 * ★ `$4848`: the yellow laser — glyph $DD animated into the shared set, then
 * the six beams, each a cell a frame along the terrain: a beam moves up or
 * down ($4C6D) until it meets a solid character, then runs along it
 * ($4C67, direction $4C73 = 1-4), turning at corners. The probe `$4C3E`
 * keeps X (its operands are the slot and the property it writes).
 */
Ship.prototype.laserYellowStep = function () {
  var r = this.ram, self = this;
  r[0x4C92] = (r[0x4C92]-1) & 0xFF;
  if (r[0x4C92] === 0) {
    r[0x4C92] = 3;
    var src = this.w16(0x4855);
    for (var i = 0; i < 8; i++) { this.glyphDD[i] = r[src+i]; }
    this.s16(0x4855, src+8);
    r[0x4C91] = (r[0x4C91]-1) & 0xFF;
    if (r[0x4C91] === 0) { r[0x4C91] = 4; this.s16(0x4855, 0x4C93); }
  }
  for (var x = 5; x >= 0; x--) {
    if (!r[0x4C4F+x]) { continue; }
    r[0x0230] = x;
    var p = r[0x4C55+x] | r[0x4C5B+x] << 8;
    this.s16(0x65, p); r[0x67] = r[0x65]; r[0x68] = (r[0x66]+0x0C) & 0xFF;
    var y = r[0x4C61+x];
    var result;
    if (r[0x4C85+x] === 0xD3) {                            // $48B4: fresh
      result = this.yellowProbe(x, y) ? 'off' : this.yellowPlace(x, y);
    } else if (this.sc(p+y) !== 0xDD) {
      result = 'off';
    } else {
      this.sw(p+y, r[0x4C85+x]); this.cw(p+y, r[0x4C8B+x]);
      result = this.yellowMove(x, y);
    }
    if (result === 'off') { r[0x4C4F+x] = 0; r[0x4C61+x] = 0; r[0x4C85+x] = 0xD3; }   // $4BBF
  }
}; // laserYellowStep

/** ★ `$4C3E`: the property of the character at (`$65`),Y; the slot and the property are kept in the operands. */
Ship.prototype.yellowProbe = function (x, y) {
  this.ram[0x4C4B] = x;
  this.ram[0x4C4D] = this.flag(this.sc(this.w16(0x65)+y));
  return this.ram[0x4C4D];
}; // yellowProbe

/** ★ `$4C1C` / `$4BF8`: the row up or down; false past the edge (the beam ends). */
Ship.prototype.yellowRow = function (down) {
  var r = this.ram;
  if (down) {
    if (r[0x66] === 0xCE && r[0x65] >= 0xD0) { return false; }
    this.s16(0x65, (this.w16(0x65)+0x28) & 0xFFFF);
  } else {
    if (r[0x66] === 0xCC && r[0x65] === 0) { return false; }
    this.s16(0x65, (this.w16(0x65)-0x28) & 0xFFFF);
  }
  r[0x67] = r[0x65]; r[0x68] = (r[0x66]+0x0C) & 0xFF;
  return true;
}; // yellowRow

/** ★ `$4B9F`: the beam drawn at column `y`, what was there saved. */
Ship.prototype.yellowPlace = function (x, y) {
  var r = this.ram, p = this.w16(0x65);
  r[0x4C61+x] = y; r[0x0231] = y;
  var ch = this.sc(p+y);
  if (ch >= 0xCC) { return 'off'; }
  r[0x4C85+x] = ch; r[0x4C8B+x] = this.cc(p+y);
  this.sw(p+y, 0xDD); this.cw(p+y, 7);
  r[0x4C55+x] = r[0x65]; r[0x4C5B+x] = r[0x66];            // $488A
  return '';
}; // yellowPlace

/** ★ `$4BCF`: the beam meets a destructible character — it explodes, the beam ends. */
Ship.prototype.yellowExplode = function (x, y) {
  var r = this.ram;
  var e = this.freeExplosion();
  if (e >= 0) {
    r[0x022C] = e;
    r[0x2441+e] = y;
    this.s16(0x48, this.w16(0x65));
    this.explode();
  }
  return 'off';
}; // yellowExplode

/**
 * ★ `$48DB`-`$4B9E`: one step of a yellow beam. The direction byte $4C73 is
 * 0 while it flies ($4C6D up/down), 1-4 while it runs along the terrain.
 * @returns {string} 'off' when the beam ends.
 */
Ship.prototype.yellowMove = function (x, y) {
  var r = this.ram, self = this;
  var set = function (a67, a6D, dir) { r[0x4C67+x] = a67; r[0x4C6D+x] = a6D; r[0x4C73+x] = dir; };
  var fl;
  var dir = r[0x4C73+x];
  if (dir === 0) {
    if (!(r[0x4C6D+x] & 0x80)) {                           // $48E0: flying up
      if (!this.yellowRow(false)) { return 'off'; }
      fl = this.yellowProbe(x, y);
      if (fl === 0) { return this.yellowPlace(x, y); }
      if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
      if (!this.yellowRow(true)) { return 'off'; }         // $48ED: back, and along the wall
      if (r[0x022A]) { y++; if (y >= 0x27) { return 'off'; } set(0x80, 0, 3); }
      else { y--; if (y === 0) { return 'off'; } set(1, 0, 3); }
      return this.yellowPlace(x, y);
    }
    if (!this.yellowRow(true)) { return 'off'; }           // $4916: flying down
    fl = this.yellowProbe(x, y);
    if (fl === 0) { return this.yellowPlace(x, y); }
    if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
    if (!this.yellowRow(false)) { return 'off'; }          // $4923
    if (r[0x022A]) { y++; if (y >= 0x27) { return 'off'; } set(0x80, 0, 1); }
    else { y--; if (y === 0) { return 'off'; } set(1, 0, 1); }
    return this.yellowPlace(x, y);
  }
  r[0x495E] = x;                                           // $494C: JMP ($4960)
  r[0x4960] = r[0x4C79+dir-1]; r[0x4961] = r[0x4C7D+dir-1];
  var a67 = r[0x4C67+x], a6D = r[0x4C6D+x];
  if (dir === 1) {                                         // $4962: along a floor, moving down first
    if (!this.yellowRow(true)) { return 'off'; }
    fl = this.yellowProbe(x, y);
    if (fl === 0) { set(0, 0x80, (a67 & 0x80) ? 4 : 2); return this.yellowPlace(x, y); }
    if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
    if (!this.yellowRow(false)) { return 'off'; }          // $4989
    if (!(a67 & 0x80)) {
      y--; if (y === 0) { return 'off'; }
      fl = this.yellowProbe(x, y);
      if (fl & 0x80) { y++; set(0, 1, 4); return this.yellowPlace(x, y); }
      if (fl === 0) { set(a67, 0, 1); return this.yellowPlace(x, y); }
      return this.yellowExplode(x, y);
    }
    y++; if (y >= 0x27) { return 'off'; }                  // $49C1
    fl = this.yellowProbe(x, y);
    if (fl & 0x80) { y--; set(0, 1, 2); return this.yellowPlace(x, y); }
    if (fl === 0) { set(a67, 0, 1); return this.yellowPlace(x, y); }
    return this.yellowExplode(x, y);
  }
  if (dir === 2) {                                         // $49F3: moving right
    y++; if (y >= 0x27) { return 'off'; }
    fl = this.yellowProbe(x, y);
    if (fl === 0) { set(0x80, 0, (a6D & 0x80) ? 3 : 1); return this.yellowPlace(x, y); }
    if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
    y--;                                                   // $4A1F
    if (!(a6D & 0x80)) {
      if (!this.yellowRow(false)) { return 'off'; }
      fl = this.yellowProbe(x, y);
      if (fl & 0x80) { if (!this.yellowRow(true)) { return 'off'; } set(1, 0, 3); return this.yellowPlace(x, y); }
      if (fl === 0) { set(0, a6D, 2); return this.yellowPlace(x, y); }
      return this.yellowExplode(x, y);
    }
    if (!this.yellowRow(true)) { return 'off'; }           // $4A54
    fl = this.yellowProbe(x, y);
    if (fl & 0x80) { if (!this.yellowRow(false)) { return 'off'; } set(1, 0, 1); return this.yellowPlace(x, y); }
    if (fl === 0) { set(0, a6D, 2); return this.yellowPlace(x, y); }
    return this.yellowExplode(x, y);
  }
  if (dir === 3) {                                         // $4A83: along a ceiling, moving up first
    if (!this.yellowRow(false)) { return 'off'; }
    fl = this.yellowProbe(x, y);
    if (fl === 0) { set(0, 1, (a67 & 0x80) ? 4 : 2); return this.yellowPlace(x, y); }
    if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
    if (!this.yellowRow(true)) { return 'off'; }           // $4AAA
    if (!(a67 & 0x80)) {
      y--; if (y === 0) { return 'off'; }
      fl = this.yellowProbe(x, y);
      if (fl & 0x80) { y++; set(0, 0x80, 4); return this.yellowPlace(x, y); }
      if (fl === 0) { set(a67, 0, 3); return this.yellowPlace(x, y); }
      return this.yellowExplode(x, y);
    }
    y++; if (y >= 0x27) { return 'off'; }                  // $4AE2
    fl = this.yellowProbe(x, y);
    if (fl & 0x80) { y--; set(0, 0x80, 2); return this.yellowPlace(x, y); }
    if (fl === 0) { set(a67, 0, 3); return this.yellowPlace(x, y); }
    return this.yellowExplode(x, y);
  }
  // $4B14: moving left
  y--; if (y === 0) { return 'off'; }
  fl = this.yellowProbe(x, y);
  if (fl === 0) { set(1, 0, (a6D & 0x80) ? 3 : 1); return this.yellowPlace(x, y); }
  if (!(fl & 0x80)) { return this.yellowExplode(x, y); }
  y++;                                                     // $4B3E
  if (!(a6D & 0x80)) {
    if (!this.yellowRow(false)) { return 'off'; }
    fl = this.yellowProbe(x, y);
    if (fl & 0x80) { if (!this.yellowRow(true)) { return 'off'; } set(0x80, 0, 3); return this.yellowPlace(x, y); }
    if (fl === 0) { set(0, a6D, 4); return this.yellowPlace(x, y); }
    return this.yellowExplode(x, y);
  }
  if (!this.yellowRow(true)) { return 'off'; }             // $4B73
  fl = this.yellowProbe(x, y);
  if (fl & 0x80) { if (!this.yellowRow(false)) { return 'off'; } set(0x80, 0, 1); return this.yellowPlace(x, y); }
  if (fl === 0) { set(0, a6D, 4); return this.yellowPlace(x, y); }
  return this.yellowExplode(x, y);
}; // yellowMove

// ---------------------------------------------------------------- the red laser

/** ★ `$4CB3`: the anti-air laser — a wave of three rows from the Force forward. */
Ship.prototype.laserRedFire = function () {
  var r = this.ram;
  if (r[0x32] === 0 || (r[0x32] & 0x80)) { return; }
  if (r[0x34]) { return; }
  if (r[0x4EAC]) { return; }
  this.sound(0x15);
  this.bitsFire();
  var a = (r[0x40CE]+1) & 0xFF;
  if (a < 2 || a >= 0x27) { return; }
  r[0x4EAF] = a;
  r[0x4EAD] = r[0x40CF]; r[0x4EAE] = r[0x40D0];
  r[0x4EAC]++;
  r[0x4EB5] = 2;
  for (var x = 2; x >= 0; x--) { r[0x4EB1+x] = r[0x022A] ? 0 : 2; }
  r[0x4EB0] = 0xD3;
  this.laserRedBody();                                    // $4D06: BMI $4D0E — drawn in the same frame
}; // laserRedFire

/** ★ `$4D08`: the red laser's frame — the three rows restored, the column moved by two, the wave drawn again. */
Ship.prototype.laserRedStep = function () {
  if (!this.ram[0x4EAC]) { return; }
  this.laserRedBody();
}; // laserRedStep

/** ★ `$4D0E`: the red laser's frame — entered by the step and by the fire routine. */
Ship.prototype.laserRedBody = function () {
  var r = this.ram, self = this;
  this.s16(0x71, 0x4EB7);
  var reset = function () {                                         // $4D16
    var p = self.w16(0x4EAD);
    self.s16(0x69, p); r[0x6B] = r[0x69]; r[0x6C] = (r[0x6A]+0x0C) & 0xFF;
    self.s16(0x6D, 0x042E); self.s16(0x6F, 0x043A);
    r[0x4EB5] = 2;
  };
  reset();
  if (r[0x4EB0] !== 0xD3) {                                         // $4D46: restore
    r[0x73] = r[0x4EAF];
    for (;;) {
      r[0x4EB4] = 0;
      for (var k = 0; k < 4; k++) {
        var a = r[this.w16(0x6D)+k];
        if (a === 0xD3) { r[0x4EB6]++; break; }
        var co = r[this.w16(0x6F)+k];
        var y = r[0x73];
        this.cw(this.w16(0x69)+y, co); this.sw(this.w16(0x69)+y, a);
        if (r[0x022A]) { y++; } else { y--; if (y < 0) { y = 0; } }
        r[0x73] = y;
        r[0x4EB4]++;
      }
      r[0x4EB5] = (r[0x4EB5]-1) & 0xFF;                           // $4D7A
      if (!(r[0x4EB5] & 0x80)) {
        while (this.laserRedNextRow()) { r[0x4EB5] = (r[0x4EB5]-1) & 0xFF; if (r[0x4EB5] & 0x80) { break; } }
        if (!(r[0x4EB5] & 0x80)) { r[0x73] = r[0x4EAF]; continue; }
      }
      if (r[0x4EB6]) { r[0x4EAC] = 0; r[0x4EB6] = 0; return; }     // $4D7F
      if (r[0x022A]) {
        r[0x4EAF] = (r[0x4EAF]+2) & 0xFF;
        r[0x4EB1]++;
        a = r[0x4EB1] >= 3 ? 0 : r[0x4EB1];
        r[0x4EB1] = a;
      } else {
        r[0x4EAF] = (r[0x4EAF]-2) & 0xFF;
        r[0x4EB1] = (r[0x4EB1]-1) & 0xFF;
        a = r[0x4EB1];
        if (a & 0x80) { a = 2; r[0x4EB1] = a; }
      }
      r[0x4EB2] = a; r[0x4EB3] = a;
      r[0x4EB0] = 0xD3;
      reset();
      break;
    }
  }
  // $4DD5: draw
  for (;;) {
    r[0x4EB4] = 0;
    var yy = r[0x4EAF];
    var ended = false;
    for (;;) {
      var p = this.w16(0x69);
      var ch = this.sc(p+yy);
      var save;
      if (ch >= 0xCB) { ended = true; }
      else {
        var fl = this.flag(ch);
        if (fl & 0x80) { ended = true; } else { save = fl ? 0 : ch; }
      }
      if (ended) { r[this.w16(0x6D)+r[0x4EB4]] = 0xD3; break; }
      r[0x73] = yy;
      k = r[0x4EB4];
      r[this.w16(0x6F)+k] = this.cc(p+yy);
      r[this.w16(0x6D)+k] = save;
      var row = r[0x4EB5];
      var chr = r[this.w16(0x71)+r[0x4EB1+row]];
      if (!r[0x022A]) {
        if (yy !== 0 && chr !== 0) { this.sw(p+yy, chr); this.cw(p+yy, 9); }
        r[0x4EB1+row] = (r[0x4EB1+row]-1) & 0xFF;
        if (r[0x4EB1+row] & 0x80) { r[0x4EB1+row] = 2; }
        yy--;
        if (yy < 0) { r[this.w16(0x6D)+r[0x4EB4]] = 0xD3; break; }
      } else {
        if (yy !== 0x26 && chr !== 0) { this.sw(p+yy, chr); this.cw(p+yy, 9); }
        r[0x4EB1+row]++;
        if (r[0x4EB1+row] >= 3) { r[0x4EB1+row] = 0; }
        yy++;
        if (yy === 0x27) { r[this.w16(0x6D)+r[0x4EB4]] = 0xD3; break; }
      }
      r[0x4EB4]++;
      if (r[0x4EB4] >= 4) { break; }
    }
    r[0x4EB5] = (r[0x4EB5]-1) & 0xFF;                               // $4E64
    if (r[0x4EB5] & 0x80) { r[0x4EB0] = 0; return; }
    this.s16(0x71, this.w16(0x71)+3);
    if (this.laserRedNextRow()) { r[0x4EB0] = 0; return; }
  }
}; // laserRedBody

/** ★ `$4E82`: the red laser's next row — the buffers on, the row pointer down; true past the bottom. */
Ship.prototype.laserRedNextRow = function () {
  var r = this.ram;
  var m = r[0x6D]+4;
  r[0x6D] = m & 0xFF;
  r[0x6F] = ((m & 0xFF)+0x0C+(m > 0xFF ? 1 : 0)) & 0xFF;
  if (r[0x6A] === 0xCE && r[0x69] === 0xD0) { return true; }
  var q = r[0x69]+0x28;
  r[0x69] = q & 0xFF; r[0x6B] = r[0x69];
  if (q > 0xFF) { r[0x6A]++; r[0x6C]++; }
  return false;
}; // laserRedNextRow

// ---------------------------------------------------------------- explosions

/** ★ `$23B0`: an explosion slot takes the size, frames and chars of type `ty`; the score gets `ty`. */
Ship.prototype.explosionType = function (x, ty) {
  var r = this.ram;
  r[0x3389] = ty;
  r[0x2447+x] = r[0x23DA+ty]; r[0x244D+x] = r[0x23E1+ty]; r[0x245F+x] = r[0x23E8+ty];
  r[0x246B+x] = 2; r[0x2453+x] = 2;
  r[0x2471+x] = r[0x23EF+ty]; r[0x2477+x] = r[0x23F6+ty];
}; // explosionType

/** ★ `$2330`: the pointers of explosion slot `x` into the zero page. */
Ship.prototype.explosionPointers = function (x) {
  var r = this.ram;
  r[0x48] = r[0x4A] = r[0x2435+x]; r[0x49] = r[0x243B+x]; r[0x4B] = (r[0x49]+0x0C) & 0xFF;
  r[0x4C] = r[0x247D+x]; r[0x4D] = r[0x2483+x]; r[0x4E] = r[0x2489+x]; r[0x4F] = r[0x248F+x];
  r[0x50] = r[0x2471+x]; r[0x51] = r[0x2477+x];
  r[0x0227] = 0; r[0x0228] = 0;
}; // explosionPointers

/** ★ `$2368`: the next row of an explosion — or, at the bottom of the field, the last. */
Ship.prototype.explosionNextRow = function (x) {
  var r = this.ram;
  if (r[0x49] === 0xCE && r[0x48] >= 0xD0) { r[0x0228] = (r[0x244D+x]-1) & 0xFF; return; }
  this.s16(0x4C, this.w16(0x4C)+4);
  this.s16(0x4E, this.w16(0x4E)+4);
  this.s16(0x50, this.w16(0x50)+r[0x2447+x]);
  var a = r[0x48]+0x28;
  r[0x48] = r[0x4A] = a & 0xFF;
  if (a > 0xFF) { r[0x49]++; r[0x4B]++; }
}; // explosionNextRow

/**
 * ★ `$3440`: the character hit looked up in the level's table of destructible
 * objects: the explosion is placed at the object's top left and typed.
 * @returns {boolean} false = not destructible here (the caller returns).
 */
Ship.prototype.destructibleLookup = function (x, y) {
  var r = this.ram;
  var t = r[0x34C0+this.levelIndex] | r[0x34C8+this.levelIndex] << 8;
  this.s16(0x5E, t);
  r[0x60] = this.sc(this.w16(0x48)+y);
  for (;;) {
    var c = r[t];
    if (c === 0xD3) { return false; }
    if (c === r[0x60]) { break; }
    t += 4;
    this.s16(0x5E, t);
  }
  var d = r[0x2441+x]-r[t+1];
  if (!(d & 0x80)) {
    r[0x2441+x] = d;
    r[0x348C] = 1;
    if (this.flag(this.sc(this.w16(0x48)+d)) & 0x80) { r[0x2441+x]++; }
  }
  if (r[0x48] !== 0x50) { this.s16(0x48, (this.w16(0x48)-r[t+2]) & 0xFFFF); }
  r[0x34B7] = 2;
  if (this.flag(this.sc(this.w16(0x48)+r[0x2441+x])) & 0x80) { this.s16(0x48, (this.w16(0x48)+0x28) & 0xFFFF); }
  this.explosionType(x, r[t+3]);
  return true;
}; // destructibleLookup

/** ★ `$2154`: an explosion at `$48`, column `$2441,X` of slot `$022C`. */
Ship.prototype.explode = function () {
  var r = this.ram;
  var x = r[0x022C], y = r[0x2441+x];
  if (y >= 0x25) { return; }
  if (!this.destructibleLookup(x, y)) { return; }
  this.explosionDraw(x);
}; // explode

/**
 * ★ `$2162`: the first frame of an explosion drawn, what was under it saved
 * into the slot's buffer in the stack page; an object in the way undoes it.
 */
Ship.prototype.explosionDraw = function (x) {
  var r = this.ram;
  r[0x2435+x] = r[0x48]; r[0x243B+x] = r[0x49];
  this.explosionPointers(x);
  r[0x2459+x] = r[this.w16(0x50)];
  var y = r[0x2441+x];
  for (;;) {
    var p = this.w16(0x48);
    var ch = this.sc(p+y);
    if (ch >= 0xEE || (ch >= 0xCB && ch < 0xE7)) { this.explosionAbort(x, y); return; }
    var k = r[0x0227];
    r[0x0229] = y;
    r[this.w16(0x4E)+k] = this.cc(p+y);
    r[this.w16(0x4C)+k] = ch;
    if (!(this.flag(ch) & 0x80)) { this.sw(p+y, r[this.w16(0x50)+k]); this.cw(p+y, 1); }
    y = (r[0x0229]+1) & 0xFF;
    if (y === 0x26) {
      r[0x2465+x] = r[0x0227];
      y = r[0x2441+x];
    } else {
      r[0x0227]++;
      if (r[0x0227] < r[0x2447+x]) { continue; }
      r[0x2465+x] = r[0x0227];
    }
    r[0x0227] = 0;                                        // $21CE
    this.explosionNextRow(x);
    r[0x0228]++;
    if (r[0x0228] === r[0x244D+x]) { r[0x242F+x] = 1; return; }
    if (r[0x0228] > r[0x244D+x]) { this.explosionAbort(x, y); return; }
    y = r[0x2441+x];
  }
}; // explosionDraw

/** ★ `$21EF`: the drawing met an object — the row so far is put back and the explosion ends at once. */
Ship.prototype.explosionAbort = function (x, y) {
  var r = this.ram;
  r[0x0229] = y;
  r[0x0228]++;
  r[0x244D+x] = r[0x0228];
  for (;;) {
    r[0x0227] = (r[0x0227]-1) & 0xFF;
    if (r[0x0227] & 0x80) { break; }
    r[0x0229] = (r[0x0229]-1) & 0xFF;
    var k = r[0x0227], p = this.w16(0x48), yy = r[0x0229];
    this.sw(p+yy, r[this.w16(0x4C)+k]);
    this.cw(p+yy, r[this.w16(0x4E)+k]);
  }
  this.explosionPointers(x);
  this.explosionEnd(x, r[0x0229]);
}; // explosionAbort

/** ★ `$221C`: the explosions animate every second frame; the last frame puts the terrain back. */
Ship.prototype.explosionsStep = function () {
  var r = this.ram;
  for (var x = 5; x >= 0; x--) {
    if (!r[0x242F+x]) { continue; }
    r[0x2453+x] = (r[0x2453+x]-1) & 0xFF;
    if (r[0x2453+x] !== 0) { continue; }
    r[0x2453+x] = 2;
    var ph = r[0x246B+x];
    r[0x246B+x] = (ph-1) & 0xFF;
    r[0x2289] = r[0x2495+ph];
    this.explosionPointers(x);
    var a = r[0x2459+x];
    r[0x2274] = a;
    var y = (r[0x2441+x]-1) & 0xFF;
    if (y & 0x80) { this.explosionEnd(x, (y+1) & 0xFF); continue; }
    y = (y-1) & 0xFF;
    if (y & 0x80) { y = (y+1) & 0xFF; }
    r[0x226B] = y;
    var p = this.w16(0x48);
    var matched = false, skip = false;
    for (;;) {
      if (this.sc(p+y) === a) { matched = true; break; }
      if (a >= 0xCB && a < 0xF1) { skip = true; break; }
      y++;
      if (y >= 0x26) { break; }
    }
    if (skip) { continue; }
    if (!matched) { this.explosionEnd(x, r[0x226B]); continue; }
    r[0x2441+x] = y;
    if (r[0x2274] >= r[0x245F+x]) { this.explosionEnd(x, y); continue; }
    for (;;) {                                            // $227D
      p = this.w16(0x48);
      var ch = this.sc(p+y);
      if (ch >= 0xF1) { this.sw(p+y, ch+1); this.cw(p+y, r[0x2289]); }   // $2288: LDA #imm, the phase's colour
      var endRow = false;
      if (r[0x0227] === r[0x2465+x]) { endRow = true; }
      else {
        y++;
        if (y === 0x26) { endRow = true; }
        else {
          r[0x0227]++;
          if (r[0x0227] < r[0x2447+x]) { continue; }
          endRow = true;
        }
      }
      this.explosionNextRow(x);                           // $22A4
      y = r[0x2441+x];
      r[0x0227] = 0;
      r[0x0228]++;
      if (r[0x0228] < r[0x244D+x]) { continue; }
      break;
    }
    r[0x2459+x]++;
  }
}; // explosionsStep

/** ★ `$22C0`: the end of an explosion — the saved characters back, destroyed blocks replaced, the slot freed. */
Ship.prototype.explosionEnd = function (x, y) {
  var r = this.ram;
  r[0x0229] = y; r[0x022C] = x;
  for (;;) {
    var k = r[0x0227], p = this.w16(0x48);
    y = r[0x0229];
    var ch = r[this.w16(0x4C)+k], co = r[this.w16(0x4E)+k];
    this.cw(p+y, co);
    var write = -1;
    if (ch >= 0xCB) { write = this.blockReplace(y); }
    else {
      r[0x022C] = x;
      var fl = this.flag(ch);
      if (fl === 0) { write = ch; } else if (!(fl & 0x80)) { write = this.blockReplace(y); }
    }
    if (write >= 0) { this.sw(this.w16(0x48)+y, write); }
    x = r[0x022C];
    var endRow = false, straight = false;
    if (r[0x0227] === r[0x2465+x]) { endRow = true; }
    else {
      y++;
      if (y >= 0x26) { endRow = true; }
      else {
        r[0x0229] = y;
        r[0x0227]++;
        if (r[0x0227] < r[0x2447+x]) { continue; }
        if (r[0x0227] === r[0x2447+x]) { endRow = true; } else { straight = true; }
      }
    }
    if (endRow && !straight) { y = r[0x2441+x]; r[0x0229] = y; }
    r[0x0227] = 0;                                        // $2315
    this.explosionNextRow(x);
    r[0x0228]++;
    if (r[0x0228] < r[0x244D+x]) { continue; }
    r[0x242F+x] = 0;
    return;
  }
}; // explosionEnd

/**
 * ★ `$1FF1`: what a destroyed block leaves behind — in levels 2, 5, 6 and 7 a
 * character from the level's table by row and map column, with a colour;
 * elsewhere nothing (0).
 * @returns {number} The character.
 */
Ship.prototype.blockReplace = function (y) {
  var r = this.ram;
  r[0x63] = y;
  var lv = this.levelIndex;
  var col = r[0x2074+lv];
  if (col === 0xD3) { return 0; }
  this.cw(this.w16(0x48)+y, col);
  var k;
  for (k = 0; k < 0x13; k++) { if (r[0x48] === r[0x2F72+k]) { break; } }
  if (k === 0x13) { return 0; }
  var a = (((r[0x0201]-0x27) & 0xFF)+r[0x63]) & 0xFF;
  if (a >= 4) {
    var chk = true;
    if (a >= 0xC8) { a -= 0xC8; }
    else if (a >= 0x94) { a -= 0x94; }
    else if (a >= 0x64) { a -= 0x64; }
    else if (a >= 0x30) { a -= 0x30; }
    else { chk = false; }
    if (!chk || a >= 4) { do { a -= 4; } while (a >= 4); }
  }
  r[0x61] = a;
  var m = r[0x206C+lv], kk = k;
  while (kk >= m) { kk -= m; }
  r[0x62] = kk;
  var idx = kk*4+a;
  return r[this.w16(0x2068)+idx];
}; // blockReplace

// ---------------------------------------------------------------- enemy bullets (M4 moves them; the shift and the counter are the ship's frame)

/** ★ `$2562`: the enemy bullets — the colour phase every frame, then every bullet a cell on its way. */
Ship.prototype.enemyBulletsStep = function () {
  var r = this.ram;
  var x = r[0x26D1]+1;
  if (x >= 4) { x = 0; }
  r[0x26D6] = r[0x26D7+x];
  r[0x26D1] = x;
  for (x = 9; x >= 0; x--) {
    if (!r[0x02E5+x]) { continue; }
    var p, y, ch;
    if (r[0x0366+x] !== 0xD3) {
      p = r[0x037A+x] | r[0x0384+x] << 8;
      this.s16(0xDE, p); r[0xE0] = r[0xDE]; r[0xE1] = (r[0xDF]+0x0C) & 0xFF;
      y = r[0x038E+x];
      var gone = false;
      if (this.levelIndex === 2) {
        gone = this.sc(p+y) >= 0xEE;
      } else {
        for (;;) {
          if (this.sc(p+y) === r[0x035C+x]) { break; }
          y = (y-1) & 0xFF;
          if (y & 0x80) { gone = true; break; }
        }
      }
      if (gone) { r[0x02E5+x] = 0; r[0x02EF+x] = 0; continue; }
      this.sw(p+y, r[0x0366+x]); this.cw(p+y, r[0x0370+x]);
    }
    var row = r[0x0352+x] >> 3;                           // $25C9
    r[0xDE] = r[0xE0] = r[0x2F72+row]; r[0x037A+x] = r[0xDE];
    r[0xDF] = r[0x2F8B+row]; r[0x0384+x] = r[0xDF]; r[0xE1] = (r[0xDF]+0x0C) & 0xFF;
    p = this.w16(0xDE);
    var col = r[0x0348+x] >> 2;
    r[0x038E+x] = col;
    ch = this.sc(p+col);
    if (ch >= 0xC7 || this.flag(ch) !== 0) { r[0x02E5+x] = 0; r[0x02EF+x] = 0; continue; }
    y = col;
    r[0x0366+x] = this.sc(p+y); r[0x0370+x] = this.cc(p+y);
    var kind = r[0x02EF+x];
    if (kind) {
      var c2 = r[0x26E0+kind];
      r[0x035C+x] = r[0x26DB+kind];
      this.sw(p+y, r[0x035C+x]); this.cw(p+y, c2);
      if (kind === 2) { r[0x033E+x] = 0x84; r[0x0334+x] = 0; }
      else { r[0x0334+x] = (r[0x0334+x] & 0x80) | 8; r[0x033E+x] = 0; }
    } else {
      r[0x26D0] = ((r[0x0348+x] << 1) & 4) >> 2;
      var q = ((r[0x0352+x] & 4) >> 1) | r[0x26D0];
      r[0x035C+x] = r[0x26D2+q];
      this.sw(p+y, r[0x035C+x]); this.cw(p+y, r[0x26D6]);
    }
    var a = r[0x0334+x], v, remove = false;                // $2671
    if (!(a & 0x80)) {
      v = (a >> 1)+r[0x0348+x];
      if (v >= 0x99) { remove = true; } else { r[0x0348+x] = v; }
    } else {
      v = (r[0x0348+x]-((a & 0x0F) >> 1)) & 0xFF;
      if (v < 8) { remove = true; } else { r[0x0348+x] = v; }
    }
    if (!remove) {
      a = r[0x033E+x];
      if (!(a & 0x80)) {
        v = a+r[0x0352+x];
        if (v >= 0x90) { remove = true; } else { r[0x0352+x] = v; }
      } else {
        v = (r[0x0352+x]-(a & 7)) & 0xFF;
        if (v < 8) { remove = true; } else { r[0x0352+x] = v; }
      }
    }
    if (remove) {                                         // $26BB
      this.sw(p+y, r[0x0366+x]); this.cw(p+y, r[0x0370+x]);
      r[0x02E5+x] = 0; r[0x02EF+x] = 0;
    }
  }
}; // enemyBulletsStep

// ---------------------------------------------------------------- items, the enemy loop, the shifts

/**
 * ★ `$1B61`: an item picked up — a bit ($3079/$307A), a crystal (the Force
 * arrives or levels up, its laser by the crystal's colour), speed, missiles;
 * anything else is a collision. Then `$1C26`: the slot is cleared.
 */
Ship.prototype.pickup = function (x) {
  var r = this.ram;
  var ptr = r[0xAF+x];
  if (ptr === 0x4A) {
    if (r[0x3079]) { r[0x307A] = 1; } else { r[0x3079] = 1; }
  } else if (ptr === 0x5B) {
    var lv = r[0x33];
    if (lv === 0) { r[0x33]++; r[0x32] = 0x80; }
    else if (lv !== 4) {
      if (lv === 1) { r[0x33] += r[0x022A] === 0 ? 2 : 1; }
      else if (lv === 2) { r[0x33] += 2; }
      else { r[0x33]++; }
    }
    this.forceTables();
    if (!(r[0x32] & 0x80)) {
      var a;
      if (r[0x022A]) {
        r[0x28] = r[0x26] ? 1 : 0;
        a = r[0x25]+r[0x2FC6];
        r[0x27] = a & 0xFF;
        if (a > 0xFF) { r[0x28] = 1; }
      } else {
        a = r[0x25]-r[0x2FC5];
        r[0x27] = a & 0xFF;
        if (a < 0) { r[0x28] = 0; }
      }
      r[0x2C] = (r[0x2B]+r[0x2FC7]) & 0xFF;
    }
    if (r[0x33] !== 1) {
      var y = r[0xBE+x];
      r[0x3B99] = r[0x1BFC+y]; r[0x3B9A] = r[0x1C04+y];
      this.forceRegs();
    }
  } else if (ptr === 0x5C) {
    if (r[0x24] !== 5) { r[0x24]++; }
  } else if (ptr === 0x5D) {
    r[0x1FF0] = 1;
  }
  // (★ anything else: $1C1E JMP collision, whose RTS returns to the enemy loop's $1916 — the
  // enemy dies there; `Enemies.loop` does that, so only items come here)
  r[0x3388] = 4;                                          // $1C26
  r[0x044C+x] = 0; r[0x82+x] = 0; r[0x91+x] = 0; r[0xA0+x] = 0x64;
  r[0x1C43] = x;
  this.sound(0x16);
}; // pickup

/** ★ `$361E`-`$3633`: a column shift moves the red laser and the yellow beams a column, the enemy bullets 4 px. */
Ship.prototype.onColumnShift = function () {
  var r = this.ram;
  r[0x4EAF] = (r[0x4EAF]-1) & 0xFF;
  for (var i = 0; i < 6; i++) { r[0x4C61+i] = (r[0x4C61+i]-1) & 0xFF; }
  this.bulletsShift(0x0348, -4);
}; // onColumnShift

/** ★ `$4F58`-`$4FA7`: the active enemy bullets moved with the terrain. */
Ship.prototype.bulletsShift = function (at, by) {
  var r = this.ram;
  for (var x = 9; x >= 0; x--) {
    if (r[0x02E5+x]) { r[at+x] = (r[at+x]+by) & 0xFF; }
  }
}; // bulletsShift

/**
 * ★ Level 3: a tick of the window moves every sprite slot with the terrain
 * (`$3A29` left, `$3A49` right, `$3A68` down, `$3A9F` up); a shifted column or
 * row moves the enemy bullets (`$4F58`, `$4F6C`, `$4F80`, `$4F94`).
 * @param {string} dir - 'left', 'right', 'up', 'down' for a tick, or the same
 *        with 'Shift' for the column or row that moved.
 */
Ship.prototype.onVerticalShift = function (dir) {
  var r = this.ram, x;
  switch (dir) {
    case 'left':
      for (x = 14; x >= 0; x--) {
        if (r[0x91+x] !== 0 && r[0x82+x] >= 0x80) { r[0x044C+x] = 0; continue; }
        r[0x82+x] = (r[0x82+x]+1) & 0xFF;
        if (r[0x82+x] === 0) { r[0x91+x] = r[0x56BD+x]; }
      }
      break;
    case 'right':
      for (x = 14; x >= 0; x--) {
        if (r[0x91+x] === 0 && r[0x82+x] === 0) { r[0x044C+x] = 0; continue; }
        r[0x82+x] = (r[0x82+x]-1) & 0xFF;
        if (r[0x82+x] === 0xFF) { r[0x91+x] = 0; }
      }
      break;
    case 'down': this.enemies.verticalMove(false); break;   // $3A68
    case 'up': this.enemies.verticalMove(true); break;      // $3A9F
    case 'leftShift': this.bulletsShift(0x0348, 4); break;
    case 'rightShift': this.bulletsShift(0x0348, -4); break;
    case 'upShift': this.bulletsShift(0x0352, 8); break;
    case 'downShift': this.bulletsShift(0x0352, -8); break;
  }
}; // onVerticalShift

// ---------------------------------------------------------------- the frame

/**
 * One PAL frame as the interrupt chain runs it, from the raster-48 handler
 * to the raster-202 one. Returns when the main loop would go to READY.
 */
Ship.prototype.frame = function () {
  this.frameCount++;
  this.band5Done = false;
  this.irq202Done = false;
  this.readyBegun = false;
  this.sequenceBegun = false;
  if (this.rules) { this.rules.clearBefore('irq48'); }
  this.irq48();
  // ★ the main loop runs whenever a handler returns to it (`mainLoopPoll`): after the raster-48
  // handler (the tick of its wait), after band 5 (a boss's death ends the level there) and after
  // the raster-202 handler (a death, a hook's end of the level). Not in the frame of a column shift
  // whose RTI falls into the next frame: the handler returned into the shift, not to the loop
  if (!this.shiftedLast) { this.mainLoopPoll(false); }
  // ★ the slots as the bands may still find them at raster 214: the state machine of band 5 often
  // runs past it (measured), so the handler there copies what the enemy loop left (`matchenemies`)
  if (!this.band5Done) { this.band5Nested(); }           // (else band 5 ran inside the enemy loop)
  if (!this.shiftedLast) { this.mainLoopPoll(false); }
  // ★ $09C5: the level-end sequence begins with SEI before raster 196 — no raster-202 handler then
  if (!this.sequenceBegun && !this.irq202Done) { this.irq202Nested(); }   // (else the handler ran inside band 5)
  if (!this.shiftedLast && !this.sequenceBegun) { this.mainLoopPoll(true); }
  if (this.scroll.shift && this.frameCount >= this.shiftInfo.endFrame) { this.applyShift(null); }
}; // frame

/**
 * The running column shift brought to where the original's stood when the
 * handler `point` ('band5', 'tail' — the boss step, 'irq202') came in this
 * frame — measured (`columnTiming`) or estimated.
 */
Ship.prototype.advanceShift = function (point) {
  var t = this.columnTiming ? this.columnTiming[this.frameCount] : null;
  var scroll = this.scroll;
  if (scroll.shift) {
    var p;
    if (this.columnTiming) {
      p = t && t[point] ? t[point].progress : null;      // no entry: the shift was over by then
    } else {
      p = this.shiftEstimate(point);
    }
    this.applyShift(p);
  }
  if (point === 'irq202') {
    if (this.columnTiming) {
      this.shiftGameStep = t && t.irq202 ? !!t.irq202.gameStep : true;
      this.irqOuter = !!(t && t.irq202 && t.irq202.outer);
    } else {
      // ★ level 3's redraw ($3848, with the music player) runs past raster 202 of its frame
      this.shiftGameStep = !scroll.shift && !(this.shifted && scroll.vertical);
      this.irqOuter = false;
    }
  }
}; // advanceShift

/**
 * The shift advanced to a state: `{copy: [loop, col] | 'done', pointer, column}`
 * (`timing.json`), or null for the whole rest of it.
 * @param {?Object} p
 */
Ship.prototype.applyShift = function (p) {
  var scroll = this.scroll;
  if (!scroll.shift) { return; }
  if (!p) { scroll.finishShift(); }
  else if (p.copy !== 'done') { scroll.copyTo(p.copy[0], p.copy[1], p.copy[2] || 0); }
  else {
    scroll.finishCopy();
    if (!p.busy) { scroll.moveWeapons(); }                // $361E-$3638 done, the pointer ($3650) maybe not yet
    if (p.pointer) { scroll.newColumnPointer(); }
    if (p.column) { scroll.drawColumnRows(p.column); }
  }
  this.syncScroll();
}; // applyShift

/**
 * ★ Without a recording's measurement: the typical state of the shift at
 * the handlers — the modes over the 4 568 shifts of M4's recordings: at
 * band 5 of its frame loop 3 (rows 3-6) at column 17 (14-22), at the boss
 * step loop 4 (rows 7-13) at column 2, at the raster-202 handler loop 4 at
 * column 5 (loop 3's last columns to loop 4's tenth); over by band 5 of
 * the next frame — in a third of the shifts the new column is still being
 * drawn then, but the map pointer has moved in all but 2.4 % of them, so
 * the spawner sees the new column as here.
 * @param {string} point
 * @returns {?Object}
 */
Ship.prototype.shiftEstimate = function (point) {
  if (this.frameCount !== this.shiftInfo.start) { return null; }
  return point === 'band5' ? {copy: [2, 17]} : point === 'tail' ? {copy: [3, 2]} : {copy: [3, 5]};
}; // shiftEstimate

/** ★ `$0D04`-`$0DE5`: the raster-48 handler — $0977 marks the frame, the blink, the scroll step, the enemy loop. */
Ship.prototype.irq48 = function () {
  var r = this.ram, scroll = this.scroll, v = this.vic;
  r[0x0977] = (this.levelIndex === 1 && scroll.reg64) ? scroll.reg64 : 0x30;
  // ★ $0D30: the chain of this frame is decided here — the boss's rows and its tail run even when the
  // boss's death ends the level in this frame ($5E17 clears $024C; the tail still patches the row
  // pointers and runs the level's step, M5)
  this.bossChain = !!r[0x024C];
  // $0D04-$0D2D: the VIC for the playfield — the fine scroll and 38 columns, the set, the colours
  v[0x16] = (r[0x020C] & 7) | 0x10; v[0x18] = r[0x0977];
  v[0x21] = 0; v[0x22] = r[0x021E]; v[0x23] = r[0x021F];
  this.shifted = false;
  var active = !!scroll.shift;                            // a shift still running from a frame before
  // ★ level 3: a redraw still running at this raster 48 ($0225) — no step and no loop this frame
  var redrawBusy = scroll.vertical && this.shiftInfo && this.shiftInfo.endFrame === this.frameCount && this.shiftInfo.start < this.frameCount;
  if (scroll.running && !r[0x024E] && redrawBusy) { this.blink(); }   // $0DC4: the blink, then $3702 sees $0225 and leaves
  if (scroll.running && !r[0x024E] && !redrawBusy) {
    this.blink();
    this.shifted = scroll.stepScroll();
    if (scroll.shift && !active) {
      var t = this.columnTiming && this.columnTiming[this.frameCount];
      // ★ without a measurement the shift is finished at the end of its own frame: the picture of
      // the frame is then whole (the original's copy stays behind the beam and the fine scroll
      // moves with the new column at the next raster 48 — a half-copied picture would tear)
      var end = t && t.ends && t.ends.end ? t.ends.end.frame : this.columnTiming ? this.frameCount+1 : this.frameCount;
      this.shiftInfo = {start: this.frameCount, endFrame: end};
    }
    if (this.shifted && scroll.vertical) {
      var tv = this.columnTiming && this.columnTiming[this.frameCount];
      this.shiftInfo = {start: this.frameCount, endFrame: tv && tv.ends && tv.ends.end ? tv.ends.end.frame : this.frameCount};
      // ★ the redraw ends with its own RTI ($393E): no enemy loop in its frame at all
    }
  }
  // ★ measured (M4, VICE): a shift frame has no enemy loop at all — the shift runs past the next
  // raster-48 handler, which nests into it and skips the loop ($0DCB), and the end of the shift
  // has no loop after it either (`$36A6` RTI): no loop while a shift runs
  var shiftNext = !this.columnTiming && !scroll.vertical && this.shiftInfo && this.frameCount === this.shiftInfo.start+1;
  // ★ $0DD0: with the raster-202 handler of the frame before still running ($0B5F) no loop either (measured: `noLoop`)
  var noLoop = this.columnTiming && this.columnTiming[this.frameCount] && this.columnTiming[this.frameCount].noLoop;
  if (!this.shifted && !scroll.shift && !redrawBusy && !shiftNext && !noLoop) {
    if (r[0x024C]) { this.enemies.bossFrame(); }
    else {
      // ★ measured: band 5 nested into the loop (`timing.json`: the PC, the X register and `$CD`) —
      // the loop goes on from there with the state machine's work in the slots
      var tl = this.columnTiming && this.columnTiming[this.frameCount] && this.columnTiming[this.frameCount].loop;
      var nest = tl ? {pc: tl.pc, x: tl.x !== undefined ? tl.x : tl.slot, slot: tl.slot} : null;
      var self = this;
      this.enemies.loop(nest, function () { self.band5Nested(); });
    }
  }
  // ★ the main loop gets no pass in a frame whose raster-48 handler returns into a running shift
  // whose RTI is not in this frame (level 3's redraw is done within its frame)
  // (★ level 3: a redraw reaching into the next frame has the same effect — its RTI comes there)
  this.shiftedLast = (this.shifted && !scroll.vertical) || (active && this.shiftInfo && this.shiftInfo.endFrame !== this.frameCount)
    || (this.shifted && scroll.vertical && this.shiftInfo && this.shiftInfo.endFrame > this.frameCount);
  this.syncScroll();
}; // irq48

/**
 * ★ Band 5 of the chain (`$114C`, raster 141 — or straight from raster 48
 * when `$0235` skips the bands): the spawner and the state machine of the
 * enemies, unless the game is paused. The boss's own chain (`$024C`) never
 * gets here; its step runs from the end of its rows (`$57AF`).
 */
Ship.prototype.band5 = function () {
  var r = this.ram;
  if (this.bossChain) { this.advanceShift('tail'); this.enemies.bossTail(); return; }
  if (r[0x024E]) { return; }
  if (r[0x4FA8] === 0x60) { return; }                     // ★ the harness patch of M2/M3: no waves ($4FA8 = RTS)
  // (★ band 5 nests into a running column shift, whose map pointer moves only at its end — the
  // spawner then still sees the column before: the pointer is the pending column's)
  this.enemies.spawner();
}; // band5

/**
 * Band 5 as it comes in the frame — after the enemy loop, or nested in it
 * (`Enemies.loop`): the shift brought to where it stood, then the handler.
 * ★ The slots as the bands may still find them at raster 214: the state
 * machine of band 5 often runs past it (measured), so the handler there
 * copies what the enemy loop left (`matchenemies`).
 */
Ship.prototype.band5Nested = function () {
  var self = this, t = this.columnTiming && this.columnTiming[this.frameCount];
  this.band5Done = true;
  if (this.rules) { this.rules.clearBefore('band5'); }   // (READY's clear in progress: up to where it stood)
  this.groupAfterLoop = this.enemies.group(0);
  if (!this.ram[0x024C]) { this.advanceShift('band5'); }   // (the boss's chain has no band 5: nothing nests there)
  // ★ the raster-202 handler inside band 5 or the boss's step (measured): run where the original's came
  this.enemies.irqNest = t ? (t.irq202InBand5 || t.irq202InBoss || null) : null;
  this.enemies.irqYielded = !this.enemies.irqNest;
  this.enemies.irqOnNest = function () { self.irq202Nested(); };
  this.band5();
  if (this.enemies.irqNest && !this.enemies.irqYielded) { this.irq202Nested(); }   // (the point was not reached: right after)
  this.enemies.irqNest = null;
}; // band5Nested

/** The raster-202 handler as it comes in the frame — after band 5, or nested in it. */
Ship.prototype.irq202Nested = function () {
  if (this.irq202Done) { return; }
  this.irq202Done = true;
  if (this.rules) { this.rules.clearBefore('irq202'); }
  this.advanceShift('irq202');
  this.irq202();
}; // irq202Nested

/**
 * ★ `$08C1`: the entry of the main loop — the lives drawn (`$08D3`) — and
 * the loop run until it blocks. After the init it happens before the first
 * raster-48 hit only when there is time for it (★ measured: 630 cycles are
 * enough, 138 are not — `matchship`); after a restart or a level it comes
 * where the init's code ended (`GameRules`: the measured layout).
 */
Ship.prototype.mainLoopEnter = function () {
  var r = this.ram;
  this.livesPanel(r[0x2819] ? r[0x281E] : r[0x281D]);
  this.loop.entered = true;
  this.loop.at = 'top';
  this.mainLoopPoll(false);
}; // mainLoopEnter
Ship.prototype.mainLoopPass = Ship.prototype.mainLoopEnter;   // (the name of M3/M4)

/**
 * ★ The main loop `$08D6`-`$0975` run until it blocks, wherever a handler
 * returns to it. One player (`$2820` = 0): `$0B5D` = 1 → READY (`$08EF`);
 * else `$0232` ≠ 0 → the wait of 20 ticks (`$0949`: the playfield colours
 * `$021E`/`$021F` while `$0233`, a tick per raster-48 handler — the first
 * one free when `$0977` is still set from play), then `$0232` ← 0 and, with
 * `$0310` set, the level-end sequence (`$0941` → `$0978` → `$09C5`).
 * ★ `$0310` is the main loop's "next level" flag **and** the fifth field of
 * enemy bullet 3 (`$030D` + 3): `$1425` clears it, a bullet sets it — a
 * death with it set goes to the next level instead of READY (the
 * original's bug, measured in `tools/tracerules.py` level 1 `c`).
 * @param {boolean} late - After the raster-202 handler (the entry of READY
 *        then misses the vertical blank: one more frame of the chain).
 */
Ship.prototype.mainLoopPoll = function (late) {
  var r = this.ram, L = this.loop;
  if (!L.entered) { this.mainLoopEnter(); return; }
  for (;;) {
    if (L.at === 'top') {
      var b5d = r[0x0B5D];
      if (L.raceSkip) { b5d = 0; L.raceSkip = false; }
      if (b5d === 2) { throw new Error('two players: switched off in this version ($82FB, $5ED9)'); }
      if (b5d === 1) {                                    // $08EB -> $08EF: READY, a life lost
        L.at = 'ready';
        this.ready = true;
        if (this.rules) { this.rules.beginReady(0, 'restart', late); }
        return;
      }
      if (r[0x0232] === 0) { return; }                    // $0937: idle until a handler changes something
      L.at = 'wait'; L.y = 0;                             // $0949
    }
    if (L.at === 'wait') {
      if (!r[0x0977]) { return; }                         // $094B: the next tick
      if (r[0x0233]) { r[0x021E] = this.level.bgColors[0]; r[0x021F] = this.level.bgColors[1]; }   // $0950
      L.y++;
      if (L.y !== 20) { r[0x0977] = 0; continue; }        // $0969
      r[0x0232] = 0;                                      // $0970
      L.at = 'top';
      if (r[0x0310]) {                                    // $0941 -> $0978 -> $09C5
        L.at = 'off';
        this.sequenceBegun = true;
        if (this.rules) { this.rules.beginSequence(); }
        return;
      }
      continue;                                           // $08D6
    }
    return;                                               // 'ready' / 'off': the loop is elsewhere
  }
}; // mainLoopPoll

/** ★ `$0DE6`: the raster-202 handler — bits, score, 1UP, the game step, the ship or its death, the level's hook. */
Ship.prototype.irq202 = function () {
  var r = this.ram, scroll = this.scroll;
  // ★ inside a running shift ($0225) the handler skips the music, the bits, the score and the game
  // step (`advanceShift` brought the shift to where it stood at this handler)
  var inShift = !this.shiftGameStep;
  // ★ $0E41-$0E46: the music — before the re-entry test of $0B5F, skipped only inside a shift (M6)
  if (!inShift) { this.musicPlay('irq202'); }
  if (this.irqOuter) {                                    // $0E49: the handler of the frame before still runs
    this.irqOuter = false;
    r[0x0B5F] = 0;
    this.syncScroll();
    return;
  }
  r[0x0B5F] = 1;                                          // $0E4E: inside the handler (stays when it never ends)
  // $0E0B-$0E21: the VIC for the panel — the colours, the set, 40 columns without a scroll
  var v = this.vic;
  v[0x21] = 0; v[0x22] = 0x0F; v[0x23] = 0x0B; v[0x18] = 0x32; v[0x16] = 0x18;
  if (!inShift) {
    this.bitsIntoSprite();
    this.printScore();
    this.blinkOneUp();
  }
  if (!r[0x024E]) {
    if (!r[0x0232] && !inShift) { this.gameStep(); }
    var wasOver = this.gameOver;
    if (r[0x0E6A] === 0x28) { this.shipStep(); } else { this.deathAnim(); }
    if (this.gameOver && !wasOver) {                      // ★ $32AB: JMP tapeEnd — the handler never gets past it
      if (this.rules) { this.rules.tapeEnd(); }
      this.syncScroll();
      return;
    }
    if (r[0x0232] && !r[0x0233]) {                        // $0E6B: a life lost — the main loop goes to READY
      r[0x0B5D] = 1;
      if (r[0x2820]) { r[0x0B5D]++; }
      // ★ the race (§13): the loop polls $0B5D and $0232 in 21 cycles a turn; this handler interrupted
      // it either before LDA $0B5D (READY at once) or after it (A = 0: the 20-tick wait first, 19
      // frames). Measured 13 : 17 in 30 deaths. The matcher sets the measured outcome, the game flips
      // a seeded coin (`GameRules.raceWait`).
      if (this.loop.at === 'top' && this.rules) { this.loop.raceSkip = this.rules.raceWait(); }
    }
    scroll.hook();
    this.enemies.levelCode.hook();
  }
  // ★ $0E85: fire ends the original's pause; $0E96: F7 starts it, not while $0232 (the live keys: the
  // harness does not hook these reads, its port is idle)
  if (r[0x024E] && !(this.joystick & 0x10)) { r[0x024E] = 0; }
  if (this.f7 && !r[0x0232]) { r[0x024E] = 1; }
  if (!this.hookEnded) { r[0x0B5F] = 0; }
  this.syncScroll();
}; // irq202

/** The scroll's counters mirrored where the original keeps them (for the comparison). */
Ship.prototype.syncScroll = function () {
  var r = this.ram, s = this.scroll.state();
  r[0x0201] = s.pointer & 0xFF; r[0x0202] = s.pointer >> 8;
  r[0x020C] = s.fine; r[0x020B] = s.fineY; r[0x0221] = s.running; r[0x0225] = 0;
  r[0x64] = s.reg64;
  r[0x36A8] = s.counter;
  if (s.v) {
    r[0x3AD6] = s.v.colTick; r[0x3AD7] = s.v.phase; r[0x3AD8] = s.v.idxB; r[0x3AD9] = s.v.redraw;
    r[0x3ADA] = s.v.rowPtr & 0xFF; r[0x3ADB] = s.v.rowPtr >> 8;
    r[0x3ADC] = s.v.cntA; r[0x3ADD] = s.v.tickA; r[0x3ADE] = s.v.repA; r[0x3ADF] = s.v.dirA;
    r[0x3AE0] = s.v.cntB; r[0x3AE1] = s.v.tickB; r[0x3AE2] = s.v.repB; r[0x3AE3] = s.v.dirB;
  }
}; // syncScroll

/**
 * ★ A new game in level `level` — `$0818` (the loader's levelStart without
 * the copies of `$1794`: the score and the state pages zeroed, `$0200` the
 * level, `$0310` = 0), `$27E1` (the players' state from `$27F1`, the lives
 * from the title `$8062` = 3), `$1192`, `$13EA` (the VIC), then the level's
 * init `$088A` (`levelInit`), which ends in READY. The scroll is built there.
 * @param {Object} level - The level's entry of `data/levels.json`.
 * @param {Uint8Array} panelScreen - Rows 19-24 of the screen as `$17BF` leaves them (240 cells).
 * @param {Uint8Array} panelColor - Their colours.
 */
Ship.prototype.init = function (level, panelScreen, panelColor) {
  var r = this.ram, v = this.vic, i;
  this.scroll.screen.set(panelScreen, 760);
  this.scroll.color.set(panelColor, 760);
  r[0x0200] = level.index; r[0x0310] = 0;
  for (i = 0; i < 20; i++) { r[0x2805+i] = r[0x27F1+i]; }
  r[0x2819] = 0;
  r[0x281D] = 3; r[0x281E] = 3;
  this.clearPlayfield();
  v[0x11] = 0; v[0x20] = 0; v[0x21] = 0; v[0x18] = 0x30; v[0x16] = 0x18; v[0x22] = 0x0F; v[0x23] = 0x0B;
  v[0x15] = 0xFF; v[0x1C] = 0xFF;
  for (i = 0; i <= 0x10; i++) { v[i] = 0; }
  this.high.fill(0);
  // ★ the panel's set at $C800 belongs to the core ($9D53 of side A's M, copied by $17D3), so it is in
  // the high memory of the machine from the boot on: level 1's hook `$940A` reads its glyphs $46-$56
  // ($CA30-$CAB7) as the template the star glyphs fill up bit by bit (the shapes behind the second
  // part of the level — without the set they stayed black)
  if (this.charsetsData && this.charsetsData.panel) {
    this.high.set(Uint8Array.from(this.charsetsData.panel.bytes), 0xC800-0xA000);
    this.highDirty = true;
  }
  this.ready = false; this.gameOver = false; this.levelOver = false; this.hookEnded = false;
  this.shiftInfo = null; this.shiftedLast = false; this.frameCount = 0; this.scroll.shift = null;
  this.levelInit(level);
}; // init

/**
 * ★ `$088A`: a level begins — after the first load (`$085F`) or the next
 * one (`$0A9C`): the level's state `$14FF`, the core's tables `$15F0`, the
 * level's own init `$161B`, the map `$162F`, the music, `$D011`, and READY
 * (`$0B6C` with `$2820`) — without the chain (the IRQs are off); after its
 * fire `$08B2`: `$0B5D` ← 0, `$1425`, `$15DB`, the first screen and the main
 * loop (`GameRules`, the init layout).
 * @param {Object} level - The level's entry of `data/levels.json`.
 */
Ship.prototype.levelInit = function (level) {
  var r = this.ram;
  this.level = level;
  this.levelIndex = level.index;
  this.charFlags = Uint8Array.from(level.charFlags);
  this.loadLevelFiles(level);
  this.scroll.loadLevel(level);                           // the files' tables (the map of $162F comes with them: nothing reads it before)
  this.levelState();
  this.coreTables();
  this.levelInitCode();
  this.musicStop();
  r[0x0B5E] = 3;
  this.music(3, 0);
  this.vic[0x11] = 0x1B;
  this.loop = {at: 'top', y: 0, entered: false, raceSkip: false};
  this.ready = false; this.levelOver = false; this.hookEnded = false;
  if (this.rules) { this.rules.beginReady(r[0x2820], 'start', null); }
}; // levelInit

/**
 * ★ The level's three files of the tape: `M` at `$6370` and `G` at `$86AC`
 * into `ram` (`data/enemies.json`), `S` at `$E000` into the high memory
 * (`data/sprites.json`) — what the turbo loader leaves (`$0A9C`); the sets
 * of `G` and `S` the picture takes from `data/charsets.json`.
 * @param {Object} level - The level's entry.
 */
Ship.prototype.loadLevelFiles = function (level) {
  // ★ the sets ride in the files too: `G` begins with the upper set ($86AC, 1 536 B — `$11FA` copies it to
  // $C000), `S` with the lower one ($E000, as long as the file is: a short S keeps the glyphs before it)
  if (this.charsetsData && this.charsetsData.levels && this.charsetsData.levels[level.index]) {
    var sets = this.charsetsData.levels[level.index];
    this.ram.set(Uint8Array.from(sets.upper.bytes).subarray(0, 0x600), 0x86AC);
    var inFile = sets.lowerInFile === undefined ? 0x800 : Math.min(0x800, sets.lowerInFile);
    this.high.set(Uint8Array.from(sets.lower.bytes).subarray(0, inFile), 0xE000-0xA000);
    this.highDirty = true;
  }
  if (this.enemiesData) {
    var lv = this.enemiesData.levels[level.index];
    this.ram.set(lv.m.bytes, parseInt(lv.m.addr.slice(1), 16));
    this.ram.set(lv.g.bytes, parseInt(lv.g.addr.slice(1), 16));
  }
  // ★ M6: the player's variables and the song of `M` ($637F-$7ABF) — the tape's bytes, so the player
  // starts the level as the original's does (`$63BF`/`$63C1` = $FF: nothing requested)
  if (this.musicData && this.musicData.levels && this.musicData.levels[level.index]) {
    var mu = this.musicData.levels[level.index];
    this.ram.set(mu.bytes, parseInt(mu.addr.slice(1), 16));
  }
  if (this.spritesData && this.spritesData.levels && this.spritesData.levels[level.index]) {
    var lsp = this.spritesData.levels[level.index], blocks = lsp.blocks || [];
    for (var b = 0; b < blocks.length; b++) { this.high.set(blocks[b].bytes, parseInt(blocks[b].addr.slice(1), 16)-0xA000); }
    this.highDirty = true;
  }
}; // loadLevelFiles

/**
 * ★ `$14FF`: the level's state before a start or a restart — the weapons,
 * the slots, `$020C`-`$0263` and `$02A8`-`$02FF` zeroed, the map pointer at
 * `$9A27`, the fine scroll, the bands' rasters, the wave pointer from
 * `$7AD2`, `$0232`/`$0233` up, the scroll running, the BEAM meter.
 */
Ship.prototype.levelState = function () {
  var r = this.ram, x;
  r[0x0B5D] = 0; r[0x0977] = 0; r[0x0222] = 0;
  for (x = 0; x < 6; x++) {
    r[0x242F+x] = 0; r[0x3ED5+x] = 0; r[0x40AA+x] = 0; r[0x4791+x] = 0; r[0x4C4F+x] = 0; r[0x4EAC+x] = 0; r[0x3385+x] = 0;
    r[0x044C+x] = 0; r[0x0451+x] = 0; r[0x0456+x] = 0;
  }
  for (x = 0; x <= 0x57; x++) { r[0x020C+x] = 0; r[0x02A8+x] = 0; r[0x7A+x] = 0; }
  if (!r[0x0310]) { r[0x1FF0] = 0xD3; }
  r[0x0201] = 0x27; r[0x0202] = 0x9A;
  r[0x023A] = 0x4F; r[0x023B] = 0x64; r[0x023C] = 0x67; r[0x023D] = 0x77; r[0x023E] = 0x8C; r[0x023F] = 0x8F;
  r[0x64] = 0x30; r[0x021D] = 3; r[0x020C] = 7; r[0x020B] = 0x1B; r[0x23] = 0xFF;
  r[0x0E69] = 0x21; r[0x0E6A] = 0x28;
  r[0x7A] = r[0x7AD2]; r[0x7B] = r[0x7AD3];
  r[0x0239] = 3; r[0x024A] = 0x10; r[0x024B] = 0x10;
  r[0x0232] = (r[0x0232]+1) & 0xFF; r[0x0233] = (r[0x0233]+1) & 0xFF;
  r[0x0221] = 1; r[0x0777] = 0;
  for (x = 0; x <= 0x15; x++) { this.sw(0xCF58+x, 0x1A); }
  // the scroll's mirror of $0201/$0202, $020C, $020B, $0221, $0225 and $64
  var s = this.scroll;
  s.pointer = 0x9A27; s.fine = 7; s.fineY = 0x1B; s.running = 1; s.busy = 0; s.shift = null; s.reg64 = 0x30;
  this.shiftInfo = null; this.shiftedLast = false;
}; // levelState

/** ★ `$15F0`: the core's tables by the level — the end pointer, the chain's hook, the hook of `$2068`. */
Ship.prototype.coreTables = function () {
  var r = this.ram, lv = this.level;
  var end = lv.end ? parseInt(lv.end.slice(1), 16) : 0;
  r[0x36A9] = end & 0xFF; r[0x36AA] = end >> 8;
  this.scroll.end = end;
  var hook = lv.irqHook ? parseInt(lv.irqHook.slice(1), 16) : 0x17FA;
  r[0x0E83] = hook & 0xFF; r[0x0E84] = hook >> 8;
  var h = lv.hook207C ? parseInt(lv.hook207C.slice(1), 16) : 0;
  r[0x2068] = h & 0xFF; r[0x2069] = h >> 8;
}; // coreTables

/**
 * ★ `$161B` → `$139A`: the level's own init, at a start and at every
 * restart. Level 1 (`$1224`): the star glyphs cleared (`$FD40`-`$FF3F`,
 * `$AF`-`$BF` of both sets) and, before the checkpoint, the six star seeds
 * reset and their bits set, then the tail of `$9531`; level 2 (`$12A7`):
 * the colour table back to `$8CAC`, `$134C` ← 0; level 3 (`$12BB`): the
 * window's buffer built once (`$134C`) and its state `$1321`; level 4
 * (`$134D`): glyphs `$B3`-`$BF` cleared, the star seeds and bits. The
 * operands of the step (`$0DC8`), the panel raster (`$1152`) and the colour
 * table (`$3685`) are the scroll's by level.
 */
Ship.prototype.levelInitCode = function () {
  var r = this.ram, v = this.vic, s = this.scroll, x;
  switch (this.levelIndex) {
    case 0:
      s.reg64 = 0x38; r[0x64] = 0x38; r[0x0A] = 2; r[0x0C] = 0x1C; r[0x0B] = 0;
      v[0x1C] = 0xFF; v[0x1D] = 0;
      this.high.fill(0, 0xFD40-0xA000, 0xFF40-0xA000);
      for (x = 0; x < 0x88; x++) { r[0x8C24+x] = 0; this.high[0xE578-0xA000+x] = 0; }
      this.highDirty = true;
      if (!(r[0x0202] === 0x9B || r[0x0201] >= 0xD3)) {
        for (x = 0; x < 6; x++) { r[0x94CA+x] = r[0x94C4+x]; r[0x94BE+x] = r[0x94B8+x]; }
        r[0x8C3C] = r[0x8C5E] = r[0x8C77] = r[0x8C48] = r[0x8C59] = r[0x8C6B] = 0x80;
        this.hw(0xE590, 0x80); this.hw(0xE5B2, 0x80); this.hw(0xE5CB, 0x80); this.hw(0xE59C, 0x80); this.hw(0xE5AD, 0x80); this.hw(0xE5BF, 0x80);
      }
      this.enemies.levelCode.tailRedraw1();
      break;
    case 1:
      s.reg64 = 0x30; r[0x64] = 0x30;
      s.colorTable.set(this.level.charColors);
      if (s.colorSwitch) { s.colorSwitch.done = false; }
      r[0x134C] = 0;
      break;
    case 2:
      if (!r[0x134C]) { s.initVerticalBuffer(this.level.vertical); r[0x134C] = 1; }
      s.resetVerticalState(this.level.vertical);
      break;
    case 3:
      s.colorTable.set(this.level.charColors);
      s.reg64 = 0x30; r[0x64] = 0x30;
      for (x = 0; x < 0x68; x++) { r[0x8C44+x] = 0; }
      for (x = 0; x < 6; x++) { r[0x91E7+x] = r[0x91E1+x]; r[0x91DB+x] = r[0x91D5+x]; }
      r[0x8C5C] = r[0x8C7E] = r[0x8C97] = r[0x8C68] = r[0x8C79] = r[0x8C8B] = 0x80;
      break;
  }
}; // levelInitCode

/**
 * The state of the running original (`tools/traceship.py` init dump) instead
 * of a fresh game: every variable, the hooks' script, the screen, the sprites.
 * @param {Uint8Array} ram - 64 KB, the RAM under the ROMs.
 * @param {Uint8Array} io - $D000-$DFFF as the I/O page.
 * @param {Object} level - The level's entry of `data/levels.json`.
 */
Ship.prototype.load = function (ram, io, level) {
  this.level = level;
  this.levelIndex = level.index;
  this.charFlags = Uint8Array.from(level.charFlags);
  this.ram.set(ram.subarray(0, 0xA000));
  this.high.set(ram.subarray(0xA000, 0x10000));
  this.spriteRAM.set(ram.subarray(0xD000, 0xE000));
  this.vic.set(io.subarray(0, 0x2F));
  this.glyphDD.set(ram.subarray(0xC6E8, 0xC6F0));
  this.scroll.screen.set(ram.subarray(0xCC00, 0xD000));
  for (var i = 0; i < 1000; i++) { this.scroll.color[i] = io[0x800+i] & 15; }
  this.script = this.ram.subarray(0x6090);
  this.seed = this.ram[0x6004] | this.ram[0x6005] << 8;
  this.loop = {at: 'top', y: 0, entered: false, raceSkip: false};   // the first pass (`mainLoopEnter`) is the caller's: it depends on the raster of the init
  this.ready = false; this.gameOver = false; this.levelOver = false; this.hookEnded = false;
  this.shiftInfo = null; this.shiftedLast = false; this.frameCount = 0; this.scroll.shift = null;
}; // load

if (typeof self !== 'undefined') { self.Ship = Ship; }
if (typeof module !== 'undefined' && module.exports) { module.exports = Ship; }
