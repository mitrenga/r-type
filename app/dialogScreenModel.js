const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TitleLogo } = await import('./titleLogo.js?ver='+window.srcVersion);
// begin code

/**
 * ★ A screen of the menu that holds one dialog of the library — SOUNDS,
 * MUSIC (VolumeModel), SETTINGS (SettingsModel), PLAYER NAME
 * (PlayerNameModel) — the way ABOUT is a screen: a model of its own instead
 * of a window over the menu (operator 2026-10-20). Black picture and
 * border; at the top either the heading in the original's font as the about
 * screen has it, with the contents 288 x 168 at (16, 24) under it, or the
 * logo of the title screen as the menu shows it (TitleLogo), with the
 * contents 288 x 136 at (16, 60) under its seven rows. The contents come
 * from `MainApp.dialogProperties` and send 'contentClosed' when they close;
 * the screen goes back to the menu on it.
 */
export class DialogScreenModel extends AbstractModel {

  /** where the contents sit on the 320 x 200 picture: under a heading, under the logo, under the logo and a heading */
  static get CONTENT() { return {x: 16, y: 24, width: 288, height: 168}; }
  static get CONTENT_UNDER_LOGO() { return {x: 16, y: TitleLogo.HEIGHT+4, width: 288, height: 200-TitleLogo.HEIGHT-4}; }
  static get CONTENT_UNDER_LOGO_HEADING() { return {x: 16, y: TitleLogo.HEIGHT+16, width: 288, height: 200-TitleLogo.HEIGHT-16}; }

  /**
   * @param {Object} app - The application.
   * @param {string|false} title - The heading; false for none.
   * @param {boolean} [logo] - The logo of the title screen at the top.
   */
  constructor(app, title, logo = false) {
    super(app);
    this.id = 'DialogScreenModel';
    this.title = title;
    this.logo = logo;
    this.contentEntity = null;
    this.logoEntity = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false);
  } // newBorderEntity

  /**
   * The contents of the screen, made by the subclass.
   * @param {Object} c - `{x, y, width, height}` of the contents.
   * @returns {AbstractEntity}
   */
  newContentEntity(c) {
    return null;
  } // newContentEntity

  init() {
    super.init();
    this.desktopEntity.bkColor = C64Color.color(0);
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = C64Color.color(0);
    }
    var content = DialogScreenModel.CONTENT;
    var headingY = 8;
    if (this.logo) {
      this.showLogo(this.loadDataFile('title'));
      content = (this.title === false) ? DialogScreenModel.CONTENT_UNDER_LOGO : DialogScreenModel.CONTENT_UNDER_LOGO_HEADING;
      headingY = TitleLogo.HEIGHT+8;   // a row under the logo, the contents under the heading from +16
    }
    if (this.title !== false) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.rtype, 0, headingY, this.desktopWidth, 8, this.title, C64Color.color(10), false, {align: 'center'}));
    }
    this.contentEntity = this.newContentEntity(content);
    this.desktopEntity.addEntity(this.contentEntity);
    // the flash clock of the siblings' models (Manic Miner's): the cursor of the input and of the remap blink by it
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // init

  /**
   * The logo under the contents, once the data are here (the menu's shape).
   * @param {Object|null} title - `data/title.json`, or null until it arrives.
   */
  showLogo(title) {
    if (!title || this.logoEntity || !this.logo) { return; }
    this.logoEntity = TitleLogo.entity(this.desktopEntity, title, this.desktopWidth, this.desktopHeight);
    this.desktopEntity.addEntity(this.logoEntity);
    this.desktopEntity.entities.pop();
    this.desktopEntity.entities.unshift(this.logoEntity);
  } // showLogo

  /** The data arrived after the screen was built (`MainApp.setData`). */
  handleAppData() {
    this.showLogo(this.loadDataFile('title'));
  } // handleAppData

  /**
   * R-037: a static screen redraws here; the contents tick on their own
   * (the gamepad polling of the settings), a window over them too.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    if (this.contentEntity) {
      this.contentEntity.loopEntity(timestamp);
    }
    this.drawModel();
  } // loopModel

  /**
   * Back to the menu when the contents close. ★ The contents close with
   * `destroy()` and a 'contentClosed' sent to their parent — but the parent
   * here is the desktop, which knows nothing of it, so the screen watches
   * the 'destroy' of its contents instead, the way DialogEntity does for a
   * window (R-028). `refreshMenu`, which the contents send for a menu under
   * a window, has nothing to do here.
   * @param {Object} event
   * @returns {boolean}
   */
  handleEvent(event) {
    if (event.id == 'destroy' && event.entity === this.contentEntity) {
      this.contentEntity = null;
      this.app.setModel('MenuModel');
      return true;
    }
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'contentClosed':
        this.app.setModel('MenuModel');
        return true;
      case 'refreshMenu':
        return true;
      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;
    }
    return false;
  } // handleEvent

} // DialogScreenModel
