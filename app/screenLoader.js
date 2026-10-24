const { C64TextRAM } = await import('./svision/js/platform/canvas2D/c64/c64TextRAM.js?ver='+window.srcVersion);
const { C64Charset } = await import('./svision/js/platform/canvas2D/c64/c64Charset.js?ver='+window.srcVersion);
const { C64Sprites } = await import('./svision/js/platform/canvas2D/c64/c64Sprites.js?ver='+window.srcVersion);
// begin code

/**
 * One frame of the original, as `tools/mkscreen.py` recorded it, put into
 * the library's model of the machine: a {@link C64TextRAM} with the raster
 * splits of the frame and a {@link C64Sprites} with the multiplexer's stores.
 * Nothing here is drawn or made up — the screen codes, the colour RAM, the
 * three character sets, the sprite shapes and every register come from the
 * running original.
 *
 * ★ **A frame is not a memory dump.** R-Type changes the VIC-II while the
 * beam runs (`sources/docs/disasm_notes.md` §2): the fine scroll and the
 * 38-column window for the playfield and back for the panel, a character set
 * per band, the colours, and sprites 3-7 five times over. It also shifts the
 * screen by a column **while the beam is on it** (§5). So the recording has
 * memory at the top of the frame plus every store made during it with its
 * raster line and cycle, and this loader turns that into what the library
 * takes:
 * - a row of screen codes and colours is what memory held when the chip read
 *   it — the row's first line (the bad line), from cycle {@link
 *   ScreenLoader.BADLINE_CYCLE};
 * - a store to $D016, $D018 or $D020-$D023 becomes a split from its line and
 *   pixel (the chip takes them at once, mid-line), x = (cycle -
 *   `cycle0`)*8;
 * - a store to a sprite register or pointer becomes a sprite store from the
 *   next line ({@link ScreenLoader.SPRITE_CYCLE}).
 *
 * ★ Measured by `tools/matchscreen.mjs`, which composes the frame with this
 * very loader and compares it with VICE's picture of it pixel by pixel.
 *
 * ## Deliberately free of DOM
 *
 * The loader takes the parsed JSON, not a URL, so a tool under Node builds
 * the same frame the browser builds (R-001). Fetching is the caller's job.
 */
export class ScreenLoader {

  /** the raster line of picture line 0 */
  static get FIRST_RASTER() { return 51; }
  /** ★ from this cycle of a bad line on, the chip has the row's codes */
  static get BADLINE_CYCLE() { return 14; }
  /**
   * The cycle whose store first shows at x 0. ★ Not constrained by the
   * frames measured so far: 4 to 24 all give 0 differences on the 22 frames
   * of level 1 (`tools/matchscreen.mjs`), because R-Type's stores that
   * change the picture fall where the pixels do not tell.
   */
  static get CYCLE0() { return 16; }
  /**
   * From this cycle a sprite store counts from the next line. ★ Measured on
   * the 22 frames: any value from 0 to 50 gives 0 differences, 51 and above
   * give 290 (frame 4000, a store to $D00E in cycle 50 must not show on its
   * own line). 0 says what the chip does — the pointer and the start of a
   * sprite are fetched at the end of the line before.
   */
  static get SPRITE_CYCLE() { return 0; }

  /**
   * @param {Object} data - The parsed `data/screen.json` of `tools/mkscreen.py`.
   */
  constructor(data) {
    this.id = 'ScreenLoader';
    this.data = data;
    /** the 16 KB the VIC-II sees, at the top of the frame */
    this.bank = ScreenLoader.bytes(data.bank);
    /** $D000-$D02E at the top of the frame */
    this.vic = Uint8Array.from(data.vic);
    /** character sets by their offset in the bank */
    this.fonts = new Map();
  } // constructor

  /**
   * Base64 to bytes, in the browser and under Node alike.
   * @param {string} text - Base64.
   * @returns {Uint8Array} The bytes.
   */
  static bytes(text) {
    var raw = atob(text);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  } // bytes

  /**
   * Where $D018 puts the screen, as an offset in the bank.
   * @param {number} value - $D018.
   * @returns {number} 0-$3C00.
   */
  static screenOf(value) {
    return ((value >> 4) & 15)*0x400;
  } // screenOf

  /**
   * The character set $D018 points at, out of the bank.
   * @param {number} value - $D018.
   * @returns {C64Charset} The set.
   */
  fontOf(value) {
    var at = ((value >> 1) & 7)*0x800;
    if (!this.fonts.has(at)) {
      this.fonts.set(at, new C64Charset(this.bank.subarray(at, at+0x800)));
    }
    return this.fonts.get(at);
  } // fontOf

  /** @returns {number} $D020 at the top of the frame. */
  border() {
    return this.vic[0x20] & 15;
  } // border

