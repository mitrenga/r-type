const { C64TextRAM } = await import('./svision/js/platform/canvas2D/c64/c64TextRAM.js?ver='+window.srcVersion);
const { C64Charset } = await import('./svision/js/platform/canvas2D/c64/c64Charset.js?ver='+window.srcVersion);
const { C64Sprites } = await import('./svision/js/platform/canvas2D/c64/c64Sprites.js?ver='+window.srcVersion);
// begin code

/**
 * The level's picture out of the data of the original and the worker's
 * memory: the three character sets in their raster bands, the fine scroll
 * and the 38-column window of the playfield, the panel below it.
 *
 * ★ Everything is the original's (`data/levels.json`, `data/charsets.json`,
 * `data/texts.json`, `data/global.json` — `tools/dump*.py`): the worker
 * holds the screen and colour RAM that `app/levelScroll.js` scrolls with
 * the original's code, and this loader puts them into a {@link C64TextRAM}
 * the way the interrupt chain sets the chip (`sources/docs/disasm_notes.md`
 * §2, `vic_state.md`): from the top the upper set (`$D018` `$30`), the
 * scroll `$020C` and 38 columns, the playfield's two shared colours
 * (`$13CA`/`$13D2` per level); from raster 119 the set of `$64` (the band
 * at `$023D`, `$1066`: `$38` = the lower set at `$E000` in level 1 and in
 * level 2 past column `$9B4A`, `$30` = the upper set at `$C000` everywhere
 * else — the inits `$158A`/`$12A9`/`$1368` put `$30` there, only level 1's
 * `$1235` puts `$38`); from raster 202 (198 in level 3) the
 * panel: its set (`$32`), 40 columns, no scroll, colours 15 and 11 — the
 * stores land on line 153, two lines after the interrupt, one after
 * another inside the line, as M1 measured (`data/screen.json`).
 *
 * The panel is composed as `levelStart` leaves it — the template `$8B73`
 * with the colour of each character from `$5F61` — and handed to the worker
 * at the start; from M3 the worker owns it (BEAM meter, score, 1UP, lives
 * are the ship's code) and every frame carries all 25 rows. The sprites are
 * the worker's registers and shapes put into a {@link C64Sprites}: sprites
 * 0-2 (the Force and the two halves of the ship), the shapes under the I/O
 * with the bits drawn into them; sprites 3-7 are the enemies' (M4).
 *
 * ## Deliberately free of DOM
 *
 * The loader takes parsed JSON and typed arrays, so a tool under Node
 * composes the same picture (R-001).
 */
export class LevelLoader {

  /** the raster line of picture line 0 */
  static get FIRST_RASTER() { return 51; }
  /** ★ the band at `$023D` (raster 119) writes `$D018` = `$64` (`$1066`/`$1068`) in cycle 45 */
  static get LOWER_SET_RASTER() { return 119; }
  /** ★ the stores of the panel handler land two lines after its raster (M1: raster 202 → line 204) */
  static get PANEL_DELAY() { return 2; }
  /** ★ the cycle whose store first shows at x 0 (`app/screenLoader.js`, `CYCLE0`) */
  static get CYCLE0() { return 16; }
  /** ★ M1 frame: $D021-$D023 in cycles 3-15, $D018 in cycle 21, $D016 in cycle 27 of line 204 */
  static get PANEL_CYCLES() { return {colors: 3, font: 21, scroll: 27}; }
  /** the playfield's rows */
  static get ROWS() { return 19; }

  /**
   * @param {Object} data - `{levels, charsets, texts, global}`, the parsed
   *        files of `data/`.
   */
  constructor(data) {
    this.id = 'LevelLoader';
    this.data = data;
    this.panelFont = new C64Charset(data.charsets.panel.bytes);
    this.fonts = {};
    /** the panel's screen codes and colours, rows 19-24, as `$17BF` leaves them (the init of the ship adds the rest) */
    this.panel = this.composePanel();
    /** the 16 KB the VIC-II sees, for the sprites: $D000-$DFFF are the shapes */
    this.bank = new Uint8Array(16384);
    if (data.sprites) {
      var blocks = data.sprites.globalBlocks.blocks;
      for (var b = 0; b < blocks.length; b++) {
        this.bank.set(blocks[b].bytes, parseInt(blocks[b].addr.slice(1), 16)-0xC000);
      }
    }
    /** glyph $DD of the upper set as last patched (the yellow laser animates it) */
    this.glyphDD = null;
    /** the worker's $A000-$FFFF as last sent (`high`): the sets the level's code draws into */
    this.high = null;
    this.highFonts = null;
  } // constructor

