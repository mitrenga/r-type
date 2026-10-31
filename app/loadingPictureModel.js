const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { LoadingPictureEntity } = await import('./loadingPictureEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The loading picture of the tape, as the machine shows it between `BOOT`
 * and the core: black border, black background, the multicolour bitmap of
 * file `P` ({@link LoadingPictureEntity}). ★ The original waits here for
 * SPACE (`$9849`); the remake goes back to the menu on any key, a click or a
 * tap. The loading itself — the turbo blocks, the stripes — is not played:
 * the picture is the thing (`ZADANI.md` §7), the way Booty's LOAD TAPE
 * shows its SCREEN$ but without the tape under it.
 */
export class LoadingPictureModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'LoadingPictureModel';
    this.pictureEntity = null;
  } // constructor

  init() {
    super.init();
    this.desktopEntity.bkColor = C64Color.color(0);
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = C64Color.color(0);
    }
    this.pictureEntity = new LoadingPictureEntity(this.desktopEntity, 0, 0, this.loadDataFile('picture'));
    this.desktopEntity.addEntity(this.pictureEntity);
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // init

  /** The data arrived after the model opened (the application calls this again then). */
  handleAppData() {
    if (this.pictureEntity && !this.pictureEntity.picture && !this.app.appDataPending()) {
      // from localStorage at once, or from the server when it is missing there (R-062)
      this.loadDataFiles(['picture'], (files) => {
        if (files && files.picture && this.app.model === this && !this.pictureEntity.picture) {
          this.pictureEntity.setPicture(files.picture);
        }
      });
    }
  } // handleAppData

  /**
   * Any key, a click or a tap goes back to the menu.
   * @param {Object} event - The library's event.
   * @returns {boolean} Whether it was taken.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    if (event.id === 'keyPress') {
      this.app.setModel('MenuModel');
      return true;
    }
    return false;
  } // handleEvent

  /**
   * R-037: a static screen redraws here.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();
  } // loopModel

} // LoadingPictureModel
