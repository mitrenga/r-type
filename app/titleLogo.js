const { C64TextModeEntity } = await import('./svision/js/platform/canvas2D/c64/c64TextModeEntity.js?ver='+window.srcVersion);
const { C64Charset } = await import('./svision/js/platform/canvas2D/c64/c64Charset.js?ver='+window.srcVersion);
// begin code

/**
 * ★ The logo of the original's title screen as a text-mode entity over the
 * whole 320 x 200 picture: its own character set and screen codes
 * (`data/title.json`, `logo` — seven rows from the top, 39 columns from
 * column 1, multicolour with the title's `$D022`/`$D023`), the rest of the
 * screen empty. The menu shows it over its rows, the SOUNDS and MUSIC
 * screens over their dialog (`DialogScreenModel`).
 */
export class TitleLogo {

  /** the rows the logo takes, so a screen lays its contents out under them */
  static get HEIGHT() { return 7*8; }

  /**
   * @param {AbstractEntity} desktopEntity - The desktop the logo covers.
   * @param {Object} title - `data/title.json`.
   * @param {number} width - The desktop's width.
   * @param {number} height - The desktop's height.
   * @returns {C64TextModeEntity} Not yet added to the desktop.
   */
  static entity(desktopEntity, title, width, height) {
    var font = new C64Charset(Uint8Array.from(title.charset.bytes));
    var entity = new C64TextModeEntity(desktopEntity, 0, 0, width, height, font);
    var text = entity.textRAM;
    text.setBackground(title.vic['$D021']).setMulticolor(true).setSharedColors(title.vic['$D022'], title.vic['$D023']).showCursor(false);
    var first = title.logo.column || 0;
    for (var row = 0; row < 25; row++) {
      for (var col = 0; col < 40; col++) {
        var i = col-first;
        var code = row < title.logo.height && i >= 0 && i < title.logo.width ? title.logo.codes[row][i] : 0;
        text.putChar(col, row, code, title.logo.color);
      }
    }
    return entity;
  } // entity

} // TitleLogo
