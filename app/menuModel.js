const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { DialogEntity } = await import('./svision/js/platform/canvas2D/dialogs/dialogEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { TitleLogo } = await import('./titleLogo.js?ver='+window.srcVersion);
const { WaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/dialogs/waitForAudioEventEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The menu: a `MenuEntity` in the machine's own character set, the shape the
 * sibling remakes have (`manicminer/app/menuModel.js`) and the pause panel
 * of this one (`app/pauseGameEntity.js`) — the arrows or the gamepad move
 * the selection bar, Enter or the gamepad's OK takes the row, a click or a
 * tap takes the row under it.
 * Where the boot lands and where the pause panel's EXIT comes back to.
 *
 * ★ The original has no menu of its own beyond its title screen (F1 one
 * player, F7 pause — `sources/docs/disasm_notes.md` §1); the title screen
 * of the original comes with M7. SOUNDS is the one slider of the `sid` bus
 * (M6, `app/audioManager.js`; R-024: the menu itself is silent and closes
 * every bus), MUSIC the other — the two gains of the voices' roles over
 * the one chip (R-055, `app/audioManager.js`); SETTINGS is the controls
 * (`MainApp.controlsOptions`: keyboard remap, gamepad, which half of the
 * touchscreen is the stick, display) in the library's settings panel —
 * still the ZX one until R-056 reaches it. PLAYER NAME is the
 * name of the hall of fame, the remake's local table (R-049,
 * `app/gameOverModel.js`); SHOW LOADING SCREEN the tape's picture
 * (`app/loadingPictureModel.js`).
 */
export class MenuModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'MenuModel';
    this.menuEntity = null;
    /** a newer version on the server (`db/version.php`): the ABOUT row reads UPGRADE ! and upgrades (Manic Miner's way) */
    this.newVersionAvailable = false;
    this.menuItems = [
      {t1: 'START GAME', event: {id: 'startGame'}},
      {t1: 'PLAYER NAME', event: {id: 'setPlayerName'}},
      {t1: 'HALL OF FAME', event: {id: 'showHallOfFame'}},
      {t1: 'SOUNDS', event: {id: 'setSounds'}},
      {t1: 'MUSIC', event: {id: 'setMusic'}},
      {t1: 'SETTINGS', event: {id: 'setSettings'}},
      {t1: 'SHOW LOADING SCREEN', event: {id: 'showLoadingPicture'}},
      {t1: 'ABOUT', event: {id: 'showAbout'}}
    ];
    // the look on the black screen: cyan rows, the selected one black on a cyan bar
    this.menuOptions = {
      fonts: this.app.fonts.rtypeProportional,
      leftMargin: 0,
      rightMargin: 0,
      topMargin: 0,
      itemHeight: 13,
      itemPitch: 16,
      t1LeftMargin: 3,
      t1TopMargin: 3,
      t2Width: 128,                 // fifteen characters of the player's name in the 8 px font, with the margins
      t2RightMargin: 3,
      t2TopMargin: 3,
      textColor: C64Color.color(3),
      selectionTextColor: C64Color.color(0),
      selectionBarColor: C64Color.color(3),
      hoverColor: '#ffffff1e',
      selectionHoverColor: C64Color.color(1),
      clickColor: '#ffffff2e',
      selectionClickColor: '#ffffffff',
      selection: this.app.menuSelection || 0           // the row chosen last time (`MainApp.menuSelection`)
    };
    /** the look of the one window the menu opens, the wait for a gesture (`MainApp.dialogProperties`) */
    this.dialogProperties = this.app.dialogProperties;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false);
  } // newBorderEntity

  init() {
    super.init();
    this.desktopEntity.bkColor = C64Color.color(0);
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = C64Color.color(0);
    }
    // ★ the logo of the original's title screen over the top rows: its own character set and screen codes
    // (`data/title.json`, `tools/dumptitle.py`), multicolour as the title sets the VIC ($D016 = $18, $D022 = 3,
    // $D023 = 11, Colour RAM $09); the rest of the text screen is empty (code 0 is an empty glyph of that set)
    this.logoEntity = null;
    this.showLogo(this.loadDataFile('title'));
    // seven rows of 16 px under the logo of the 320 × 200 picture, the values (name, volumes) in the right column
    this.menuEntity = new MenuEntity(this.desktopEntity, 40, 62, 240, this.menuItems.length*16, this.desktopEntity.bkColor, this.menuOptions, this, this.getMenuData);
    this.desktopEntity.addEntity(this.menuEntity);
    // the remake's author and licence on the last row of the screen
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.c64Fonts8x8LowerProportional, 0, 192, 320, 8,
      'Remake by Libor Mitrenga, CC BY-NC-SA 4.0', C64Color.color(15), false, {align: 'center'}));
    // ★ R-024: no bus stays open under the menu — `closeAllAudioBuses` drops the handler and with the last
    // one the AudioContext, so the chip model goes too and the next game does not start with the registers
    // the last one left in it (Impossible Mission, R-044)
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
    this.handleAppData();
    this.checkServerVersion();
  } // init

  /**
   * Asks the server for its version (`db/version.php`, the version in
   * `app/version.js` there); a different one turns the ABOUT row into
   * UPGRADE ! — the siblings (Manic Miner, Booty) have a separate button for
   * it, here the version is the value of the ABOUT row. A dedicated receiver,
   * so the request does not clash with the application's `appData.db` fetch
   * (one `fetchDataId` and `setData` per receiver).
   */
  checkServerVersion() {
    if (!navigator.onLine) { return; }
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        var version = data && data.data && data.data.version;
        if (version && version !== 'unknown' && version !== this.app.version) {
          this.newVersionAvailable = true;
          if (this.menuEntity) { this.menuEntity.refreshMenu(); }
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  /**
   * What the menu asks about its rows.
   * @param {MenuModel} self - The model.
   * @param {string} key - What is asked.
   * @param {number} row - Which row.
   * @returns {*} The answer.
   */
  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      case 't1':
        // a newer version on the server: the ABOUT row is the UPGRADE ! button
        if (self.menuItems[row].event.id === 'showAbout' && self.newVersionAvailable) { return 'UPGRADE !'; }
        return self.menuItems[row].t1;
      case 'penColor':
        return self.menuItems[row].event.id === 'showAbout' && self.newVersionAvailable ? C64Color.color(2) : false;
      case 't2':
        switch (self.menuItems[row].event.id) {
          case 'showAbout':
            // the version as the row's value; nothing while the row reads UPGRADE !
            return self.newVersionAvailable ? '' : 'v'+self.app.version;
          case 'setPlayerName':
            return self.app.playerName || '';
          case 'setSounds':
            return self.volumeText(self.app.audioManager ? self.app.audioManager.volume.sounds : 0);
          case 'setMusic':
            return self.volumeText(self.app.audioManager ? self.app.audioManager.volume.music : 0);
        }
        return '';
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  /**
   * The logo (TitleLogo) under the menu, once the data are here.
   * @param {Object|null} title - `data/title.json`, or null until it arrives.
   */
  showLogo(title) {
    if (!title || this.logoEntity) { return; }
    this.logoEntity = TitleLogo.entity(this.desktopEntity, title, this.desktopWidth, this.desktopHeight);
    // under the menu and the author's line: added the usual way, then moved to the front of the desktop's list
    this.desktopEntity.addEntity(this.logoEntity);
    this.desktopEntity.entities.pop();
    this.desktopEntity.entities.unshift(this.logoEntity);
  } // showLogo

  /** The row the bar stands on is remembered for the next menu (the model is left for a game, a screen, a dialog's model). */
  shutdown() {
    super.shutdown();
    if (this.menuEntity) { this.app.menuSelection = this.menuEntity.selection; }
  } // shutdown

  /**
   * @param {number} volume - A slider's 0-10.
   * @returns {string} OFF, MAX or the percentage.
   */
  volumeText(volume) {
    return volume === 0 ? 'OFF' : volume === 10 ? 'MAX' : (volume*10)+'%';
  } // volumeText

  /**
   * ★ M6: the samples of the volume dialogs are the game's own sound — the
   * worker plays the opening of level 1's tune with the level's player
   * (MUSIC), and a few effects over it (SOUNDS, R-055), and answers
   * `sample` (`app/gameWorker.js`), which the application keeps for the
   * audio manager (`AudioManager.askSamples`). Asked once the song is in
   * storage (the application fetches the data once and calls this again
   * when it arrives).
   */
  handleAppData() {
    this.showLogo(this.loadDataFile('title'));
    // the rows are in the original's font, built from the title's data when they arrive (`MainApp.setData`)
    if (this.menuEntity) { this.menuEntity.refreshMenu(); }
    if (this.sampleAsked || !this.app.audioManager) { return; }
    this.sampleAsked = this.app.audioManager.askSamples(this.loadDataFile('music'));
  } // handleAppData

  /**
   * START GAME: ★ the game opens the `sid` bus, and the browser plays a
   * sound only after a gesture (R-024) — a key is one, so the wait comes
   * only when the menu was reached without any (a click or a tap is one too).
   */
  startGame() {
    // no name yet: the PLAYER NAME screen first, and its OK starts the game (the siblings' way, Manic Miner)
    if (!this.app.playerName.length) {
      this.app.setModel('PlayerNameModel', {autoStartGame: true});
      return;
    }
    if (this.app.inputEventsManager.needEventForAudio()) {
      var p = this.dialogProperties;
      this.desktopEntity.addModalEntity(new DialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, false, p,
        (dialog) => new WaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'startGame2', p)));
      return;
    }
    this.app.setModel('GameModel');
  } // startGame

  /**
   * The rows' events from the menu (its own keys — arrows, Enter, mouse,
   * touch, gamepad — the menu takes itself).
   * @param {Object} event - The library's event.
   * @returns {boolean} Whether it was taken.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'startGame':
        this.startGame();
        return true;
      case 'startGame2':
        this.app.setModel('GameModel');
        return true;
      case 'setPlayerName':
        this.app.setModel('PlayerNameModel');
        return true;
      case 'showHallOfFame':
        this.app.setModel('GameOverModel', {table: true});
        return true;
      case 'setSounds':
        this.app.setModel('VolumeModel', {bus: 'sounds', cookie: 'audioBusSoundsLevel', sample: 'exampleSound', title: 'SOUNDS'});
        return true;
      case 'setMusic':
        this.app.setModel('VolumeModel', {bus: 'music', cookie: 'audioBusMusicLevel', sample: 'exampleMusic', title: 'MUSIC'});
        return true;
      case 'setSettings':
        this.app.setModel('SettingsModel');
        return true;
      case 'refreshMenu':
        if (this.menuEntity) { this.menuEntity.refreshMenu(); }
        return true;
      case 'showLoadingPicture':
        this.app.setModel('LoadingPictureModel');
        return true;
      case 'showAbout':
        // the row reads UPGRADE ! — the new version instead of the about screen (`AbstractApp.upgradeApp`)
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        else {
          this.app.setModel('AboutModel');
        }
        return true;
    }
    return false;
  } // handleEvent

  /**
   * R-037: `AbstractModel.loopModel` does not draw; a static screen redraws
   * here, which costs nothing while nothing changed (`paintedVersion`).
   * @param {number} timestamp - What the animation loop was given.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.drawModel();
  } // loopModel

} // MenuModel
