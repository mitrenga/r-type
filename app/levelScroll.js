// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The level as the original keeps it in memory and scrolls it — its code,
 * not a description of it (`sources/docs/disasm_notes.md` §7-§10,
 * `data/levels.json`).
 *
 * ★ **The map** is 19 rows of 512 columns at `$9A00` (row stride `$200`),
 * built once by `$162F` from the level's map script: placements of
 * **blocks** (width, height, cells), repeated across and down, a zero
 * cell leaving the map alone. `$11A2` then copies 40 columns into the
 * screen RAM `$CC00` and gives every cell the colour the level's table
 * `$8CAC` has for its character.
 *
 * ★ **The step** `$34FB` runs once a frame from the interrupt chain: every
 * second frame the fine scroll `$020C` goes down by one, and past zero it
 * is 7 again and the 19 rows of screen and colour RAM move left by a
 * column (`$3519`) while `$3641` draws column 38 from the map at the map
 * pointer `$0201/$0202`, which moves on; at the level's end pointer the
 * scroll stops (`$0221` = 0). That is one pixel every two frames and a
 * column every sixteen (§5).
 *
 * ★ **Level 3** (index 2) has a step of its own, `$3702`: a 19 × 39 window
 * over a 130-wide buffer, moved by two scripts from the core — A by a
 * column and the fine X, B by a row and the fine Y (`$020B`) — and
 * redrawn whole (`$3848`) with colour 9 whenever it moved. The enemies'
 * positions it adjusts on the way (`$3A29`…) come with M4.
 *
 * Measured by `tools/matchlevels.mjs` against the memory of the running
 * original at many scroll positions in all eight levels.
 *
 * @constructor
 */
function LevelScroll() {
  /** $9A00-$B3FF: 19 × 512 for the map, or 26 pages for level 3's buffer */
  this.map = new Uint8Array(LevelScroll.MAP_BYTES);
  /** $CC00-$CFFF: rows 0-18 the level, 19-24 the panel, $CFF8 the sprite pointers */
  this.screen = new Uint8Array(1024);
  /** $D800-$DBE7, low nibbles */
  this.color = new Uint8Array(1024);
  /** M3: called after a column shift (`$361E`, the ship moves its weapons), and per tick of level 3's window */
  this.onShift = null;
  this.onShiftV = null;
  /** $8CAC: the colour of each character */
  this.colorTable = new Uint8Array(256);
  /** $0201/$0202 */
  this.pointer = LevelScroll.START;
  /** $020C */
  this.fine = 7;
  /** $36A8 */
  this.counter = 1;
  /** $0221 */
  this.running = 1;
  /** $0225 */
  this.busy = 0;
  /** $36A9/$36AA */
  this.end = 0;
  /** $020B: level 3 counts it as a whole byte from $1B — the low bits go to $D011 ($0F52) */
  this.fineY = 0x1B;
  /** ★ 0 = the horizontal step $34FB, 1 = the vertical step $3702 */
  this.vertical = false;
  /** level 3: $3AD6-$3AE3 and the scripts */
  this.v = null;
  /** the shift is the caller's to advance (`Ship`, M4): `copyTo`, `newColumnPointer`, `drawColumnRows` while `pendingColumn` */
  this.deferColumn = false;
  this.pendingColumn = false;
  /** the running shift: `{loop, col, copyDone, pointerDone, rowsDrawn, source}` */
  this.shift = null;
  /** ★ level 2: its hook $943B swaps the colour table and the upper set at one column */
  this.colorSwitch = null;
  /** $64: the $D018 of the upper playfield ($0D0C), $30 unless a hook changes it */
  this.reg64 = 0x30;
  this.level = null;
} // LevelScroll

LevelScroll.MAP_BASE = 0x9A00;
LevelScroll.MAP_BYTES = 0x2600;        // $9A00-$BFFF: 19 rows of $200; level 3 clears the first 26 pages of it
LevelScroll.MAP_ROWS = 19;
LevelScroll.MAP_STRIDE = 0x200;
LevelScroll.START = 0x9A27;            // $1544
LevelScroll.ROWS = 19;
LevelScroll.NEW_COLUMN = 38;           // $366D: $CC26
LevelScroll.V_STRIDE = 0x82;           // level 3: 130 columns a row
LevelScroll.V_WINDOW = 0xD9;           // $384D: LDA (row),X with X from $D9 — 39 cells from row + $D9
LevelScroll.V_PHASES = 0x19;           // $370A

