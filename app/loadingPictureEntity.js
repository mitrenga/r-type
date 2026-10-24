const { RasterEntity } = await import('./svision/js/platform/canvas2D/rasterEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
// begin code

/**
 * The loading picture of the tape (`data/picture.json`, file `P` of side A,
 * `tools/dumppicture.py`), composed the way the VIC-II shows it: a
 * **multicolour bitmap**, 160 × 200 pairs of bits, each pair a colour from
 * one of four places — 00 the background register, 01 the high nibble of
 * the cell's Screen RAM byte, 10 its low nibble, 11 its Colour RAM nibble —
 * doubled to 320 × 200 pixels. ★ The registers are the ones the file's own
 * code writes (`$D016` = `$18`, `$D021` = 0).
 *
 * Nothing is painted until the picture is here (the data arrive after the
 * model opened): a frame of black would flash by otherwise.
 */
export class LoadingPictureEntity extends RasterEntity {

  /**
   * @param {AbstractEntity} parentEntity - The desktop.
   * @param {number} x - Where it sits.
   * @param {number} y - Where it sits.
   * @param {Object|null} picture - `data/picture.json`, or null until it arrives.
   */
  constructor(parentEntity, x, y, picture) {
    super(parentEntity, x, y, 320, 200, false, false);
    this.id = 'LoadingPictureEntity';
    this.picture = picture;
  } // constructor

  /**
   * @param {Object} picture - `data/picture.json`.
   */
  setPicture(picture) {
    this.picture = picture;
    this.invalidate();
  } // setPicture

  drawEntity() {
    if (!this.picture) {
      return;
    }
    super.drawEntity();
  } // drawEntity

  /**
   * The 8 000 bytes of the bitmap into pixels: cell by cell, 8 bytes a cell,
   * four pairs a byte.
   * @param {Uint8ClampedArray} data - The RGBA bytes.
   */
  paintRaster(data) {
    var p = this.picture, bitmap = p.bitmap.bytes, screen = p.screen.bytes, color = p.color.bytes;
    var values = [];
    for (var c = 0; c < 16; c++) { values[c] = RasterEntity.colorValue(C64Color.color(c)); }
    var pixels = this.pixels, background = values[p.background & 15];
    for (var cell = 0; cell < 1000; cell++) {
      var cx = (cell%40)*8, cy = Math.floor(cell/40)*8;
      var c01 = values[screen[cell] >> 4], c10 = values[screen[cell] & 15], c11 = values[color[cell] & 15];
      for (var row = 0; row < 8; row++) {
        var byte = bitmap[cell*8+row], at = (cy+row)*320+cx;
        for (var pair = 0; pair < 4; pair++) {
          var bits = (byte >> (6-pair*2)) & 3;
          var v = bits === 0 ? background : bits === 1 ? c01 : bits === 2 ? c10 : c11;
          pixels[at+pair*2] = v;
          pixels[at+pair*2+1] = v;
        }
      }
    }
  } // paintRaster

} // LoadingPictureEntity