  /** @returns {number} $D021 at the top of the frame. */
  background() {
    return this.vic[0x21] & 15;
  } // background

  /**
   * The frame in the library's model.
   * @param {Object} [options] - `cycle0` and `spriteCycle` to try other
   *        conversions of cycles (the measuring tool fits them).
   * @returns {{textRAM: C64TextRAM, font: C64Charset, sprites: C64Sprites}}
   */
  build(options) {
    var opts = options || {};
    var cycle0 = opts.cycle0 === undefined ? ScreenLoader.CYCLE0 : opts.cycle0;
    var spriteCycle = opts.spriteCycle === undefined ? ScreenLoader.SPRITE_CYCLE : opts.spriteCycle;
    var vic = this.vic;
    var writes = this.data.writes || [];
    var scr = ScreenLoader.screenOf(vic[0x18]);
    var scrAddr = 0xC000+scr;

    // the rows as the chip read them
    var screen = new Uint8Array(C64TextRAM.CELLS);
    var color = new Uint8Array(C64TextRAM.CELLS);
    var mem = Uint8Array.from(this.bank.subarray(scr, scr+C64TextRAM.CELLS));
    var col = Uint8Array.from(this.data.colorRAM);
    var w = 0;
    for (var row = 0; row < C64TextRAM.ROWS; row++) {
      var raster = ScreenLoader.FIRST_RASTER+row*8;
      for (; w < writes.length; w++) {
        var store = writes[w];
        if (store.line > raster || (store.line === raster && store.cycle >= ScreenLoader.BADLINE_CYCLE)) {
          break;
        }
        var a = parseInt(store.addr, 16);
        if (a >= scrAddr && a < scrAddr+C64TextRAM.CELLS) {
          mem[a-scrAddr] = store.value;
        } else if (a >= 0xD800 && a < 0xD800+C64TextRAM.CELLS) {
          col[a-0xD800] = store.value & 15;
        }
      }
      screen.set(mem.subarray(row*40, row*40+40), row*40);
      color.set(col.subarray(row*40, row*40+40), row*40);
    }

    var text = new C64TextRAM(screen, color);
    text.showCursor(false);
    text.setMulticolor(!!(vic[0x16] & 0x10));
    text.setBackground(vic[0x21]).setSharedColors(vic[0x22], vic[0x23]).setBorder(vic[0x20]);
    text.setScrollX(vic[0x16] & 7).setColumns(vic[0x16] & 8 ? 40 : 38);

    var splits = [];
    var spriteWrites = [];
    for (var i = 0; i < writes.length; i++) {
      var s = writes[i];
      var addr = parseInt(s.addr, 16);
      if ((addr >= scrAddr && addr < scrAddr+0x3F8) || (addr >= 0xD800 && addr < 0xDC00)) {
        continue;                         // screen and colour RAM: taken per row above
      }
      var spriteLine = s.line-ScreenLoader.FIRST_RASTER+(s.cycle >= spriteCycle ? 1 : 0);
      if (addr >= scrAddr+0x3F8 && addr < scrAddr+0x400) {
        spriteWrites.push({line: spriteLine, pointer: addr-scrAddr-0x3F8, value: s.value});
        continue;
      }
      var reg = addr-0xD000;
      if (reg < 0 || reg > 0x2E) {
        continue;
      }
      var line = s.line-ScreenLoader.FIRST_RASTER;
      var x = (s.cycle-cycle0)*8;
      if (x >= C64TextRAM.WIDTH) { line++; x = 0; }
      if (x < 0) { x = 0; }
      var split = {fromLine: line, fromX: x};
      if (reg === 0x16) { split.scrollX = s.value & 7; split.columns = s.value & 8 ? 40 : 38; }
      else if (reg === 0x18) { split.font = this.fontOf(s.value); }
      else if (reg === 0x20) { split.border = s.value; }
      else if (reg === 0x21) { split.background = s.value; }
      else if (reg === 0x22) { split.background1 = s.value; }
      else if (reg === 0x23) { split.background2 = s.value; }
      else if (reg <= 0x10 || reg === 0x15 || reg === 0x17 || reg === 0x1B || reg === 0x1C
               || reg === 0x1D || reg >= 0x25) {
        spriteWrites.push({line: spriteLine, register: reg, value: s.value});
        continue;
      } else {
        continue;                         // $D011, $D012, $D019: not the picture of this window
      }
      if (line < C64TextRAM.HEIGHT) {
        splits.push(split);
      }
    }
    text.setSplits(splits);

    var sprites = new C64Sprites(this.bank);
    sprites.setRegisters(vic);
    sprites.setPointers(this.bank.subarray(scr+0x3F8, scr+0x400));
    sprites.setWrites(spriteWrites);
    return {textRAM: text, font: this.fontOf(vic[0x18]), sprites: sprites};
  } // build

} // ScreenLoader
