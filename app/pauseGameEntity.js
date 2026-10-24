const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
// begin code

/**
 * The pause panel, the shape the sibling remakes have
 * (`impossiblemission/app/pauseGameEntity.js`, `manicminer`) in the colours
 * of this machine.
 *
 * ★ **The original has its own pause**: F7, and fire to go on (`$0E96`,
 * `sources/docs/disasm_notes.md` §3) — that one belongs to the game and
 * comes with M3 as the original's code. This panel is the remake's: Escape
 * or the cross in the border, RESUME GAME, SOUNDS, MUSIC and EXIT GAME the
 * way `manicminer` has them, because a browser tab that loses focus has to
 * stop somewhere and a touchscreen has no F7 (`ZADANI.md` §10.2). SOUNDS
 * and MUSIC switch `app.muted` and the game's one `sid` bus gets its roles'
 * gains again (`AudioManager.refreshVolume`).
 *
 * ★ It is a **modal entity**, so while it is up the model gets no events
 * and the world does not move; whoever opens it stops the worker as well,
 * because the worker's clock is its own (`GameModel.pauseGame`).
 */
export class PauseGameEntity extends AbstractEntity {

  /**
   * @param {AbstractEntity} parentEntity - The desktop.
   * @param {number} x - Where it sits, in the picture's pixels.
   * @param {number} y - Where it sits.
   * @param {number} width - How wide.
   * @param {number} height - How tall.
   * @param {string} title - What is written over it.
   * @param {string} exitModel - Which model EXIT goes to.
   */
  constructor(parentEntity, x, y, width, height, title, exitModel) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'PauseGameEntity';

    this.title = title;
    this.exitModel = exitModel;
    this.menuItems = [
      {t1: 'RESUME GAME', event: {id: 'closePauseGame'}},
      {t1: 'SOUNDS', event: {id: 'changeSoundsState'}},
      {t1: 'MUSIC', event: {id: 'changeMusicState'}},
      {t1: 'EXIT GAME', event: {id: 'exitGame'}}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.rtype,
      leftMargin: 9,
      rightMargin: 9,
      topMargin: 8,
      itemHeight: 12,
      t1LeftMargin: 3,
      t1TopMargin: 2,
      t2Width: 40,
      t2RightMargin: 3,
      t2TopMargin: 2,
      textColor: C64Color.color(0),
      selectionTextColor: C64Color.color(1),          // the chosen row white on a grey bar
      selectionBarColor: C64Color.color(12),
      hoverColor: '#0000001e',
      selectionHoverColor: C64Color.color(15),
      clickColor: '#0000002e',
      selectionClickColor: '#ffffffff'
    };
  } // constructor

  init() {
    super.init();
    // the panel in the cyan the main menu's rows are written in (MenuModel, C64 colour 3)
    this.addEntity(new AbstractEntity(this, 0, 0, this.width, this.height, false, C64Color.color(3)));
    // the title and the rows in the game's own set (`RTypeFonts8x8`, the title screen's charset), 8 px tall: a 12 px heading row
    // the heading in the colour the settings' heading has (DialogScreenModel), the menu without a frame of its own
    this.addEntity(new TextEntity(this, this.app.fonts.rtype, 0, 0, this.width, 12, this.title, C64Color.color(10), false, {align: 'center', margin: 2}));
    this.addEntity(new MenuEntity(this, 1, 12, this.width-2, this.height-13, false, this.menuOptions, this, this.getMenuData));
  } // init

  /**
   * What the menu asks about its rows.
   * @param {PauseGameEntity} self - The panel.
   * @param {string} key - What is asked.
   * @param {number} row - Which row.
   * @returns {*} The answer.
   */
  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      case 't2':
        switch (row) {
          case 1:
            return self.app.muted.sounds ? 'MUTE' : 'ON';
          case 2:
            return self.app.muted.music ? 'MUTE' : 'ON';
        }
        break;
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'keyPress':
        switch (event.key) {
          case 'Escape':
            // ★ Escape opened it, so Escape closes it: the cross in the
            // border sends the same key, and a touchscreen has no other way
            this.sendEvent(-1, 1, {id: 'continueGame'});
            this.destroy();
            return true;
        }
        break;
      case 'closePauseGame':
        this.sendEvent(-1, 1, {id: 'continueGame'});
        this.destroy();
        return true;
      case 'changeSoundsState':
        this.app.muted.sounds = !this.app.muted.sounds;
        this.app.audioManager.refreshVolume('sid');
        this.sendEvent(1, 0, {id: 'refreshMenu'});
        return true;
      case 'changeMusicState':
        this.app.muted.music = !this.app.muted.music;
        this.app.audioManager.refreshVolume('sid');
        this.sendEvent(1, 0, {id: 'refreshMenu'});
        return true;
      case 'exitGame':
        this.app.setModel(this.exitModel);
        return true;
    }
    return false;
  } // handleEvent

} // PauseGameEntity