/**
 * The level is in: the map is built as `$162F` builds it and the first
 * screen as `$11A2` draws it.
 * @param {Object} level - One entry of `data/levels.json`.
 * @param {Object} [state] - Counters to start from instead of the fresh
 *        ones (`pointer`, `fine`, `counter`, `running`, `fineY`, `v`) —
 *        the measuring tool gives the original's.
 */
LevelScroll.prototype.init = function (level, state) {
  this.loadLevel(level);
  this.screen.fill(0);
  this.color.fill(0);
  this.pointer = LevelScroll.START;
  this.fine = 7;                       // $1591
  this.counter = 2;                    // $36A8 as the core carries it ($36A7: 19, 2)
  this.running = 1;                    // $15C6
  this.busy = 0;
  this.fineY = 0x1B;                   // $1596: $020B <- $1B; level 3's first tick up wraps it to 0 ($37DF: CMP #8 on the whole byte)
  if (this.vertical) {
    this.initVertical(level.vertical);
  }
  if (state) {
    if (state.pointer !== undefined) { this.pointer = state.pointer; }
    if (state.fine !== undefined) { this.fine = state.fine; }
    if (state.counter !== undefined) { this.counter = state.counter; }
    if (state.running !== undefined) { this.running = state.running; }
    if (state.fineY !== undefined) { this.fineY = state.fineY; }
    if (state.v && this.v) { for (var k in state.v) { this.v[k] = state.v[k]; } }
  }
  this.firstScreen();
}; // init

/**
 * ★ What a level's files bring and `$162F` builds — the colour table of
 * `G` (`$8CAC`), the end pointer and the hooks of the core's tables, the
 * map from the script (level 3's buffer is its own init's, `$12BB`) — and
 * nothing else: the screen, the colour RAM and the counters are the main
 * loop's (`$1192`, `$14FF`), so a level loaded after another keeps its panel.
 * @param {Object} level - One entry of `data/levels.json`.
 */
LevelScroll.prototype.loadLevel = function (level) {
  this.level = level;
  this.map.fill(0);
  this.colorTable.set(level.charColors);
  this.end = level.end ? parseInt(level.end.slice(1), 16) : 0;
  this.reg64 = level.reg64 || 0x30;
  this.colorSwitch = level.colorSwitch ? {pointer: parseInt(level.colorSwitch.pointer.slice(1), 16),
    colorTable: Uint8Array.from(level.colorSwitch.colorTable), reg64: level.colorSwitch.reg64, done: false,
    tick: level.colorSwitch.counter.initial, reload: level.colorSwitch.counter.reload} : null;
  this.vertical = !!level.vertical;
  this.v = null;
  if (!this.vertical) {
    this.unpack(level);
  }
}; // loadLevel

/**
 * ★ `$162F`-`$1793`: the map from the script and the blocks.
 * @param {Object} level - With `script.records` and `blocks`.
 */
LevelScroll.prototype.unpack = function (level) {
  var blocks = {};
  for (var b = 0; b < level.blocks.length; b++) { blocks[level.blocks[b].block] = level.blocks[b]; }
  var records = level.script.records;
  var map = this.map;
  for (var r = 0; r < records.length; r++) {
    var rec = records[r];
    var block = blocks[rec[0]];
    var x = rec[1], row = rec[2], nx = rec[3], ny = rec[4];
    var w = block.width, h = block.height, cells = block.cells;
    var xhi = row & 0x80 ? 1 : 0;        // $16B9: bit 7 of the row adds a page = 256 columns
    var page = (row & 0x7F)*2+xhi;       // $16C7: the page of the row, stride $200
    var stop = false;
    for (var ry = 0; ry < ny && !stop; ry++) {
      var src = 0;                       // $176E: the block from its start again
      for (var yy = 0; yy < h; yy++) {
        var olo = x, ohi = xhi, pos = page*0x100+x, reps = nx;
        for (;;) {
          for (var i = 0; i < w; i++) {
            if (ohi && olo+i > 0xFF) { break; }      // $16F8: past column 511
            var v = cells[src+i];
            if (v) { map[pos+i] = v; }
          }
          pos += w; olo += w;
          if (olo > 0xFF) { olo &= 0xFF; ohi++; }
          if (ohi === 2) { break; }                  // $172C
          if (--reps === 0) { break; }                // $1730
        }
        src += w;
        page += 2;
        if (page+0x9A >= 0xC0) { stop = true; break; } // $1765: past row 18
      }
    }
  }
}; // unpack

