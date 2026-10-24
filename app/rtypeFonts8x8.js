const { ZXFonts8x8 } = await import('./svision/js/platform/canvas2D/zx/zxFonts8x8.js?ver='+window.srcVersion);
const { C64ScreenCodes } = await import('./svision/js/platform/canvas2D/c64/c64ScreenCodes.js?ver='+window.srcVersion);
const { C64Charset } = await import('./svision/js/platform/canvas2D/c64/c64Charset.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * ★ The character set of the original's title screen (`data/title.json`,
 * `charset` — `$85CB` shown at `$C000`, the set the logo and PRESS PLAY ON
 * TAPE are drawn with) as a svision 8x8 font, in the shape of ZXFonts8x8 as
 * the siblings do it (Stinger, Pleiades): TextEntity, MenuEntity and the
 * dialogs print with it like with any other font.
 *
 * The set is laid out as the C64's screen codes — A-Z at 1-26, 0-9 at
 * 48-57, the dot, the colon, the quotes, `&`, `*` and `?` where the ROM has
 * them — so one 2 KB set serves both doors: {@link #charset} for a
 * C64TextModeEntity (the about screen's rows) and `getCharData` for the
 * entities. What the title set lacks as text (the comma, the dash, the
 * apostrophe, the exclamation mark, the brackets — 44, 45, 33 are arrows
 * and a bar there, 39 is empty) comes from the character ROM
 * (`app.fonts.c64Fonts8x8`), so a sentence of the about text prints whole.
 * Code 47 is the original's © and prints for '©'. The arrows the settings
 * print for the cursor keys and the block of the remap's cursor are the
 * font's own glyphs ({@link RTypeFonts8x8.EXTRA}), drawn to the letters'
 * seven pixels — neither set has all four. The lower case comes from the
 * ROM's second set: the title set has none, and a player's name shows as
 * typed.
 *
 * The data come with the app's data files: the font starts from what
 * localStorage has, and {@link #build} is called again when `title` arrives
 * (`MainApp.setData`); until then it is the ROM alone.
 */
export class RTypeFonts8x8 extends ZXFonts8x8 {

  /** the screen codes the title set has as text: the rest come from the ROM */
  static get TITLE_CODES() {
    var codes = [34, 38, 42, 46, 47, 58, 63];
    for (var c = 1; c <= 26; c++) { codes.push(c); }
    for (c = 48; c <= 57; c++) { codes.push(c); }
    return codes;
  } // TITLE_CODES

  /** the glyphs beyond the sets: the cursor keys' arrows and the remap's cursor block, 16 hex digits each */
  static get EXTRA() {
    return {chars: '←→↑↓█', hex: '0018307E7E301800' + '00180C7E7E0C1800' + '183C7E1818181800' + '181818187E3C1800' + 'FEFEFEFEFEFEFE00'};
  } // EXTRA

  /**
   * @param {Object} app - The application; `app.fonts.c64Fonts8x8` must exist already (the ROM the gaps are filled from).
   * @param {boolean} proportional - Trim the glyphs to proportional widths; false keeps the 8-pixel cells.
   */
  constructor(app, proportional) {
    super(app, proportional);
    this.id = 'RTypeFonts8x8';
    /** the characters the sets give glyphs for: ZXFonts8x8's table, before EXTRA is appended */
    this.baseChars = this.fontsChars;
    /** the 2 KB set: the ROM's uppercase set with the title's glyphs over it */
    this.bytes = null;
    /** whether the title's glyphs are in (false: the ROM alone, the data not here yet) */
    this.fromData = false;
    this.build(Tool.loadDataFile('title'));
  } // constructor

  /**
   * Builds the set and the glyph table: the ROM's set 0, the title's glyphs
   * at {@link TITLE_CODES} over it when the data are here.
   * @param {Object|null} title - `data/title.json`, or null for the ROM alone.
   */
  build(title) {
    var rom = this.app.fonts.c64Fonts8x8;
    var bytes = rom.setBytes(0);
    var t = title && title.charset && title.charset.bytes;
    if (t) {
      RTypeFonts8x8.TITLE_CODES.forEach((code) => {
        for (var y = 0; y < 8; y++) {
          bytes[code*8+y] = t[code*8+y] || 0;
        }
      });
      this.fromData = true;
    }
    this.bytes = bytes;
    var hex = '';
    for (var i = 0; i < this.baseChars.length; i++) {
      var ch = this.baseChars[i];
      var glyph;
      if (ch >= 'a' && ch <= 'z') {
        // ★ the title set has no lower case (the ROM's first set neither): the ROM's second set lends its
        // letters, so a player's name shows as typed (operator 2026-10-21)
        glyph = rom.glyphBytes(C64ScreenCodes.encodeChar(ch, 1), 1);
      } else {
        var code = (ch === '©') ? 47 : C64ScreenCodes.encodeChar(ch, 0);
        glyph = bytes.subarray(code*8, code*8+8);
      }
      for (var y = 0; y < 8; y++) {
        hex += ('0'+glyph[y].toString(16)).slice(-2).toUpperCase();
      }
    }
    var extra = RTypeFonts8x8.EXTRA;
    this.setFontsData(hex+extra.hex);
    this.fontsChars = this.baseChars+extra.chars;
  } // build

  /**
   * The same set for a C64TextModeEntity: screen codes as the ROM's, the
   * title's glyphs where it has them.
   * @returns {C64Charset}
   */
  charset() {
    return new C64Charset(this.bytes);
  } // charset

} // RTypeFonts8x8
