const { DialogScreenModel } = await import('./dialogScreenModel.js?ver='+window.srcVersion);
const { C64VolumeEntity } = await import('./svision/js/platform/canvas2D/c64/c64VolumeEntity.js?ver='+window.srcVersion);
// begin code

/**
 * SOUNDS and MUSIC: the volume dialog of the library (C64VolumeEntity,
 * R-056) as a screen under the logo of the title screen and its heading —
 * one model for both, opened with the bus and the title. The
 * samples are the game's own player in the worker (`MenuModel`,
 * `AudioManager.audioData`), the two sliders the gains of the voices' roles
 * over the one SID (R-055).
 */
export class VolumeModel extends DialogScreenModel {

  /**
   * @param {Object} app - The application.
   * @param {Object} options - `bus` ('sounds' or 'music'), `cookie`, `sample` (the sound of the dialog's PLAY SAMPLE), `title` (SOUNDS or MUSIC).
   */
  constructor(app, options) {
    super(app, options.title, true);
    this.id = 'VolumeModel';
    this.options = options;
  } // constructor

  init() {
    super.init();
    // the samples may still be missing (the menu asks for them; the data may have come late): ask here too
    if (this.app.audioManager && !this.app.appDataPending()) {
      this.loadDataFiles(['music'], (files) => {
        if (files && this.app.model === this) {
          this.app.audioManager.askSamples(files.music);
        }
      });
    }
  } // init

  newContentEntity(c) {
    var o = this.options;
    return new C64VolumeEntity(this.desktopEntity, c.x, c.y, c.width, c.height, o.bus, o.cookie, o.sample, this.app.dialogProperties);
  } // newContentEntity

} // VolumeModel