  /**
   * @param {number} level - 1-8.
   * @returns {Object} The level's entry of `levels.json`.
   */
  level(level) {
    return this.data.levels.levels[level-1];
  } // level

  /**
   * The level's two playfield sets.
   * @param {number} level - 1-8.
   * @returns {{upper: C64Charset, lower: C64Charset}} The sets.
   */
  fontsOf(level, high) {
    // ★ M5: with the worker's memory the sets come from it — the level's glyphs copied to $C000 by
    // $11FA (the stars of levels 1 and 4, level 2's rotation, level 7's end are drawn into them) and
    // the lower set at $E000 as the level's S left it (a short S keeps the glyphs before it)
    if (high) {
      if (!this.highFonts || this.highFonts.high !== high || this.highFonts.level !== level) {
        var sets = this.data.charsets.levels[level-1];
        var upper = Uint8Array.from(sets.upper.bytes);
        upper.set(high.subarray(0x2000, 0x2600), 0);
        var lower = Uint8Array.from(high.subarray(0x4000, 0x4800));
        this.highFonts = {high: high, level: level, upper: new C64Charset(upper), lower: new C64Charset(lower)};
        this.glyphDD = null;
      }
      return this.highFonts;
    }
    if (!this.fonts[level]) {
      var sets = this.data.charsets.levels[level-1];
      var lower = Uint8Array.from(sets.lower.bytes);
      if (sets.lowerInFile < lower.length && level > 1) {
        // ★ a short S leaves the previous level's glyphs in place (level 6)
        lower.set(Uint8Array.from(this.data.charsets.levels[level-2].lower.bytes).subarray(sets.lowerInFile), sets.lowerInFile);
      }
      this.fonts[level] = {upper: new C64Charset(sets.upper.bytes), lower: new C64Charset(lower)};
    }
    return this.fonts[level];
  } // fontsOf

  /**
   * ★ Rows 19-24 as `$17BF` leaves them: the template and its colours. The
   * BEAM meter (`$15D0`) and the lives (`$0CD5`) are written by the ship's
   * init in the worker (`app/ship.js`).
   * @returns {{screen: Uint8Array, color: Uint8Array}} 240 cells each.
   */
  composePanel() {
    var texts = this.data.texts;
    var screen = new Uint8Array(240), color = new Uint8Array(240);
    var tpl = texts.panel.codes, colors = texts.panel.colors.values;
    var from = parseInt(texts.panel.screen.slice(1, 5), 16)-0xCC00-19*40;   // $CF08: row 19, column 8
    for (var i = 0; i < tpl.length; i++) {
      screen[from+i] = tpl[i];
      color[from+i] = (tpl[i] < colors.length ? colors[tpl[i]] : 0) & 15;
    }
    return {screen: screen, color: color};
  } // composePanel