/**
 * ★ `$12BB`/`$1321`: level 3's buffer — 26 pages cleared, the 23 × 79 map
 * copied to `$9EBA` with a stride of 130 — and its counters.
 * @param {Object} vert - `level.vertical`.
 */
LevelScroll.prototype.initVertical = function (vert) {
  this.initVerticalBuffer(vert);
  this.v = {
    phase: 0, idxB: 0, redraw: 0,                     // $3AD7, $3AD8, $3AD9
    rowPtr: parseInt(vert.window.start.slice(1), 16), // $3ADA/$3ADB
    cntA: 1, tickA: 1, repA: 1, dirA: 0,              // $3ADC-$3ADF
    cntB: 1, tickB: 1, repB: 1, dirB: 0,              // $3AE0-$3AE3
    colTick: 0x10,                                    // $3AD6
    color: vert.window.color,
    A: vert.scripts.A, B: vert.scripts.B
  };
}; // initVertical

/** ★ `$12CF`: the 26 pages from `$9A00` cleared and the 23 × 79 buffer copied from `$8E6C` to `$9EBA` (once: `$134C`). */
LevelScroll.prototype.initVerticalBuffer = function (vert) {
  this.map.fill(0);
  var dst = parseInt(vert.dst.slice(1), 16)-LevelScroll.MAP_BASE;
  for (var r = 0; r < vert.rows; r++) {
    this.map.set(vert.map[r], dst+r*vert.stride);
  }
}; // initVerticalBuffer

/**
 * ★ `$1321`: the window's state at a start or a restart of level 3 —
 * `$3AD7`-`$3AD9` ← 0, the counters of both scripts ← 1, the row pointer
 * `$9E3B`; the column tick `$3AD6` and the directions keep their values.
 */
LevelScroll.prototype.resetVerticalState = function (vert) {
  if (!this.v) { this.initVertical(vert || this.level.vertical); }
  var v = this.v;
  v.phase = 0; v.idxB = 0; v.redraw = 0;
  v.cntA = 1; v.tickA = 1; v.repA = 1;
  v.cntB = 1; v.tickB = 1; v.repB = 1;
  v.rowPtr = 0x9E3B;
}; // resetVerticalState

/**
 * ★ `$11A2`: the first screen — level 3 clears it (`$1192`), the others
 * copy 40 columns from pointer − 39 with the colours of the table, cell by
 * cell in rows (`$11CD`: the screen byte, then its colour). The chain's
 * handlers nest into it (M5: some 27 000 cycles after the set copy of
 * `$11FA`), so it can be drawn in parts: cells `[from, to)`, `colourTo`
 * when the last cell's colour is still to come.
 * @param {number} [from] - The first cell (0-759).
 * @param {number} [to] - One past the last cell written.
 * @param {boolean} [noColour] - The last cell without its colour yet.
 */
LevelScroll.prototype.firstScreen = function (from, to, noColour) {
  if (this.vertical) {
    // ★ $11AA: level 3 clears rows 0-18 instead ($1192) — READY's text tail (columns 24-26 of rows
    // 7-8, past what $0C2E clears) goes with it; the window is drawn by the step's redraw
    if (!from) { this.screen.fill(0, 0, 760); }
    return;
  }
  var src = this.pointer-0x27-LevelScroll.MAP_BASE;
  var a = from || 0, b = to === undefined ? 760 : to;
  for (var cell = a; cell < b; cell++) {
    var row = (cell/40) | 0, col = cell%40;
    var ch = this.map[row*LevelScroll.MAP_STRIDE+src+col];
    this.screen[cell] = ch;
    if (noColour && cell === b-1) { break; }
    this.color[cell] = this.colorTable[ch] & 15;   // the colour RAM keeps four bits
  }
}; // firstScreen

/**
 * One frame of the scroll — what the interrupt chain does at `$0DBA` when
 * the level runs and the game is not paused.
 */
LevelScroll.prototype.step = function () {
  this.stepScroll();
  this.hook();
}; // step

