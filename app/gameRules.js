// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The rules around a level — the original's main loop `$08C1` and what it
 * does between levels, routine by routine (`sources/docs/disasm_notes.md`
 * §13, `sources/asm/main.asm`):
 *
 * - **READY** `$0B6C`: rows 0-18 cleared, the text of the panel set in rows
 *   7-8 (A = 0 a life lost, 1 a level with 1UP/2UP — never in this version,
 *   `$80` GAME OVER), the whole screen in the panel set (`$D018` = `$32`),
 *   the sprites off, the chain off; an iteration a frame: the two colours
 *   of the text rows between rasters `$42` and `$82`, the music, the
 *   countdown `$0B63` of 50, then **fire** (`$0C27`); after it the sprite
 *   registers and the text cleared and the chain armed at raster `$CA`;
 * - the **restart** after a life (`$08F5`): from the checkpoint (`$0B64`
 *   by level: the map pointer's low byte on page `$9A`, the wave table of
 *   `$7AD4`) or from the start (`$14FF`), the ship (`$1425`), the core's
 *   tables, the level's init, the first screen (`$11A2`) — some 45 000
 *   cycles the chain's handlers nest into, measured (`tools/tracerules.py
 *   --timing`, `timing.json` `init`): the screen is drawn in parts around
 *   them, as the column shift is (R-053);
 * - the **level-end sequence** (`$09C5`-`$0A4E`): the playfield cleared, the
 *   panel set over the whole screen, sprites 0-2 flying to the centre
 *   (`$0ADB`) for ★ **400 frames** (`$0B60` = 144 is not reloaded: 144 +
 *   256), then the next level's three files from tape (`$0A9C`) and its
 *   init (`$088A` → READY); after level 8 the ending `E` (`$0200` = `$D3`);
 * - **tapeEnd** (`$5E47`, the last life): GAME OVER as a READY text, then
 *   PLEASE REWIND TAPE / THEN PRESS / F1 TO START (`$5E95`), where the
 *   original waits for F1 and PLAY and loads whatever the tape gives — the
 *   remake stops there (`ZADANI.md` §10) and goes to its hall of fame;
 * - ★ **continue** (the remake's, `ZADANI.md` §10.7 — the original has no
 *   credits): from the rewind screen the score is zeroed, the lives are
 *   three again and the game goes on as after a lost life — READY and the
 *   restart from the checkpoint the death would have gone back to
 *   (`continueGame`).
 *
 * ★ Two things of the original are timing, not rules, and are modelled as
 * measured: the **race** at a death (the loop polls `$0B5D` and `$0232` in
 * 21 cycles a turn; the handler that sets both interrupts it before or
 * after `LDA $0B5D` — READY at once, or the 20-tick wait first: 19 frames;
 * 13 : 17 in 30 deaths), and the **vertical blank** READY waits for after
 * the clear `$1192` (an entry after about line 190 misses it: one more
 * frame of the chain runs). The matcher (`tools/matchrules.mjs`) sets the
 * measured outcome of every death; the game flips a seeded coin.
 *
 * The variables are the original's (`Ship.ram`, `Ship.vic`); this object
 * holds only where the main loop's code stands (`state`) and its locals.
 *
 * @constructor
 * @param {Ship} ship - The ship, whose memory this is.
 */
function GameRules(ship) {
  this.ship = ship;
  this.ram = ship.ram;
  this.vic = ship.vic;
  ship.rules = this;
  /** the eight entries of `data/levels.json` (the next level's files come from the ship's data) */
  this.levels = null;
  /** 'play' | 'ready' | 'restart' | 'sequence' | 'rewind' | 'ending' */
  this.state = 'play';
  /** A of `$0B6C` */
  this.readyText = 0;
  /** after READY: 'restart' (a life lost), 'start' (a level begins), 'rewind' (GAME OVER), 'continue' (the remake's continue after GAME OVER) */
  this.after = null;
  /** iterations of READY done */
  this.readyFrames = 0;
  /** ★ the entry of READY missed the vertical blank: one more frame of the chain before the loop */
  this.readyExtra = false;
  /** READY's clear in progress: iterations of $1192 done, and where it stood at each handler */
  this.clearX = 256;
  this.clearAt = null;
  /** the matcher's measured `clearAt` for the next READY */
  this.readyClearAt = null;
  /** iterations of the level-end sequence done (of 400) */
  this.endFrames = 0;
  /** the events, with the frame (`Ship.frameCount` = the raster-48 handlers) — the matcher compares them */
  this.events = [];
  /** the matcher's answer for the next death's race (true: the wait first), null: the coin */
  this.race = null;
  /** the matcher's measured layout of the next init (`timing.json` `init`), null: the typical one */
  this.layout = null;
  /** the steps of the restart in progress */
  this.steps = null;
  /** the remake adds: the frames of the whole game, for the hall of fame */
  this.gameFrames = 0;
} // GameRules

/** ★ the READY texts: A → [screen address of row 7, row 8, length] (`$0B8B`, `$0B9E`, `$0BB1`) */
GameRules.READY_TEXTS = {0: [0xCD25, 0xCD4D, 14, 0x0C5B, 0x0C69], 0x80: [0xCD1F, 0xCD47, 26, 0x0C77, 0x0C91], 1: [0xCD21, 0xCD49, 17, 0x0CAB, 0x0CBC]};
/** ★ READY: the countdown ($0B70) and its two colour pairs ($0BFF: rows 7-8 from raster $42, $0C13: the rest from $82 — the loader splits the picture) */
GameRules.READY_COUNTDOWN = 0x32;
GameRules.READY_COLORS = [[0x0A, 0x02], [0x0F, 0x0B]];
/** ★ the level-end sequence: the ship's target ($0AE7, $0B47), the counters ($0A20, $0A25) */
GameRules.CENTRE = {x: 0xA0, y: 0x64};
/**
 * ★ Where READY's clear `$1192` stood when the chain's handlers came
 * (measured, `timing.json` `init` phase `ready`): entered from the wait
 * (~line 53) band 5 of the same frame finds X ≈ 200 and the raster-202
 * handler the clear done; entered after the raster-202 handler the next
 * frame's raster-48 handler finds X ≈ 200.
 */
GameRules.READY_CLEAR = {wait: {band5: 200, irq202: 256}, now: {irq48: 200, band5: 256, irq202: 256}};

/**
 * ★ The typical layout of the init after READY's fire — what the chain
 * did while the init and the first screen ran (measured on 32 restarts
 * and 5 level starts, `tools/tracerules.py --timing`, the `init` entries;
 * the matcher takes the recording's own). Entries in order: the handler
 * (`irq48` counts a frame), the bytes of the set copied (`set`) or the
 * cells of the first screen written before it (`cells`), and the main
 * loop's entry with the raster it came at; frame 1 is the one after the
 * fire frame. A **restart** begins with the latched raster-202 handler
 * (32 of 32); level 1's own init (`$1224` with `$9531`) takes a frame
 * more, level 3 only clears (`$1192`) and enters the loop in frame 1; a
 * **level's start** has no latched handler (0 of 5: the VIC's interrupt
 * was off through its READY).
 */
GameRules.INIT_LAYOUTS = {
  restart: {
    0: [{at: 'irq202', frame: 0},
        {at: 'irq48', frame: 1, cells: 0}, {at: 'band5', frame: 1, set: 35}, {at: 'irq202', frame: 1, set: 87},
        {at: 'irq48', frame: 2, set: 183}, {at: 'band5', frame: 2, set: 247}, {at: 'irq202', frame: 2, cells: 66, colour: false},
        {at: 'irq48', frame: 3, cells: 235, colour: false}, {at: 'band5', frame: 3, cells: 351, colour: false}, {at: 'irq202', frame: 3, cells: 434, colour: false},
        {at: 'irq48', frame: 4, cells: 598, colour: false}, {at: 'band5', frame: 4, cells: 711, colour: false}, {at: 'mainLoop', frame: 4, raster: 181}],
    2: [{at: 'irq202', frame: 0},
        {at: 'irq48', frame: 1, set: 229}, {at: 'band5', frame: 1, cells: 0}, {at: 'irq202', frame: 1, cells: 0},
        {at: 'mainLoop', frame: 1, raster: 250}],
    default: [{at: 'irq202', frame: 0},
              {at: 'irq48', frame: 1, set: 216}, {at: 'band5', frame: 1, cells: 45, colour: false}, {at: 'irq202', frame: 1, cells: 123, colour: false},
              {at: 'irq48', frame: 2, cells: 296, colour: false}, {at: 'band5', frame: 2, cells: 409, colour: false}, {at: 'irq202', frame: 2, cells: 474, colour: false},
              {at: 'irq48', frame: 3, cells: 637, colour: false}, {at: 'band5', frame: 3, cells: 724, colour: false}, {at: 'mainLoop', frame: 3, raster: 150}]
  },
  start: [{at: 'irq48', frame: 1, set: 238}, {at: 'band5', frame: 1, cells: 80, colour: false}, {at: 'irq202', frame: 1, cells: 164, colour: false},
          {at: 'irq48', frame: 2, cells: 274, colour: false}, {at: 'band5', frame: 2, cells: 386, colour: false}, {at: 'irq202', frame: 2, cells: 469, colour: false},
          {at: 'irq48', frame: 3, cells: 606, colour: false}, {at: 'band5', frame: 3, cells: 714, colour: false}, {at: 'mainLoop', frame: 3, raster: 170}]
};

/**
 * An event of the rules, at the current frame.
 * @param {string} kind - 'death', 'ready', 'fire', 'restart', 'checkpoint', 'mainLoop', 'levelEnd', 'sequence', 'load', 'levelInit', 'gameOver', 'rewind', 'ending', 'continue'.
 * @param {Object} [extra] - More fields (`a` of READY).
 */
GameRules.prototype.event = function (kind, extra) {
  var e = {kind: kind, frame: this.ship.frameCount};
  if (extra) { for (var k in extra) { e[k] = extra[k]; } }
  this.events.push(e);
  if (this.onEvent) { this.onEvent(e); }
}; // event

/**
 * ★ The race at a death (see above): the measured outcome when the matcher
 * set one, else a seeded coin — never `Math.random()`.
 * @returns {boolean} true: the 20-tick wait comes first.
 */
GameRules.prototype.raceWait = function () {
  if (this.race !== null) { var w = this.race; this.race = null; return w; }
  return (this.ship.rnd() & 1) === 1;
}; // raceWait

// ---------------------------------------------------------------- READY

/**
 * ★ `$0B6C`: READY entered — the playfield cleared, the countdown; the rest
 * waits for the vertical blank (`readyVblank`).
 * @param {number} a - The text: 0, 1 or $80.
 * @param {string} after - What follows the fire.
 * @param {boolean|null} late - After the raster-202 handler (the blank is
 *        missed: one more frame of the chain); null: no chain at all (the
 *        level's init, IRQs off) — the blank part follows at once.
 */
GameRules.prototype.beginReady = function (a, after, late) {
  var s = this.ship, r = this.ram;
  this.event('ready', {a: a});
  // ★ the clear $1192 (~12 000 cycles) runs with the chain on: band 5 of this frame (an entry from the
  // wait, ~line 53) or the raster-48 handler of the next (an entry after the raster-202 handler) nest
  // into it and see it half done — `clearAt` (the matcher: the measured X; else the typical one) says
  // how far it was at each; nothing nests when the chain is off (the level's init, tapeEnd)
  this.clearX = 0;
  this.clearAt = late === null ? null : (this.readyClearAt || GameRules.READY_CLEAR[late ? 'now' : 'wait']);
  this.readyClearAt = null;
  if (late === null) { this.clearTo(256); }
  r[0x0B63] = GameRules.READY_COUNTDOWN;
  this.readyText = a;
  this.after = after;
  this.readyFrames = 0;
  s.loop.at = 'ready';
  s.ready = true;
  s.readyBegun = true;
  this.state = 'ready';
  this.readyExtra = late === true;
  if (late === null) { this.readyVblank(); }
}; // beginReady

/** The clear of READY brought to iteration `x` of `$1192`. */
GameRules.prototype.clearTo = function (x) {
  if (x > this.clearX) { this.ship.clearPlayfield(this.clearX, x); this.clearX = x; }
}; // clearTo

/**
 * A handler of the chain about to run while READY's clear may still be
 * going: the clear brought to where it stood at that handler.
 * @param {string} at - 'irq48', 'band5' or 'irq202'.
 */
GameRules.prototype.clearBefore = function (at) {
  if (this.clearX >= 256 || !this.clearAt) { return; }
  var x = this.clearAt[at];
  this.clearTo(x === undefined ? 256 : x);
}; // clearBefore

/** ★ `$0B7A`-`$0BF7`: after the blank — the panel set over the whole screen, the sprites off, the text, its colour rows. */
GameRules.prototype.readyVblank = function () {
  var s = this.ship, r = this.ram, v = this.vic, x;
  this.clearTo(256);
  v[0x18] = 0x32;
  v[0x15] = 0;
  var t = GameRules.READY_TEXTS[this.readyText] || GameRules.READY_TEXTS[1];
  for (x = 0; x < t[2]; x++) { s.sw(t[0]+x, r[t[3]+x]); s.sw(t[1]+x, r[t[4]+x]); }
  if (this.readyText !== 0 && this.readyText !== 0x80) {      // $0BC2: the 1UP/2UP tail
    var tail = r[0x2819] ? 0x0CD1 : 0x0CCD;
    for (x = 0; x < 2; x++) { s.sw(0xCD35+x, r[tail+x]); s.sw(0xCD5D+x, r[tail+2+x]); }
  }
  for (x = 0; x < 40; x++) { s.cw(0xCD18+x, 0x0F); s.cw(0xCD40+x, 0x0F); }
}; // readyVblank

/**
 * ★ One iteration of the READY loop (`$0BF8`-`$0C2C`), a frame: the text
 * rows in `$0A`/`$02` from raster `$42`, the music, `$0F`/`$0B` from `$82`,
 * the countdown, and — at zero — fire (`$0C27`, the joystick); then `$0C2E`:
 * the sprite registers and the text cleared, the next frame starts the
 * restart (`$0C3E` waits for raster `$30`).
 */
GameRules.prototype.readyFrame = function () {
  var s = this.ship, r = this.ram, v = this.vic;
  v[0x22] = GameRules.READY_COLORS[1][0]; v[0x23] = GameRules.READY_COLORS[1][1];
  s.musicPlay('ready');                                   // $0C09
  this.readyFrames++;
  if (r[0x0B63]) {
    r[0x0B63]--;
    if (r[0x0B63]) { return; }
  }
  var a = s.readJoystick();
  if (a & 0x10) { return; }
  this.event('fire');
  for (var x = 0; x <= 0x10; x++) { v[x] = 0; s.sw(0xCD1F+x, 0); s.sw(0xCD47+x, 0); }
  this.state = 'restart';
  this.steps = null;
}; // readyFrame

// ---------------------------------------------------------------- the restart and the level's start

/**
 * ★ `$08F5`-`$0924`: the restart's code before the first screen — the
 * checkpoint or the start, the level's state, the ship, the tables, the
 * level's init.
 */
GameRules.prototype.restartCode = function () {
  var s = this.ship, r = this.ram;
  var chk = r[0x0B64+r[0x0200]];
  var fromCheckpoint = r[0x0202] !== 0x9A || r[0x0201] >= chk;   // $08F5, $0919
  s.levelState();
  if (fromCheckpoint) {                                   // $08FC
    r[0x0201] = chk; r[0x0202] = 0x9A;
    s.scroll.pointer = 0x9A00 | chk;
    r[0x7A] = r[0x7AD4]; r[0x7B] = r[0x7AD5];
    this.event('checkpoint');
  } else {
    this.event('restart');
  }
  s.shipInit();                                           // $0927
  s.coreTables();
  s.levelInitCode();
}; // restartCode

/** ★ `$08B2`: after a level's READY — `$0B5D` ← 0, the ship, `$15DB`. */
GameRules.prototype.startCode = function () {
  this.ram[0x0B5D] = 0;
  this.ship.shipInit();
}; // startCode

/**
 * The steps of the restart from the layout: the handlers nested into the
 * first screen with the cells drawn before each, the main loop's entry and
 * the rest of its frame. A step is `{run}` or `{frameEnd: true}`.
 * @returns {Array<Object>} The steps.
 */
GameRules.prototype.buildRestart = function () {
  var self = this, s = this.ship, r = this.ram, v = this.vic;
  var steps = [];
  steps.push({run: function () { v[0x18] = 0x30; r[0x0B5D] = (r[0x0B5D]-1) & 0xFF; }});   // $0C45, $0C48
  if (this.after === 'rewind') {
    steps.push({run: function () { self.rewindScreen(); }});
    steps.push({frameEnd: true});
    return steps;
  }
  var typical = this.after === 'start' ? GameRules.INIT_LAYOUTS.start : (GameRules.INIT_LAYOUTS.restart[s.levelIndex] || GameRules.INIT_LAYOUTS.restart.default);
  var layout = this.layout || typical;
  this.layout = null;
  // ★ the remake's continue: the restart's code, but the chain was off through its READY (the rewind screen
  // cleared $D01A), so nothing was latched — the restart's layout without its latched handler (no original
  // to measure: a model, as the typical layouts are)
  if (this.after === 'continue' && layout.length && layout[0].frame === 0) { layout = layout.slice(1); }
  // ★ the raster-202 handler fires at the first CLI: its interrupt was latched during READY (the compare
  // stayed at line 48, nobody acknowledged it) — before $14FF of a restart ($08F4: the ship step is
  // still the death's $31FC), after $15DB of a level's start ($08BD)
  var latched = layout.length && layout[0].frame === 0;
  var latchedStep = {run: function () { s.band5Done = false; s.irq202Done = false; self.nestedHandler('irq202'); }, at: 'irq202'};
  if (this.after === 'restart' || this.after === 'continue') {
    if (latched) { steps.push(latchedStep); }
    steps.push({run: function () { self.restartCode(); }});
  } else {
    steps.push({run: function () { self.startCode(); }});
    if (latched) { steps.push(latchedStep); }
  }
  var cursor = 0, setDone = 0, frame = 0, pending = false;
  // the first screen in parts: the set copy ($11FA) up to `set`, then the cells ($11CD) up to `to`
  var draw = function (set, to, noColour) {
    return function () {
      if (set > setDone) { s.copySet(setDone, set); setDone = set; }
      if (to > cursor || (pending && to === cursor)) {
        // (a cell left without its colour by the segment before gets it now: the byte again, then the colour)
        s.scroll.firstScreen(pending ? cursor-1 : cursor, to, noColour);
        cursor = to;
        pending = !!noColour;
      }
    };
  };
  for (var i = latched ? 1 : 0; i < layout.length; i++) {
    var e = layout[i];
    if (e.frame !== frame) {
      if (frame > 0 && !steps[steps.length-1].frameEnd) { steps.push({frameEnd: true}); }
      frame = e.frame;
    }
    if (e.at === 'mainLoop') {
      steps.push({run: draw(256, 760)});
      steps.push({run: function (raster) { return function () {
        self.event('mainLoop');
        s.mainLoopEnter();
        if (raster < 141 && !s.band5Done) { s.band5Nested(); }
        if (raster < 202 && !s.irq202Done) { s.irq202Nested(); }
        self.state = 'play';
      }; }(e.raster || 0), at: 'mainLoop'});
      steps.push({frameEnd: true});
      break;
    }
    steps.push({run: draw(e.set !== undefined ? e.set : (e.cells ? 256 : 0), e.cells || 0, e.colour === false)});
    steps.push({run: function (at) { return function () { self.nestedHandler(at); }; }(e.at), at: e.at});
    if (e.at === 'irq202') { steps.push({frameEnd: true}); }
  }
  return steps;
}; // buildRestart

/**
 * One of the chain's handlers run inside the init (`$0C3E` armed the chain
 * at raster `$CA`; the raster-48 handler of every next frame counts).
 * @param {string} at - 'irq48', 'band5' or 'irq202'.
 */
GameRules.prototype.nestedHandler = function (at) {
  var s = this.ship;
  if (at === 'irq48') {
    s.frameCount++;
    s.band5Done = false; s.irq202Done = false; s.shiftGameStep = true; s.irqOuter = false;
    s.readyBegun = false; s.sequenceBegun = false;
    s.irq48();
  } else if (at === 'band5') {
    if (!s.band5Done) { s.band5Nested(); }
  } else if (at === 'irq202') {
    if (!s.irq202Done) { s.irq202Nested(); }
  }
}; // nestedHandler

/** A frame of the restart: its steps up to the frame's end. */
GameRules.prototype.restartFrame = function () {
  if (!this.steps) { this.steps = this.buildRestart(); }
  while (this.steps.length) {
    var step = this.steps.shift();
    if (step.frameEnd) { return; }
    step.run();
  }
}; // restartFrame

/** The next step of the restart, for the matcher: what it is and the frame it would count. */
GameRules.prototype.nextStep = function () {
  if (!this.steps) { this.steps = this.buildRestart(); }
  for (var i = 0; i < this.steps.length; i++) {
    if (this.steps[i].at) { return this.steps[i].at; }
  }
  return null;
}; // nextStep

/** The restart advanced to just before its next handler of `at` (the matcher's sampling point). */
GameRules.prototype.runUntil = function (at) {
  if (!this.steps) { this.steps = this.buildRestart(); }
  while (this.steps.length) {
    if (this.steps[0].at === at) { return true; }
    var step = this.steps.shift();
    if (!step.frameEnd) { step.run(); }
  }
  return false;
}; // runUntil

// ---------------------------------------------------------------- the level's end

/**
 * ★ `$09C5`-`$0A2E`: the sequence begins — rows 0-18 cleared, the chain off
 * before raster 196, sprites 0-2 on, the panel set over the whole screen,
 * the counters 144 and 2, the music.
 */
GameRules.prototype.beginSequence = function () {
  var s = this.ship, r = this.ram, v = this.vic;
  this.event('sequence');
  s.clearPlayfield();
  v[0x15] = 7;
  v[0x16] = 0x18; v[0x18] = 0x32; v[0x22] = 0x0F; v[0x23] = 0x0B;
  r[0x0B60] = 0x90; r[0x0B61] = 2;
  s.music(2, 0);
  this.endFrames = 0;
  this.state = 'sequence';
}; // beginSequence

/**
 * ★ One iteration (`$0A31`-`$0A4C`, a frame at raster `$FA`): the music,
 * the ship to the centre, the bits into the sprite, the Force's colour;
 * `$0B60` down, at zero `$0B61` — 400 iterations. Then `$0A4E`: silence, the
 * checkpoints of both players back to the start, the sprites off, the next
 * level from tape or the ending.
 */
GameRules.prototype.sequenceFrame = function () {
  var s = this.ship, r = this.ram, v = this.vic;
  s.musicPlay('sequence');                                // $0A38
  this.shipToCentre();
  s.bitsIntoSprite();
  s.forceColor();
  this.endFrames++;
  r[0x0B60] = (r[0x0B60]-1) & 0xFF;
  if (r[0x0B60]) { return; }
  r[0x0B61] = (r[0x0B61]-1) & 0xFF;
  if (r[0x0B61]) { return; }
  s.musicInit('sequenceEnd');                             // $0A4E
  r[0x280D] = 0x27; r[0x280E] = 0x27; r[0x280F] = 0x9A; r[0x2810] = 0x9A;
  v[0x15] = 0;
  if (r[0x0200] === 0xD3) {                               // $0A7B: the ending E
    this.event('ending');
    this.state = 'ending';
    return;
  }
  this.event('load');                                     // $0A9C
  var next = this.levels ? this.levels[r[0x0200]] : null;
  if (!next) { throw new Error('level '+(r[0x0200]+1)+' is not loaded: the rules need the eight levels'); }
  r[0x281F] = 0;
  this.event('levelInit');
  s.levelInit(next);                                      // $088A → READY
}; // sequenceFrame

/**
 * ★ `$0ADB`: the ship (sprites 1-2, and the Force sprite 0 when attached,
 * `$32` = 1) a pixel a frame towards the centre, the level tilt frames; the
 * high bits of X as the code leaves them (`$0B22`: all but sprite 0's
 * cleared on sprite 1's wrap, `$0B3B`: all but 1-2 on sprite 0's).
 */
GameRules.prototype.shipToCentre = function () {
  var r = this.ram, v = this.vic, scr = this.ship.scroll.screen;
  scr[1017] = 0x44; scr[1018] = 0x45;
  var y = v[3];
  if (y !== GameRules.CENTRE.y) {
    if (y > GameRules.CENTRE.y) {
      v[3]--; v[5]--;
      if (r[0x32] === 1) {
        v[1]--;
        if (v[1] === 0) { v[3]++; v[5]++; v[1]++; }         // $0AFC: BNE not taken — $0AFE runs too
      }
    } else {
      v[3]++; v[5]++;
      if (r[0x32] === 1) { v[1]++; }
    }
  }
  var left = function () {                                // $0B14
    var borrow = v[2] === 0;
    v[2]--; v[4] = v[2];
    if (borrow) { v[0x10] &= 0x01; }
    if (r[0x32] !== 1) { return; }
    borrow = v[0] === 0;
    v[0]--;
    if (borrow) { v[0x10] &= 0x06; }
  };
  if (v[0x10] & 2) { left(); return; }
  var x = v[2];
  if (x === GameRules.CENTRE.x) { return; }
  if (x > GameRules.CENTRE.x) { left(); return; }
  v[2]++; v[4]++;
  if (r[0x32] === 1) { v[0]++; }
}; // shipToCentre

// ---------------------------------------------------------------- the game over

/**
 * ★ `$5E47` (from `$32AB`, inside the raster-202 handler): SEI, the
 * playfield cleared, the sprites off, the lives' first cell blank, the
 * music, and READY with GAME OVER — nothing else runs until its blank
 * (the interrupts are off: no frame is counted).
 */
GameRules.prototype.tapeEnd = function () {
  var s = this.ship, v = this.vic;
  this.event('gameOver');
  s.clearPlayfield();
  v[0x15] = 0;
  s.sw(0xCF49, 0);
  s.music(1);
  s.loop.at = 'off';
  this.beginReady(0x80, 'rewind', null);
}; // tapeEnd

/**
 * ★ `$5E5D`-`$5ED1`: after GAME OVER's fire — the VIC to the panel set, 40
 * columns, the playfield cleared, PLEASE REWIND TAPE / THEN PRESS / F1 TO
 * START in colour 1 (two more rows are loaded and never stored: OR / F3 2
 * PLAYER), the colour of all four rows set. The original then waits for
 * F1 (`$5ED3`) and PLAY; the remake ends the game here.
 */
GameRules.prototype.rewindScreen = function () {
  var s = this.ship, r = this.ram, v = this.vic, x;
  s.sidPoke(0x18, 0, 'tapeEnd');                          // $5E69: the volume off — the one SID write outside the player (M6)
  v[0x18] = 0x32; v[0x11] = 0x1B; v[0x16] = 0x18; v[0x22] = 0x0F; v[0x23] = 0x0B;
  s.clearPlayfield();
  for (x = 0; x < 18; x++) { s.sw(0xCC33+x, r[0x5F0D+x]); s.cw(0xCC33+x, 1); }
  for (x = 0; x < 12; x++) {
    s.sw(0xCC86+x, r[0x5F1F+x]); s.sw(0xCCD6+x, r[0x5F2B+x]);
    s.cw(0xCC86+x, 1); s.cw(0xCCD6+x, 1); s.cw(0xCD26+x, 1); s.cw(0xCD76+x, 1);
  }
  this.event('rewind');
  this.state = 'rewind';
}; // rewindScreen

// ---------------------------------------------------------------- the remake's continue

/**
 * ★ The remake's: where a continue would go on — the checkpoint the next
 * restart would take (`$08F5`, `restartCode`), and whether that is worth
 * offering: not the start of level 1, which a new game gives too (Manic
 * Miner's rule for its continue).
 * @returns {{level: number, checkpoint: boolean, worth: boolean}} The level 1-8, whether from the checkpoint.
 */
GameRules.prototype.continuePoint = function () {
  var r = this.ram, idx = r[0x0200];
  if (idx > 7) { return {level: 8, checkpoint: false, worth: false}; }   // the ending ($D3)
  var chk = r[0x0B64+idx];
  var fromCheckpoint = r[0x0202] !== 0x9A || r[0x0201] >= chk;
  return {level: idx+1, checkpoint: fromCheckpoint, worth: idx > 0 || fromCheckpoint};
}; // continuePoint

/**
 * ★ The remake's continue (`ZADANI.md` §10.7): from the rewind screen, where
 * the original waits for F1 and the tape, the game goes on where a lost life
 * would have taken it — the score zeroed (`$338B`-`$3390`), three lives
 * (`$281D`, as `$5ED3` sets them before the load), the GAME OVER flag down
 * (`$281F`), the level's tune started as a level's init starts it, and
 * READY with the restart from the checkpoint (`restartCode`): the level, its
 * tables and the map pointer are still the game's; the weapons are gone as
 * after any lost life (`$31A2`). Nothing of the original runs here; the
 * restart after READY is the original's `$08F5`.
 * @returns {boolean} False when the game is not at the rewind screen.
 */
GameRules.prototype.continueGame = function () {
  var s = this.ship, r = this.ram, x;
  if (this.state !== 'rewind') { return false; }
  this.event('continue');
  for (x = 0; x < 6; x++) { r[0x338B+x] = 0; r[0x3385+x] = 0; }
  r[0x281D] = 3; r[0x281E] = 3;
  r[0x281F] = 0;
  s.gameOver = false;
  s.livesPanel(r[0x281D]);
  s.printScore();
  s.musicStop();
  r[0x0B5E] = 3;
  s.music(3, 0);
  s.loop = {at: 'top', y: 0, entered: false, raceSkip: false};
  this.steps = null;
  this.beginReady(0, 'continue', null);
  return true;
}; // continueGame

// ---------------------------------------------------------------- the frame

/**
 * One PAL frame of the game, wherever its main loop stands.
 * @returns {string} The state after it.
 */
GameRules.prototype.frame = function () {
  var s = this.ship;
  this.gameFrames++;
  switch (this.state) {
    case 'play':
      s.frame();
      if (this.state === 'ready' && !this.readyExtra) { this.readyVblank(); }
      break;
    case 'ready':
      if (this.readyExtra) {                              // ★ the chain's frame while $0B75 waits for the blank
        this.readyExtra = false;
        s.frame();
        this.readyVblank();
        break;
      }
      this.readyFrame();
      break;
    case 'restart':
      this.restartFrame();
      break;
    case 'sequence':
      this.sequenceFrame();
      break;
    default:
      break;
  }
  return this.state;
}; // frame

/**
 * The picture's mode for the main thread: how the chain would show the
 * screen — 'play' (the bands of the level), 'ready' (the panel set over the
 * whole screen, 40 columns, the text rows in their own colours between the
 * two rasters), 'flat' (the panel set, sprites 0-2: the sequence, the
 * rewind screen).
 * @returns {string} The mode.
 */
GameRules.prototype.mode = function () {
  if (this.state === 'play' || (this.state === 'ready' && this.readyExtra)) { return 'play'; }
  if (this.state === 'ready') { return 'ready'; }
  if (this.state === 'restart') { return this.after === 'rewind' ? 'flat' : 'play'; }
  return 'flat';
}; // mode

if (typeof self !== 'undefined') { self.GameRules = GameRules; }
if (typeof module !== 'undefined' && module.exports) { module.exports = GameRules; }