  /**
   * The picture of one frame.
   * @param {number} level - 1-8.
   * @param {Object} frame - From the worker: `screen` and `color` (1000
   *        cells, rows 0-18 the level's), `fine` ($020C), `fineY` ($020B).
   * @returns {{textRAM: C64TextRAM, font: C64Charset}} For the entity.
   */
  compose(level, frame) {
    if (frame.high) { this.high = frame.high; }
    if (frame.mode === 'ready' || frame.mode === 'flat') { return this.composeFlat(level, frame); }
    var lv = this.level(level);
    var fonts = this.fontsOf(level, this.high);
    // ★ the two bands of the playfield read two `$D018`: the top (`$0D0C`, raster 48) is `$30` — the
    // level's own set at $C000 — except in level 2, where it is `$64` when set (`LevelScroll.d018`);
    // the band at raster 119 (`$1066`) writes `$64` itself, in every level. `$64` is `$38` (the lower
    // set at $E000) in level 1 and in level 2 past column `$9B4A`, `$30` in levels 2-8 otherwise —
    // so levels 3-8 draw both bands with the set at $C000, and level 2 switches both at once
    // (before: both $C000, after: both $E000). The frame carries `$64` as `reg64`; a tool may hand
    // the top's `$D018` in `d018` and the band's in `reg64` straight from the recorded stores.
    var reg64 = frame.reg64 === undefined ? 0x38 : frame.reg64;
    var topD018 = frame.d018 !== undefined ? frame.d018 : ((level === 2 && reg64) ? reg64 : 0x30);
    var setOf = function (d018) { return (d018 & 0x0E) === 0x08 ? fonts.lower : fonts.upper; };
    var upper = setOf(topD018), lowerBand = setOf(reg64);
    var screen = new Uint8Array(1000), color = new Uint8Array(1000);
    screen.set(frame.screen.subarray(0, LevelLoader.ROWS*40));
    color.set(frame.color.subarray(0, LevelLoader.ROWS*40));
    // the panel: the worker's rows 19-24 (the ship's code writes the score, the lives, the meter) when
    // the frame carries them, else the template of $17BF (M2's tools)
    if (frame.screen.length >= 1000 && frame.panel !== false) {
      screen.set(frame.screen.subarray(LevelLoader.ROWS*40, 1000), LevelLoader.ROWS*40);
      color.set(frame.color.subarray(LevelLoader.ROWS*40, 1000), LevelLoader.ROWS*40);
    } else {
      screen.set(this.panel.screen, LevelLoader.ROWS*40);
      color.set(this.panel.color, LevelLoader.ROWS*40);
    }
    var text = new C64TextRAM(screen, color);
    text.showCursor(false);
    text.setMulticolor(true);
    var colors = this.data.global.constants.colors.value;
    text.setBackground(colors.d021).setSharedColors(lv.bgColors[0], lv.bgColors[1]).setBorder(colors.d020);
    text.setScrollX(frame.fine & 7).setColumns(38);
    // ★ the splits where the chain's stores land, as `tools/mkscreen.py` recorded them (M1):
    // the set of $64 from line 68 at x 232, the panel's colours, set and $D016 one after
    // another inside line 153 (raster 202 + 2) — the last line of row 18 is still the playfield
    var x = function (cycle) { return Math.max(0, (cycle-LevelLoader.CYCLE0)*8); };
    var panelLine = lv.panelRaster+LevelLoader.PANEL_DELAY-LevelLoader.FIRST_RASTER;
    var cycles = LevelLoader.PANEL_CYCLES;
    text.setSplits([
      {fromLine: 0, fromX: 0, font: upper},
      {fromLine: LevelLoader.LOWER_SET_RASTER-LevelLoader.FIRST_RASTER, fromX: x(45), font: lowerBand},
      {fromLine: panelLine, fromX: x(cycles.colors), background1: colors.panelD022, background2: colors.panelD023},
      {fromLine: panelLine, fromX: x(cycles.font), font: this.panelFont},
      {fromLine: panelLine, fromX: x(cycles.scroll), scrollX: 0, columns: 40}
    ]);
    var sprites = null;
    if (frame.vic) {
      // ★ the registers and shapes as the worker's memory holds them: sprites 0-2 (the Force and the
      // ship), and sprites 3-7 as the chain's bands write them — the multiplexer's three groups of
      // slots, or the boss's rows (M4, `spriteWrites`)
      this.bank.set(frame.sprites, 0x1000);
      if (frame.high) { this.bank.set(frame.high.subarray(0x4000), 0x2000); }   // $E000-$FFFF of the worker's high memory ($A000-$FFFF): the level's sprites, the sprites under the KERNAL
      sprites = new C64Sprites(this.bank);
      var regs = Uint8Array.from(frame.vic);
      var pointers = frame.screen.length >= 1024 ? Uint8Array.from(frame.screen.subarray(1016, 1024)) : new Uint8Array(8);
      sprites.setWrites(this.spriteWrites(frame, regs, pointers));
      sprites.setRegisters(regs);
      sprites.setPointers(pointers);
    }
    return {textRAM: text, font: upper, sprites: sprites};
  } // compose