/**
 * The scroll step alone (`$0DBA` → `$34FB` / `$3702`), without the level's hook.
 * @returns {boolean} true when the screen was shifted by a column (level 3:
 *          redrawn) — the shift outlasts the frame and the game step is skipped (`$0225`).
 */
LevelScroll.prototype.stepScroll = function () {
  if (!this.running) { return false; }
  return this.vertical ? this.stepVertical() : this.stepHorizontal();
}; // stepScroll

/**
 * ★ The level's hook of the interrupt chain (`$13BA`, called at `$0E82`,
 * raster 202 — after the step) as far as it touches the scroll: level 2's
 * `$943B` counts `$95D4` down every frame, at zero animates glyphs (M3),
 * otherwise, with the map pointer at `$9B4A`, swaps the colour table of
 * the new columns for `$937B` and puts the lower set on top (`$64`).
 */
LevelScroll.prototype.hook = function () {
  var sw = this.colorSwitch;
  if (!sw || !this.running) { return; }
  if (--sw.tick === 0) { sw.tick = sw.reload; return; }
  if (!sw.done && this.pointer === sw.pointer) {
    this.colorTable.set(sw.colorTable);
    this.reg64 = sw.reg64;
    sw.done = true;
  }
}; // hook

/** ★ `$34FB`-`$36A6`. */
LevelScroll.prototype.stepHorizontal = function () {
  if (--this.counter !== 0) { return false; }
  this.counter = 2;                                   // $3503
  this.fine--;
  if (this.fine >= 0) { return false; }               // $350B: BPL
  this.fine &= 7;                                     // $3510: 7
  this.busy++;
  // ★ The shift is ~16 000 cycles of work: five loops copy 1, 2, 4, 7 and 5 rows column by
  // column ($3519-$361D), then the weapons move ($361E), the map pointer moves and the new column
  // is drawn row by row ($3641), and the handlers of the chain nest into all of it (band 5 with the
  // state machine, the raster-202 handler) — in this frame and the next. `Ship.frame` advances
  // the shift to where the original's stood at each of them (measured, M4); M2's and M3's tools
  // take it whole at once.
  this.beginShift();
  if (this.deferColumn) { return true; }
  this.copyTo(LevelScroll.COPY_LOOPS.length-1, 39);
  this.newColumnPointer();
  this.drawColumnRows(LevelScroll.ROWS);
  return true;
}; // stepHorizontal

/** ★ the rows of the five copy loops of `$3519` */
LevelScroll.COPY_LOOPS = [[0], [1, 2], [3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18]];

/** A column shift started: nothing copied yet. */
LevelScroll.prototype.beginShift = function () {
  this.shift = {loop: 0, col: 0, row: 0, copyDone: false, weaponsDone: false, pointerDone: false, rowsDrawn: 0};
  this.pendingColumn = true;
}; // beginShift

/**
 * ★ `$3519`-`$361D` up to a point: the copy of the rows of loops before
 * `loop` whole, of loop `loop`'s rows the columns below `col`, and of
 * column `col` its first `rows` rows — from the live screen, left to
 * right, as the original does (a cell a handler wrote in between moves
 * with the rest; ★ a handler nesting between two rows' stores of a column
 * sees it half copied — the ground probe reads it so).
 * @param {number} loop - 0-4.
 * @param {number} col - 0-39 (39: the loop is done).
 * @param {number} [rows=0] - The rows of column `col` already stored.
 */
