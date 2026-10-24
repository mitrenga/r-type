const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { C64Fonts8x8 } = await import('./svision/js/platform/canvas2D/c64/c64Fonts8x8.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { RTypeFonts8x8 } = await import('./rtypeFonts8x8.js?ver='+window.srcVersion);
const { C64DialogProperties } = await import('./svision/js/platform/canvas2D/c64/c64DialogProperties.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { VolumeModel } = await import('./volumeModel.js?ver='+window.srcVersion);
const { SettingsModel } = await import('./settingsModel.js?ver='+window.srcVersion);
const { PlayerNameModel } = await import('./playerNameModel.js?ver='+window.srcVersion);
const { C64BootModel } = await import('./svision/js/platform/canvas2D/c64/c64BootModel.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { AboutModel } = await import('./aboutModel.js?ver='+window.srcVersion);
const { LoadingPictureModel } = await import('./loadingPictureModel.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { GameOverModel } = await import('./gameOverModel.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { Version } = await import('./version.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * The application: switches the machine on, starts the tape and shows what
 * M1 has — **a frame of level 1 composed from the original's memory and
 * registers** (`app/screenLoader.js`, `data/screen.json`), with the world's
 * clock ticking in a worker that does not move anything yet.
 *
 * ★ The boot is the tape's (`ZADANI.md` §1, operator 2026-10-18):
 * SHIFT+RUN/STOP is `LOAD` and `RUN` typed by the KERNAL; the lines it
 * prints are the KERNAL's own. The loading itself — the turbo, the picture,
 * side B — is M7 (`sources/docs/disasm_notes.md` §0).
 *
 * The world lives in a worker (`app/gameWorker.js`), a classic script, so
 * it is reachable by URL (`config/compile.json`).
 */
export class MainApp extends AbstractApp {

  /**
   * @param {Object} platform - `app/appPlatform.js`.
   * @param {string} importPath - Where the application's files are.
   * @param {string} wsURL - The library's socket.
   * @param {string} [devModeName] - The banner the developer build puts in
   *   the border (`app/borderEntity.js`); undefined in a production build.
   */
  constructor(platform, importPath, wsURL, devModeName) {
    super(platform, 'bodyApp', importPath, wsURL);
    this.id = 'MainApp';
    this.version = Version;
    this.devModeName = devModeName;

    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      // ★ the samples of the volume dialogs are kept here, whichever model is up when the worker answers
      // (the menu asks for them, the SOUNDS / MUSIC screen may be the one listening — `AudioManager.askSamples`)
      var data = event.data || {};
      if (data.message === 'sample' && this.audioManager && data.frames && data.frames.length && data.kind in this.audioManager.sample) {
        this.audioManager.sample[data.kind] = data.frames;
      }
      if (this.model && this.model.handleWorkerMessage) {
        this.model.handleWorkerMessage(event);
      }
    };
    // a worker that dies says nothing by itself
    this.worker.onerror = (event) => {
      console.error('gameWorker: '+event.message+' ('+event.filename+':'+event.lineno+')');
    };

    /**
     * ★ The seed of the world's random source — what the remake puts where
     * the original reads CIA 1 timer A (`$DC04`, 18 places,
     * `sources/docs/hw_notes.md`). Never `Math.random()`: taken from the
     * clock once per game, pinned by `$devMode` or `?devSeed=` so that a run
     * can be repeated.
     */
    this.gameSeed = this.devSeed() || 1;

    /**
     * ★ M6: the sound — one bus, `sid`, the library's model of the 6581 in a
     * worklet driven by the register writes the worker reports frame by frame
     * (`app/audioManager.js`, R-044). The menu is silent; the game opens the
     * bus behind the user's gesture (R-024).
     */
    this.audioManager = new AudioManager(this);
    /**
     * What the pause panel switched off, the shape of `manicminer`
     * (`PauseGameEntity`): SOUNDS and MUSIC, kept for the session. Both
     * play on the one `sid` bus, so the switch is the gain of the role
     * (`AudioManager.roleGain`), not a muted bus.
     */
    this.muted = {sounds: false, music: false};

    this.fonts = {};
    /** the character ROM, for the menu and for ABOUT */
    this.fonts.c64Fonts8x8 = new C64Fonts8x8(this, false);
    /** the same set with the glyphs trimmed to their widths, for the remake's own lines (the menu's author line) */
    this.fonts.c64Fonts8x8Proportional = new C64Fonts8x8(this, true);
    /** the ROM's second set, lower case included: the player name's input and keyboard (C64PlayerNameEntity) */
    this.fonts.c64Fonts8x8Lower = new C64Fonts8x8(this, false, 1);
    this.fonts.c64Fonts8x8LowerProportional = new C64Fonts8x8(this, true, 1);
    /** ★ the original's own font — the title screen's character set — for the menu and the about screen (`app/rtypeFonts8x8.js`) */
    this.fonts.rtype = new RTypeFonts8x8(this, false);
    this.fonts.rtypeProportional = new RTypeFonts8x8(this, true);
    /** the library's small font, for the panels the remake adds */
    this.fonts.fonts5x5 = new Fonts5x5(this);
    /** the library's tiny font, the labels of the on-screen keyboard's wide keys (PlayerNameModel) */
    this.fonts.fonts3x3 = new Fonts3x3(this);
    // the developer banner is `◢◤ ◢◤ … DEVELOPER MODE … ◢◤ ◢◤`; the core font is ASCII only
    this.fonts.fonts5x5.addGlyphs({
      '◢': {width: 4, data: [[4,0,1,1], [3,1,2,1], [2,2,3,1], [1,3,4,1], [0,4,5,1]]},
      '◤': {width: 4, data: [[0,0,5,1], [0,1,4,1], [0,2,3,1], [0,3,2,1], [0,4,1,1]]}
    });

    /**
     * The controls SETTINGS offers (SettingsEntity, the shape of Boulder
     * Dash): the keyboard actions the game reads (`GameModel.joystickOf`,
     * `pushInput`), the gamepad's event names, and the touchscreen — the
     * stick is one half of the picture, fire (with the Force's space bar in
     * its top quarter) the other; which half is which is the choice here.
     */
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'UP'},
          {action: 'down', label: 'DOWN'},
          {action: 'fire', label: 'FIRE'},
          {action: 'force', label: 'FORCE'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'RIGHT', eventKey: 'GamepadRight'},
          {action: 'up', label: 'UP', eventKey: 'GamepadUp'},
          {action: 'down', label: 'DOWN', eventKey: 'GamepadDown'},
          {action: 'fire', label: 'FIRE', eventKey: 'GamepadFire'},
          {action: 'force', label: 'FORCE', eventKey: 'GamepadForce'},
          {action: 'ok', label: 'OK', eventKey: 'GamepadOK'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      touchscreen: {
        device: 'touchscreen',
        types: {
          keys: ['rightButton', 'leftButton'],
          rightButton: {
            left: {half: 'stick', sprite: 'stick'},
            right: {half: 'button', sprite: 'button'}
          },
          leftButton: {
            left: {half: 'button', sprite: 'button'},
            right: {half: 'stick', sprite: 'stick'}
          }
        },
        icons: {
          stick: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          button: {
            width: 39, height: 23, frames: 1, directions: 1,
            sprite: [[
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------##########--------------',
              '-------------##############------------',
              '------------################-----------',
              '-----------##################----------',
              '----------####################---------',
              '----------####################---------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '----------####################---------',
              '----------####################---------',
              '-----------##################----------',
              '------------################-----------',
              '-------------##############------------',
              '---------------##########--------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------'
            ]]
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      mouse: {enable: false},
      gamepads: this.getControls('gamepads'),
      touchscreen: this.getControls('touchscreen')
    };

    /**
     * ★ The look of the dialogs (R-056, `C64DialogProperties`): the screens
     * SOUNDS, MUSIC, SETTINGS and PLAYER NAME are models of their own like
     * ABOUT (operator 2026-10-20), black with cyan text, PLAY SAMPLE black on
     * light red, CLOSE as the about screen's (black on cyan), the presets green and the steps blue with white text as Manic
     * Miner has them. The wait-for-a-gesture dialog is the one window left:
     * cyan frame on black.
     */
    this.dialogProperties = C64DialogProperties.merge({
      frameColor: C64Color.color(3),
      titleColor: C64Color.color(3),
      bkColor: C64Color.color(0),
      theme: {
        labelFont: 'rtype',                 // the labels (CHANGE VOLUME FOR GAME …) in the original's font, as the about text
        penColor: C64Color.color(3),
        valueColor: C64Color.color(15),
        buttonPenColor: C64Color.color(0),
        buttonColor: C64Color.color(10),           // PLAY SAMPLE light red
        buttonHoverColor: C64Color.color(2),
        buttonClickColor: C64Color.color(12),
        closeButtonColor: C64Color.color(3),
        okButtonColor: C64Color.color(5),
        okButtonPenColor: C64Color.color(1),
        stepButtonColor: C64Color.color(6),
        stepButtonPenColor: C64Color.color(1),
        dangerButtonColor: C64Color.color(2),
        selectionColor: C64Color.color(3),
        selectionPenColor: C64Color.color(0),
        selectionHoverColor: C64Color.color(1),
        selectionClickColor: C64Color.color(12),
        hoverColor: '#ffffff1e',
        clickColor: '#ffffff2e',
        separatorColor: C64Color.color(1),      // the line between the device list and the options white
        iconColor: C64Color.color(3),
        dropdownArrowColor: C64Color.color(15),   // the arrow that opens the gamepad list light grey, as the values (operator 2026-10-24)
        sliderColor: C64Color.color(3),
        cursorColor: C64Color.color(1),
        warningColor: C64Color.color(10),
        inputPenColor: C64Color.color(0),
        inputBkColor: C64Color.color(3),
        keyboardButtonsPenColor: C64Color.color(0),
        keyboardButtonsBkColor: C64Color.color(15),
        keyboardButtonsShiftColor: C64Color.color(12)
      },
      // the remap over the whole 288 x 128 of the settings screen under the logo and the heading, in the library's
      // window: cyan frame and title bar with the title black on it, black panel, the rows cyan with light grey
      // values, the awaited row black on cyan, SKIP and CLOSE as the settings screen's CHANGE and CLOSE (black on
      // light red, black on cyan). The title, the actions and the chosen keys print in the original's font
      // (`RTypeFonts8x8` — the arrows of the cursor keys and the cursor block are its own glyphs, 8 px like the
      // ROM's, so the layout holds); SKIP and CLOSE stay in the machine's font as the settings screen's buttons.
      // A nested dialog takes nothing from the top-level `theme` — the fonts and colours are its own; the gamepad
      // list as the C64 defaults
      remapKeys: {                      // the size: the settings contents (DialogProperties)
        fonts: 'rtype',
        frameColor: C64Color.color(3), titleColor: C64Color.color(0), bkColor: C64Color.color(0),
        theme: {
          labelFont: 'rtype',
          penColor: C64Color.color(3),
          valueColor: C64Color.color(15),
          buttonPenColor: C64Color.color(0),
          dangerButtonColor: C64Color.color(10),
          buttonHoverColor: C64Color.color(2),
          buttonClickColor: C64Color.color(12),
          closeButtonColor: C64Color.color(3),
          selectionColor: C64Color.color(3),
          selectionPenColor: C64Color.color(0),
          selectionHoverColor: C64Color.color(1),
          selectionClickColor: C64Color.color(12),
          hoverColor: '#ffffff1e',
          clickColor: '#ffffff2e'
        }
      },
      selectingGamepad: {frameColor: C64Color.color(3), bkColor: C64Color.color(0)},
      waitForAudioEvent: {
        frameColor: C64Color.color(3),
        bkColor: C64Color.color(0),
        theme: {penColor: C64Color.color(3)}
      }
    });

    /** the row of the menu last chosen, so the menu comes back with its bar on it (`MenuModel`) */
    this.menuSelection = 0;
    /** the player's name for the hall of fame (R-049), the cookie of the siblings (PLAYER NAME in the menu) */
    this.playerName = Tool.readCookie('playerName', '');
    /** the data of the original, fetched once (`appData.db`, as Booty does it) */
    this.fetchDataId = '';
    this.loadAppData();

    this.setModel('BootModel');
  } // constructor

  /**
   * The configuration of a control device: the defaults, with what SETTINGS
   * kept in the cookies over them (the shape of the siblings). The keyboard
   * is the arrows, space for fire (★ the operator's choice: `Z` fires too,
   * `S` is the original's space bar — the Force; the pause is Escape and the
   * pause panel, not a binding, `GameModel`), a gamepad its configured events, the
   * touchscreen which half is the stick.
   * @param {string} device - 'keyboard', 'touchscreen' or 'gamepads'.
   * @returns {Object} The configuration.
   */
  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        result = {left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', fire: ' ', force: 'S'};
        break;
      case 'touchscreen':
        result = {supported: false, type: 'rightButton'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  /**
   * The data of the original — `data/*.json` in one answer of `db/appData.php`
   * — into localStorage, section by section, where the models read them with
   * `loadDataFile()`. One request: `fetchData` answers only the request it
   * made last, so the files cannot be in flight together.
   */
  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 5000);
    }
  } // loadAppData

  /**
   * @param {Object} data - `{url, source, data}` with a section a file.
   */
  setData(data) {
    var sections = (data && data.data) || {};
    Object.keys(sections).forEach((key) => {
      if (key !== 'hiScore' && sections[key] !== null) {
        this.saveDataToStorage(key, sections[key]);
      }
    });
    if (sections.title) {
      // the original's font is built from the title's character set
      this.fonts.rtype.build(sections.title);
      this.fonts.rtypeProportional.build(sections.title);
    }
    if (this.model && this.model.handleAppData) {
      this.model.handleAppData();
    }
  } // setData

  /**
   * @param {Error} error - The request failed; what is in storage stays.
   */
  errorData(error) {
    console.error('appData: '+(error && error.message ? error.message : error));
  } // errorData

  /**
   * The seed a developer build may pin: `?devSeed=` or `$devMode = ['seed' => N]`
   * (`Tool.devParam`, guarded by the library — nothing outside dev mode).
   * @returns {number} The seed, or 0 when nothing pins one.
   */
  devSeed() {
    var pinned = Number(Tool.devParam('devSeed', 0));
    return (Number.isFinite(pinned) && pinned > 0) ? (pinned & 0x7FFFFFFF) : 0;
  } // devSeed

  /**
   * The level a developer build starts in (`?devLevel=1`..`8`); 0 otherwise.
   * @returns {number} 1-8, or 0.
   */
  devLevel() {
    var asked = Number(Tool.devParam('devLevel', 0));
    return (Number.isInteger(asked) && asked >= 1 && asked <= 8) ? asked : 0;
  } // devLevel

  /**
   * Whether a developer build plays with the ship immortal (`?devImmortal=1`):
   * the harness patch `$319C` = RTS (`Ship.immortal`) switched on in the browser.
   * @returns {boolean}
   */
  devImmortal() {
    var asked = String(Tool.devParam('devImmortal', '0'));
    return asked !== '0' && asked !== 'false' && asked !== '';
  } // devImmortal

  /** A fresh seed for every game, unless `$devMode` pinned one. */
  newGameSeed() {
    var pinned = this.devSeed();
    this.gameSeed = pinned || ((Date.now() & 0x7FFFFFFF) || 1);
    return this.gameSeed;
  } // newGameSeed

  /**
   * Switches models: boot → menu → game; Escape in the game opens the pause
   * panel, whose EXIT goes back to the menu.
   * @param {string} model - 'BootModel', 'MenuModel', 'GameModel', 'AboutModel', 'VolumeModel', 'SettingsModel', 'PlayerNameModel', 'LoadingPictureModel', 'GameOverModel' or 'GameExitModel'.
   * @param {Object} [options] - What the model is opened with.
   */
  setModel(model, options) {
    var needResizeApp = false;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'BootModel':
        this.model = new C64BootModel(this, {
          nextModel: 'MenuModel',
          commands: [
            // ★ SHIFT+RUN/STOP on the machine; the KERNAL's lines for a tape
            {command: 'LOAD', output: ['', 'PRESS PLAY ON TAPE', 'OK', '', 'SEARCHING', 'FOUND R-TYPE', 'LOADING'], ready: true},
            {command: 'RUN'}
          ]
        });
        break;
      case 'MenuModel':
        this.model = new MenuModel(this);
        break;
      case 'GameModel':
        this.model = new GameModel(this, options);
        break;
      case 'AboutModel':
        this.model = new AboutModel(this);
        break;
      case 'VolumeModel':
        this.model = new VolumeModel(this, options);
        break;
      case 'SettingsModel':
        this.model = new SettingsModel(this);
        break;
      case 'PlayerNameModel':
        this.model = new PlayerNameModel(this, options);
        break;
      case 'LoadingPictureModel':
        this.model = new LoadingPictureModel(this);
        break;
      case 'GameOverModel':
        this.model = new GameOverModel(this, options);
        break;
      case 'GameExitModel':
        // R-049: a game left from the pause counts as ended — its score goes to the hall of fame
        this.model = new GameOverModel(this, this.lastGame || {});
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

} // MainApp
