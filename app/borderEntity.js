const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { SpriteTool } = await import('./svision/js/spriteTool.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
// begin code

/**
 * The border of the television around the 320x200 picture: the cross that
 * opens the pause panel, the two halves of the touchscreen with their icons
 * (the stick and the fire button, as `manicminer`, `jetsetwilly` and `booty`
 * have them), the frame counter and the developer-mode banner.
 * Its colour is `$D020`, which the models set — ★ R-Type keeps it black in
 * the game (the frame of level 1, `data/screen.json`), and inside the
 * picture the 38-column window paints the same `$D020` over the edges of the
 * playfield (`C64TextRAM.paintBorder32`), so the two must agree.
 *
 * Taken over from `impossiblemission/app/borderEntity.js` (the same machine).
 *
 * ★ The cross is not a model of its own and knows nothing about pausing:
 * it sends `{id: 'keyPress', key: 'Escape'}`, exactly what the keyboard
 * sends, so the model has **one** way in and the touchscreen has the key a
 * keyboard has not got.
 */
export class BorderEntity extends AbstractEntity {

  /**
   * @param {boolean} enableExit - Whether the cross is in the border.
   * @param {boolean} enableGameControls - Whether the two halves of the
   *        touchscreen are there (`controls.touchscreen.supported`).
   */
  constructor(enableExit, enableGameControls) {
    super(null, 0, 0, 0, 0, false, false);
    this.id = 'BorderEntity';

    this.enableExit = enableExit;
    this.enableGameControls = !!enableGameControls;
    this.escapeEntity = null;
    this.escapeScale = 2;
    /**
     * The two halves of the whole television (border included): the model
     * binds a touch to the one it landed on, so that the input manager keeps
     * sending `keyMove` for it — ★ a touch bound to nothing gets no moves at
     * all (`InputEventsManager.eventTouchMove`), and a stick without moves
     * never leaves its centre.
     */
    this.leftControlEntity = null;
    this.rightControlEntity = null;
    /** an icon of what each half does, drawn **in the border only**, never over the picture */
    this.leftIconEntity = null;
    this.rightIconEntity = null;
    this.gameControlIcons = false;
    this.devModeNameEntity = null;
    this.fpsEntity = null;
  } // constructor

  init() {
    super.init();

    if (this.enableExit) {
      if (this.app.layout.ratio > 2) {
        this.escapeScale = 1;
      }
      this.escapeEntity = new ButtonEntity(this, this.app.fonts.c64Fonts8x8,
        0, 0, this.escapeScale*8, this.escapeScale*8, 'X',
        {id: 'keyPress', key: 'Escape'}, [], false, false,
        {scale: this.escapeScale, clickColor: '#7a7a7aff'});
      this.addEntity(this.escapeEntity);
    }

    if (this.enableGameControls) {
      this.leftControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.leftControlEntity);
      this.rightControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.rightControlEntity);

      this.leftIconEntity = new SpriteEntity(this, 0, 0, C64Color.color(1), false, 0, 0);
      this.leftIconEntity.hide = true;
      this.addEntity(this.leftIconEntity);
      this.rightIconEntity = new SpriteEntity(this, 0, 0, C64Color.color(1), false, 0, 0);
      this.rightIconEntity.hide = true;
      this.addEntity(this.rightIconEntity);
    }

    // ★ **The frame counter belongs in the border, not in the picture.** The
    // playfield is **pixel for pixel the machine's** (`tools/matchscreen.mjs`);
    // text over it would make the comparison with the original impossible.
    if (typeof this.app.devModeName === 'string') {
      this.fpsEntity = new TextEntity(this, this.app.fonts.fonts5x5, 0, 0, 80, 7,
                                      '', C64Color.color(7), false, {margin: 1});
      this.addEntity(this.fpsEntity);
    }

    // ★ `devModeName` is **a string, or nothing**: unlike its siblings this
    // project need not get it (`app/main.js` passes it only when `window`
    // has it), and `undefined !== false` is true — an easy trap to fall into
    if (typeof this.app.devModeName === 'string') {
      this.devModeNameEntity = new TextEntity(this, this.app.fonts.fonts5x5, 0, -7, 100, 7, '', false, false, {margin: 1});
      var cfgLen = this.app.devModeName.indexOf('}');
      this.devModeNameEntity.setText(this.app.devModeName.substring(cfgLen+1));
      var cfg = null;
      try {
        cfg = JSON.parse(this.app.devModeName.substring(1, cfgLen+1));
        Object.keys(cfg).forEach((item) => {
          this.devModeNameEntity[item] = cfg[item];
        });
      } catch (error) {
        console.error(error.message);
      }
      if (!cfg || !('width' in cfg)) {
        this.devModeNameEntity.width = this.devModeNameEntity.lineWidth(this.devModeNameEntity.text)+2;
      }
      this.addEntity(this.devModeNameEntity);
    }
  } // init

  drawEntity() {
    super.drawEntity();
    if (this.escapeEntity) {
      // ★ The cross has to be legible on whatever `$D020` is: white on a
      // dark border, black on a light one. The game's own border is black,
      // the menu's is light — both happen, and the colour
      // is read off the border itself rather than told to it, because every
      // model sets `bkColor` already and none of them knows about crosses.
      var penColor = C64Color.color(this.lightBorder() ? 0 : 1);
      if (this.escapeEntity.penColor !== penColor) {
        this.escapeEntity.setPenColor(penColor);
      }
      // the icons the same way: legible on whatever `$D020` is
      [this.leftIconEntity, this.rightIconEntity].forEach((icon) => {
        if (icon && icon.penColor !== penColor) { icon.setPenColor(penColor); }
      });
    }
    this.drawSubEntities();
  } // drawEntity

  /**
   * The touch-control icons of the two halves of the screen
   * (`controlsOptions.touchscreen.icons`, `GameModel.showTouchIcons`).
   * @param {Object|false} left - The left half's icon.
   * @param {Object|false} right - The right half's icon.
   */
  setGameControlIcons(left, right) {
    if (!this.enableGameControls) { return; }
    this.gameControlIcons = !!(left && right);
    [{entity: this.leftIconEntity, icon: left},
     {entity: this.rightIconEntity, icon: right}].forEach((item) => {
      if (item.icon) {
        item.entity.setGraphicsData('compressedSpriteData' in item.icon
                                    ? SpriteTool.decode(item.icon.compressedSpriteData)
                                    : item.icon);
      }
    });
    this.layoutGameControlIcons();
  } // setGameControlIcons

  /**
   * Places the icons in the border, as `booty` does: when the side border is
   * wide enough (a phone on its side), each goes beside its half; when the
   * bottom one is tall enough (a phone upright), both go under the picture.
   * Otherwise they are not drawn — never over the game.
   */
  layoutGameControlIcons() {
    if (!this.enableGameControls || !this.leftIconEntity || this.model == null) { return; }
    var icons = [this.leftIconEntity, this.rightIconEntity];
    if (!this.gameControlIcons || icons.some((icon) => icon.width == 0)) {
      icons.forEach((icon) => { icon.hide = true; });
      return;
    }
    var margin = 2;
    var beside = Math.max(...icons.map((icon) => icon.width))+2*margin;
    var below = Math.max(...icons.map((icon) => icon.height))+2*margin;
    if (this.model.borderWidth >= beside) {
      icons.forEach((icon, i) => {
        icon.x = (i == 0 ? 0 : this.width-this.model.borderWidth)
                 +Math.floor((this.model.borderWidth-icon.width)/2);
        icon.y = Math.floor((this.height-icon.height)/2);
        icon.hide = false;
      });
    } else if (this.model.borderHeight >= below) {
      var top = this.height-this.model.borderHeight;
      icons.forEach((icon, i) => {
        icon.x = Math.floor(this.width*(1+2*i)/4-icon.width/2);
        icon.y = top+Math.floor((this.model.borderHeight-icon.height)/2);
        icon.hide = false;
      });
    } else {
      icons.forEach((icon) => { icon.hide = true; });
    }
  } // layoutGameControlIcons

  /**
   * What the dev-mode indicator says: how many frames a second the model
   * **draws**, and how many `frame` messages a second come from the worker.
   * ★ Without it there is no telling whether the picture keeps step with
   * the world or is redrawn for nothing (R-037).
   * @param {string} text - For instance `60/50 FPS`.
   */
  setFps(text) {
    // `setText` notices by itself that nothing changed and keeps the cache
    if (this.fpsEntity) { this.fpsEntity.setText(text); }
  } // setFps

  /**
   * Whether `$D020` is one of the light sixteen, out of the hex the
   * library paints the border with.
   * @returns {boolean} True when black is the legible pen on it.
   */
  lightBorder() {
    var hex = typeof this.bkColor === 'string' ? this.bkColor.replace('#', '') : '';
    if (hex.length < 6) { return false; }
    var r = parseInt(hex.substring(0, 2), 16),
        g = parseInt(hex.substring(2, 4), 16),
        b = parseInt(hex.substring(4, 6), 16);
    return (0.299*r + 0.587*g + 0.114*b) >= 128;
  } // lightBorder

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'resizeModel':
        if (this.escapeEntity) {
          // in the bottom border when there is one, otherwise just outside
          // the picture's top right corner
          if (this.model.borderHeight < this.escapeScale*8) {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width;
            this.escapeEntity.y = this.model.borderHeight;
          } else {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width-this.escapeScale*8;
            this.escapeEntity.y = this.model.borderHeight-this.escapeScale*8;
          }
        }
        if (this.enableGameControls) {
          var w = Math.floor(this.width/2);
          this.leftControlEntity.x = 0;
          this.leftControlEntity.y = 0;
          this.leftControlEntity.width = w;
          this.leftControlEntity.height = this.height;
          this.rightControlEntity.x = this.width-w;
          this.rightControlEntity.y = 0;
          this.rightControlEntity.width = w;
          this.rightControlEntity.height = this.height;
          this.layoutGameControlIcons();
        }
        if (this.fpsEntity) {
          // bottom left in the border, under the picture; at the top when there is no room below
          this.fpsEntity.x = 1;
          this.fpsEntity.y = this.model.borderHeight >= 7
            ? this.height-this.model.borderHeight : 0;
        }
        if (this.devModeNameEntity) {
          this.devModeNameEntity.x = Math.floor((this.width-this.devModeNameEntity.width)/2);
          this.devModeNameEntity.y = Math.max(Math.floor((this.app.model.borderHeight-this.devModeNameEntity.height)/2), 0);
        }
        break;
    }
    return false;
  } // handleEvent

} // BorderEntity