  /**
   * ★ M5: the screen as READY (`$0B6C`), the level-end sequence (`$0A0C`)
   * and the rewind screen (`$5E7C`) leave the chip: the panel set over the
   * whole screen (`$D018` = `$32`), 40 columns without a scroll, the
   * playfield's shared colours `$0F`/`$0B` — and in READY the text rows 7-8
   * in `$0A`/`$02` between rasters `$42` and `$82` (`readyColors`). Sprites
   * 0-2 as the registers hold them (off in READY, the ship flying to the
   * centre in the sequence); no multiplexer: the chain is off.
   * @param {number} level - 1-8.
   * @param {Object} frame - From the worker (`mode` 'ready' or 'flat').
   * @returns {{textRAM: C64TextRAM, font: C64Charset, sprites: C64Sprites}} For the entity.
   */
  composeFlat(level, frame) {
    var screen = new Uint8Array(1000), color = new Uint8Array(1000);
    screen.set(frame.screen.subarray(0, 1000));
    color.set(frame.color.subarray(0, 1000));
    var text = new C64TextRAM(screen, color);
    text.showCursor(false);
    text.setMulticolor(true);
    var vic = frame.vic || [];
    var colors = this.data.global.constants.colors.value;
    var c1 = vic.length ? vic[0x22] & 15 : colors.panelD022, c2 = vic.length ? vic[0x23] & 15 : colors.panelD023;
    text.setBackground(vic.length ? vic[0x21] & 15 : colors.d021).setSharedColors(c1, c2).setBorder(colors.d020);
    text.setScrollX(0).setColumns(40);
    var splits = [{fromLine: 0, fromX: 0, font: this.panelFont, scrollX: 0, columns: 40}];
    if (frame.mode === 'ready') {
      var r = LevelLoader.READY_COLORS;
      splits.push({fromLine: r.rasters[0]-LevelLoader.FIRST_RASTER, fromX: 0, background1: r.text[0], background2: r.text[1]});
      splits.push({fromLine: r.rasters[1]-LevelLoader.FIRST_RASTER, fromX: 0, background1: r.rest[0], background2: r.rest[1]});
    }
    text.setSplits(splits);
    var sprites = null;
    if (frame.vic) {
      this.bank.set(frame.sprites, 0x1000);
      if (frame.high) { this.bank.set(frame.high.subarray(0x4000), 0x2000); }
      sprites = new C64Sprites(this.bank);
      var regs = Uint8Array.from(frame.vic);
      var pointers = frame.screen.length >= 1024 ? Uint8Array.from(frame.screen.subarray(1016, 1024)) : new Uint8Array(8);
      sprites.setWrites([]);
      sprites.setRegisters(regs);
      sprites.setPointers(pointers);
    }
    return {textRAM: text, font: this.panelFont, sprites: sprites};
  } // composeFlat

  /** ★ READY ($0BFF-$0C1A): the colours of the text rows and of the rest, and the rasters they change at */
  static get READY_COLORS() { return {text: [0x0A, 0x02], rest: [0x0F, 0x0B], rasters: [0x42, 0x82]}; }

  /** ★ the rasters of the bands of the multiplexer ($023A-$023E): Y of group 1, X/pointer/colour of group 1, Y of group 2, X/pointer/colour of group 2 */
  static get BAND_RASTERS() { return [0x4F, 0x64, 0x77, 0x8C]; }