LevelScroll.prototype.copyTo = function (loop, col, rows) {
  var sh = this.shift;
  if (!sh || sh.copyDone) { return; }
  if (rows === undefined) { rows = 0; }
  var screen = this.screen, color = this.color, loops = LevelScroll.COPY_LOOPS;
  var at, i;
  while (sh.loop < loop || (sh.loop === loop && (sh.col < col || (sh.col === col && sh.row < rows)))) {
    var lrows = loops[sh.loop], to = sh.loop < loop ? 39 : col;
    if (sh.row) {                                       // the rest of a column half copied
      for (i = sh.row; i < lrows.length; i++) { at = lrows[i]*40+sh.col; screen[at] = screen[at+1]; color[at] = color[at+1]; }
      sh.row = 0; sh.col++;
    }
    for (var c = sh.col; c < to; c++) {
      for (i = 0; i < lrows.length; i++) {
        at = lrows[i]*40+c;
        screen[at] = screen[at+1];
        color[at] = color[at+1];
      }
    }
    sh.col = Math.max(sh.col, to);
    if (sh.loop === loop && sh.col === col && col < 39) {
      for (i = sh.row; i < Math.min(rows, lrows.length); i++) { at = lrows[i]*40+col; screen[at] = screen[at+1]; color[at] = color[at+1]; }
      sh.row = Math.min(rows, lrows.length);
      if (sh.row >= lrows.length) { sh.row = 0; sh.col++; }
    }
    if (sh.col >= 39) { sh.col = 0; sh.row = 0; sh.loop++; }
    if (sh.loop >= loops.length) { sh.copyDone = true; break; }
  }
  if (loop >= loops.length-1 && col >= 39) { sh.copyDone = true; }
  // ★ $3616: the copy is done — the player's step, unless the raster-202 handler is running ($0B5F;
  // `Ship` decides), because that handler skipped the music of the shift's frame ($0E41) (M6)
  if (sh.copyDone && this.onCopyEnd) { this.onCopyEnd(); }
}; // copyTo

/** ★ `$361E`-`$366C`: the weapons moved with the terrain, the map pointer on (`$0221` off at the end). */
LevelScroll.prototype.newColumnPointer = function () {
  var sh = this.shift;
  if (!sh || sh.pointerDone) { return; }
  this.moveWeapons();
  sh.source = this.pointer;                           // $3646
  this.pointer = (this.pointer+1) & 0xFFFF;
  if (this.pointer === this.end) { this.running = 0; } // $3658
  sh.pointerDone = true;
}; // newColumnPointer

/** ★ `$361E`-`$3638`: after the copy, the weapons and the enemies' bullets moved with the terrain (before the pointer). */
LevelScroll.prototype.moveWeapons = function () {
  var sh = this.shift;
  if (!sh || sh.weaponsDone) { return; }
  this.copyTo(LevelScroll.COPY_LOOPS.length-1, 39);
  if (this.onShift) { this.onShift(); }               // $361E-$3633
  sh.weaponsDone = true;
}; // moveWeapons

/**
 * ★ `$367F`: the new column's rows below `rows` drawn from the map at the
 * old pointer, with the colour of each character; at 19 the shift is over.
 * @param {number} rows - 0-19.
 */
LevelScroll.prototype.drawColumnRows = function (rows) {
  var sh = this.shift;
  if (!sh) { return; }
  this.newColumnPointer();
  var screen = this.screen, color = this.color, map = this.map, index = sh.source-LevelScroll.MAP_BASE;
  for (var row = sh.rowsDrawn; row < rows && row < LevelScroll.ROWS; row++) {
    var ch = map[row*LevelScroll.MAP_STRIDE+index];
    screen[row*40+LevelScroll.NEW_COLUMN] = ch;
    color[row*40+LevelScroll.NEW_COLUMN] = this.colorTable[ch] & 15;
  }
  sh.rowsDrawn = Math.max(sh.rowsDrawn, Math.min(rows, LevelScroll.ROWS));
  if (sh.rowsDrawn >= LevelScroll.ROWS) {
    this.busy--;
    this.pendingColumn = false;
    this.shift = null;
  }
}; // drawColumnRows

/** The copy part of the shift finished (the five loops). */
LevelScroll.prototype.finishCopy = function () {
  this.copyTo(LevelScroll.COPY_LOOPS.length-1, 39);
}; // finishCopy

/** The whole rest of a pending shift at once. */
LevelScroll.prototype.finishShift = function () {
  this.drawColumnRows(LevelScroll.ROWS);
}; // finishShift

