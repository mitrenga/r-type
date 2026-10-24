const { DialogScreenModel } = await import('./dialogScreenModel.js?ver='+window.srcVersion);
const { C64SettingsEntity } = await import('./svision/js/platform/canvas2D/c64/c64SettingsEntity.js?ver='+window.srcVersion);
// begin code

/**
 * SETTINGS: the controls panel of the library as a screen — the keyboard
 * remap, the gamepad, which half of the touchscreen is the stick, the
 * display (`MainApp.controlsOptions`) in the C64 look of the library's panel
 * (C64SettingsEntity, R-056), laid out under the logo and the heading in
 * 288 x 128: the
 * rows of the gamepad's eight actions and the remap come closer together
 * for it, and the remap window is the one of `MainApp.dialogProperties`.
 */
export class SettingsModel extends DialogScreenModel {

  constructor(app) {
    super(app, 'SETTINGS', true);
    this.id = 'SettingsModel';
  } // constructor

  newContentEntity(c) {
    return new C64SettingsEntity(this.desktopEntity, c.x, c.y, c.width, c.height, this.app.controlsOptions, this.app.dialogProperties);
  } // newContentEntity

} // SettingsModel
