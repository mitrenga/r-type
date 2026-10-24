const { DialogScreenModel } = await import('./dialogScreenModel.js?ver='+window.srcVersion);
const { C64PlayerNameEntity } = await import('./svision/js/platform/canvas2D/c64/c64PlayerNameEntity.js?ver='+window.srcVersion);
// begin code

/**
 * PLAYER NAME: the name for the hall of fame (R-049) in the library's
 * dialog as a screen under the logo and the heading, with its on-screen
 * keyboard in the C64 look (C64PlayerNameEntity, R-056). START GAME without
 * a name opens it with `autoStartGame`, and OK goes on into the game.
 */
export class PlayerNameModel extends DialogScreenModel {

  /**
   * @param {Object} app - The application.
   * @param {Object} [options] - `autoStartGame`: opened by START GAME without a name, so OK starts the game.
   */
  constructor(app, options) {
    super(app, 'PLAYER NAME', true);
    this.id = 'PlayerNameModel';
    this.autoStartGame = !!(options && options.autoStartGame);
  } // constructor

  newContentEntity(c) {
    return new C64PlayerNameEntity(this.desktopEntity, c.x, c.y, c.width, c.height, this.autoStartGame, this.app.dialogProperties);
  } // newContentEntity

  /**
   * OK with `autoStartGame` sends 'startGame': the game, straight away — the
   * OK itself was the browser's gesture for the audio.
   * @param {Object} event
   * @returns {boolean}
   */
  handleEvent(event) {
    if (event.id == 'startGame') {
      this.app.setModel('GameModel');
      return true;
    }
    return super.handleEvent(event);
  } // handleEvent

} // PlayerNameModel