  /**
   * ★ Sprites 3-7 as the interrupt chain writes them (`disasm_notes.md` §2,
   * §12): group 0 of the multiplexer stands in the registers at the top of
   * the frame (Y, pointer and colour from the panel's handler at raster 214,
   * X from the raster-48 handler), group 1 gets its Y at raster `$023A` and
   * X, pointer, colour at `$023B`, group 2 at `$023D` and `$023E`; at raster
   * 202 every X goes to 0 (`$0DE6`). A boss (`$024C`) owns the chain
   * instead: row *n* of 5 sprites gets X, pointer and colour one line
   * before its Y (`$585D`) and the next row's Y eleven lines below
   * (`$57AF`); level 1 expands the rows in X (`$58E2`).
   * @param {Object} frame - The worker's frame (`bands`, `boss`).
   * @param {Uint8Array} regs - $D000-$D02E, patched with group 0 / row 0.
   * @param {Uint8Array} pointers - The eight pointers, patched the same way.
   * @returns {Array<Object>} Writes for {@link C64Sprites#setWrites}.
   */
  spriteWrites(frame, regs, pointers) {
    var writes = [], first = LevelLoader.FIRST_RASTER, i, e;
    var line = function (raster) { return raster-first; };
    var msb = regs[0x10];                                 // $D010 as the chain leaves it, bit by bit
    var setMsb = function (at, k, high) {
      msb = (msb & ~(1 << (3+k))) | ((high ? 1 : 0) << (3+k));
      writes.push({line: at, register: 0xD010, value: msb});
    };
    var put = function (at, group, withY, withX) {
      for (var k = 0; k < 5; k++) {
        var s = group[k];
        if (!s) { continue; }
        if (withY) { writes.push({line: at, register: 0xD007+2*k, value: s.y}); }
        if (withX) {
          writes.push({line: at, register: 0xD006+2*k, value: s.x & 0xFF});
          setMsb(at, k, s.x >> 8);
          writes.push({line: at, pointer: 3+k, value: s.pointer});
          writes.push({line: at, register: 0xD02A+k, value: s.color & 15});
        }
      }
    };
    if (frame.boss) {
      var rows = frame.boss;
      for (i = 0; i < rows.length; i++) {
        var row = rows[i];
        for (var k = 0; k < 5; k++) {
          e = row.sprites[k];
          if (i === 0) {
            regs[0x07+2*k] = row.y;
            regs[0x06+2*k] = e.x & 0xFF;
            regs[0x10] = (regs[0x10] & ~(1 << (3+k))) | ((e.x >> 8) << (3+k));
            msb = regs[0x10];
            pointers[3+k] = e.pointer;
            regs[0x2A+k] = e.color & 15;
          } else {
            // ★ Measured in VICE at level 1's boss (2026-10-22): the handler of raster Y−1 stores the
            // pointers, X, colours and the expansion bits between cycle 56 of Y−1 and cycle 51 of Y,
            // and the chip still shows the last row of the sprite above (raster Y) whole from the old
            // block, at the old X, in the old colour and mode (VICE's picture: the jaw of level 1's
            // boss ends in place above the tail). So every store of a row counts from raster Y+1 —
            // the Y of the row stays at the raster of its store. One line earlier, the tail (four
            // sprites stacked 21 lines apart) showed a row of the next block at every seam; with X
            // or the mode from Y, the last row of the jaw moved left by the tail's X or lost its
            // multicolour.
            writes.push({line: line(rows[i-1].y+11), register: 0xD007+2*k, value: row.y});
            writes.push({line: line(row.y+1), register: 0xD006+2*k, value: e.x & 0xFF});
            setMsb(line(row.y+1), k, e.x >> 8);
            writes.push({line: line(row.y+1), pointer: 3+k, value: e.pointer});
            writes.push({line: line(row.y+1), register: 0xD02A+k, value: e.color & 15});
          }
        }
        if (row.expand !== undefined) {
          writes.push({line: i === 0 ? 0 : line(row.y+1), register: 0xD01D, value: row.expand});
          writes.push({line: i === 0 ? 0 : line(row.y+1), register: 0xD01C, value: (~row.expand) & 0xFF});
        }
      }
      return writes;
    }
    if (!frame.bands) { return writes; }
    var g0 = frame.bands[0];
    for (i = 0; i < 5; i++) {
      e = g0[i];
      regs[0x06+2*i] = e ? e.x & 0xFF : 0;
      regs[0x10] = (regs[0x10] & ~(1 << (3+i))) | ((e ? e.x >> 8 : 0) << (3+i));
      if (e) { regs[0x07+2*i] = e.y; pointers[3+i] = e.pointer; regs[0x2A+i] = e.color & 15; }
    }
    msb = regs[0x10];
    var r = LevelLoader.BAND_RASTERS;
    put(line(r[0]), frame.bands[1], true, false);
    put(line(r[1]), frame.bands[1], false, true);
    put(line(r[2]), frame.bands[2], true, false);
    put(line(r[3]), frame.bands[2], false, true);
    for (i = 0; i < 5; i++) { writes.push({line: line(202), register: 0xD006+2*i, value: 0}); }
    writes.push({line: line(202), register: 0xD010, value: msb & 7});
    return writes;
  } // spriteWrites

  /**
   * ★ Glyph $DD of the shared set, animated by the yellow laser (`$4854` →
   * `$C6E8`): the upper set carries the shared glyphs, so it is the one patched.
   * @param {C64Charset} font - The level's upper set.
   * @param {Uint8Array|Array<number>} rows - The eight bytes.
   */
  patchGlyphDD(font, rows) {
    var same = this.glyphDD !== null;
    for (var i = 0; same && i < 8; i++) { if (this.glyphDD[i] !== rows[i]) { same = false; } }
    if (same) { return; }
    this.glyphDD = Uint8Array.from(rows);
    font.setGlyph(0xDD, Array.from(rows), 0);
  } // patchGlyphDD

} // LevelLoader