/** ★ `$3702`-`$3943`: level 3. */
LevelScroll.prototype.stepVertical = function () {
  var v = this.v;
  if (this.busy || v.phase === LevelScroll.V_PHASES) { return false; }
  var tick = this.onShiftV || function () {};
  // $3711: script A
  if (--v.tickA === 0) {
    if (--v.repA === 0) {                             // $371A
      var x = v.phase;
      if (x === 0) {                                  // $3722
        v.colTick = 0x10;
        this.pointer = LevelScroll.START;
      }
      v.cntA = v.tickA = v.A.count[x];                // $3733
      v.repA = v.A.reload[x];
      v.dirA = v.A.dir[x];
      v.phase++;
    } else {                                          // $374E
      v.tickA = v.cntA;
      if (!(v.dirA & 0x80)) {
        if (v.dirA === 0) {                           // $375B: left
          tick('left');                               // $3A29
          this.fine++;
          if (this.fine >= 8) {
            this.fine = 0;
            v.rowPtr = (v.rowPtr-1) & 0xFFFF;         // $376D
            tick('leftShift');                        // $4F58
            v.redraw++;
          }
        } else {                                      // $3783: right
          tick('right');                              // $3A49
          this.fine--;
          if (this.fine < 0) {
            this.fine = 7;
            v.rowPtr = (v.rowPtr+1) & 0xFFFF;
            tick('rightShift');                       // $4F6C
            v.redraw++;
          }
        }
      }
    }
  }
  // $37A1: script B
  if (--v.tickB === 0) {
    if (--v.repB === 0) {                             // $37A9
      var y = v.idxB;
      v.cntB = v.tickB = v.B.count[y];                // $37B1
      v.repB = v.B.reload[y];
      v.dirB = v.B.dir[y];
      v.idxB++;
    } else {                                          // $37CC
      v.tickB = v.cntB;
      if (!(v.dirB & 0x80)) {
        if (v.dirB === 0) {                           // $37D9: up
          tick('up');                                 // $3A9F
          this.fineY++;
          if (this.fineY >= 8) {
            this.fineY = 0;
            v.rowPtr = (v.rowPtr-LevelScroll.V_STRIDE) & 0xFFFF;
            tick('upShift');                          // $4F80
            v.redraw++;
          }
        } else {                                      // $3807: down
          tick('down');                               // $3A68
          this.fineY--;
          if (this.fineY < 0) {
            this.fineY = 7;
            v.rowPtr = (v.rowPtr+LevelScroll.V_STRIDE) & 0xFFFF;
            tick('downShift');                        // $4F94
            v.redraw++;
          }
        }
      }
    }
  }
  // $382E: the map pointer for the waves, a column every 16 frames
  if (--v.colTick === 0) {
    v.colTick = 0x10;
    this.pointer = (this.pointer+1) & 0xFFFF;
  }
  if (!v.redraw) { return false; }                    // $3840
  // $3848: the window, whole, colour 9
  this.busy++;
  var map = this.map, screen = this.screen, color = this.color;
  for (var row = 0; row < LevelScroll.ROWS; row++) {
    var from = (v.rowPtr+row*LevelScroll.V_STRIDE+LevelScroll.V_WINDOW) & 0xFFFF;
    for (var col = 0; col < 39; col++) {
      var a = (from+col-LevelScroll.MAP_BASE) & 0xFFFF;
      screen[row*40+col] = a < map.length ? map[a] : 0;
      color[row*40+col] = v.color;
    }
  }
  this.busy = 0;                                      // $3935: STX with X = 0
  v.redraw = 0;
  if (this.onRedrawEnd) { this.onRedrawEnd(); }         // $393B: the player's step before the redraw's own RTI (M6)
  return true;
}; // stepVertical

/**
 * ★ `$0D0C`: the `$D018` of the upper playfield — `$64` only in level 2
 * (index 1) and only when it is set, `$30` (the level's own set at `$C000`)
 * everywhere else. Level 1 carries `$64` = `$38` from its init and never
 * uses it.
 * @returns {number} `$30` or `$64`.
 */
LevelScroll.prototype.d018 = function () {
  return (this.level && this.level.index === 1 && this.reg64) ? this.reg64 : 0x30;
}; // d018

/**
 * The counters, for a snapshot or a check.
 * @returns {Object} `{pointer, fine, counter, running, fineY, v}`.
 */
LevelScroll.prototype.state = function () {
  var v = null;
  if (this.v) {
    v = {};
    for (var k in this.v) { if (k !== 'A' && k !== 'B') { v[k] = this.v[k]; } }
  }
  return {pointer: this.pointer, fine: this.fine, counter: this.counter, running: this.running,
          fineY: this.fineY, reg64: this.reg64, d018: this.d018(), v: v};
}; // state

if (typeof self !== 'undefined') { self.LevelScroll = LevelScroll; }
if (typeof module !== 'undefined' && module.exports) { module.exports = LevelScroll; }
