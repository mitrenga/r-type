const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { C64TextModeEntity } = await import('./svision/js/platform/canvas2D/c64/c64TextModeEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { LevelLoader } = await import('./levelLoader.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
// begin code

/**
 * A game of R-Type — **the whole game**, built from the original's data by
 * the original's code: the worker holds the map, the screen and the colour
 * RAM, steps the scroll (`app/levelScroll.js`), runs the ship, its weapons
 * and the panel (`app/ship.js`), the enemies, the multiplexer and the
 * bosses (`app/enemies.js`, `app/levelCode.js`) and, from M5, the main loop
 * around the level (`app/gameRules.js`): READY with fire, a life lost and
 * the restart from the checkpoint, the level's end and the next level, GAME
 * OVER. Every frame this model puts its memory into a {@link C64TextRAM}
 * with the raster splits of the interrupt chain — or, when the chain is off
 * (READY, the sequence after a level), the whole screen in the panel set —
 * and the sprites into a `C64Sprites` (`app/levelLoader.js`). Measured by
 * `tools/matchlevels.mjs`, `matchship.mjs`, `matchenemies.mjs` and
 * `matchrules.mjs` against the memory of the running original.
 *
 * ★ Where the original waits for the tape (PLEASE REWIND TAPE after GAME
 * OVER) or resets the machine (after the ending), the remake goes to its
 * end-of-game screen with the local hall of fame (`app/gameOverModel.js`,
 * R-049; `ZADANI.md` §10). The level to start in is `?devLevel=` in a
 * developer build, 1 otherwise; `?devImmortal=1` keeps the ship alive there. ★ Opened with `{continue: true}` from that
 * screen (CONTINUE, `ZADANI.md` §10.7) the model does not found a new
 * world: the worker still holds the game at its rewind screen and goes on
 * from the checkpoint with the score zeroed (`continue` message).
 *
 * ★ Nothing is drawn: the sets, the blocks, the colours and the panel come
 * from the tape (`tools/dump*.py`); the recorded frame of M1
 * (`data/screen.json`, `app/screenLoader.js`) stays as the pixel-level
 * measurement of the composition (`tools/matchscreen.mjs`).
 *
 * ★ **R-037**: the picture is drawn on the worker's `frame` message; the
 * model's loop draws only when no frame came (pause, modal, a stalled
 * worker). ★ **R-045**: the dev counter is `drawn/messages/ticks FPS`.
 *
 * The keyboard, a gamepad and the touchscreen make **one joystick byte**
 * (`$DC00`, port 2, active low) and the space bar, which go to the worker;
 * from M3 the original's step reads them. Escape — or the cross in the
 * border — stops the worker and puts up the pause panel; the original's own
 * pause (F7, fire to go on, `$0E96`) is the game's and comes with its code.
 */
export class GameModel extends AbstractModel {

  constructor(app, options) {
    super(app);
    this.id = 'GameModel';
    this.options = options || {};
    /** whether the pause panel is up; the worker is stopped while it is */
    this.paused = false;
    /** R-037: raised by the loop, dropped by the frame handler */
    this.needDraw = true;
    /** R-045: drawn / messages / ticks */
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
    /** ★ the seed of the world's random source, fresh for every game */
    this.seed = app.newGameSeed();
    /** the keys, buttons and touches that are down */
    this.keys = {};
    /** the joystick byte last sent: port 2, active low */
    this.joystick = 0x7F;
    this.space = false;
    this.f7 = false;
    /** the touch that is the stick: where it started and where it is */
    this.stick = null;
    this.screen = null;
    this.playing = false;
    /** the level's data and sets, once the four files are in */
    this.loader = null;
    this.files = {};
    /** the level to start in: `?devLevel=` in a developer build, else 1 */
    this.level = (this.options && this.options.level) || app.devLevel() || 1;
    /** the ship cannot die: `?devImmortal=1` in a developer build (the harness patch `$319C`) */
    this.immortal = app.devImmortal();
    /** the last frame's numbers, for the end of the game */
    this.last = {score: 0, level: this.level, frame: 0};
    this.over = false;
  } // constructor

  /** the dead zone of the touch stick, in picture pixels */
  static get STICK_DEAD() { return 6; }

  newBorderEntity() {
    return new BorderEntity(true, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();
    this.screen = new C64TextModeEntity(this.desktopEntity, 0, 0,
      this.desktopWidth, this.desktopHeight, this.app.fonts.c64Fonts8x8);
    this.desktopEntity.addEntity(this.screen);
    this.screen.textRAM.setBackground(0).showCursor(false);
    this.screen.textRAM.clear(12);
    this.desktopEntity.bkColor = C64Color.color(0);
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = C64Color.color(0);
      this.showTouchIcons();
    }
    this.handleAppData();
  } // init

  /**
   * The data of the original out of localStorage (`appData.db`, fetched once
   * by the application); when the four files are there, the level goes to
   * the worker and the world starts. Called again by the application when
   * the data arrive after the model opened.
   */
  handleAppData() {
    if (this.loader) { return; }
    var names = ['levels', 'charsets', 'texts', 'global', 'sprites', 'ship', 'enemies', 'music'];
    for (var i = 0; i < names.length; i++) {
      this.files[names[i]] = this.loadDataFile(names[i]);
      if (!this.files[names[i]]) { return; }
    }
    this.loader = new LevelLoader(this.files);
    this.startPlaying();
  } // handleAppData

  /**
   * A frame from the worker: its memory composed into the machine's picture.
   * @param {Object} frame - The `frame` message with `screen`, `color`, `fine`.
   */
  showFrame(frame) {
    if (!this.loader || !frame.screen) { return; }
    var picture = this.loader.compose(frame.level || this.level, frame);
    this.screen.textRAM = picture.textRAM;
    this.screen.setFont(picture.font);
    this.screen.setSprites(picture.sprites);
    this.screen.paintedVersion = -1;
  } // showFrame

  /**
   * Starts the world's clock in the worker, with a fresh seed and the
   * level's data — the worker builds the map itself.
   */
  startPlaying() {
    // ★ M6: the `sid` bus opens **here**, behind the user's gesture (R-024): the menu is silent and the
    // browser plays nothing without one; the chip model in the worklet gets the worker's writes from now on
    this.sendEvent(0, {id: 'openAudioBus', bus: 'sid', options: {}});
    if (this.options.continue) {
      // ★ the continue: the world of the game just lost goes on (`GameRules.continueGame`); should the
      // worker have nothing to go on with (`continueFailed`), a new game is founded instead
      this.options.continue = false;
      this.sendWorkerMessage({message: 'continue'});
      this.sendWorkerMessage({message: 'start'});
      this.playing = true;
      return;
    }
    this.sendWorkerMessage({message: 'init', seed: this.seed, level: this.level, immortal: this.immortal, levels: this.files.levels.levels,
                            panel: {screen: Array.from(this.loader.panel.screen), color: Array.from(this.loader.panel.color)},
                            ship: this.files.ship, sprites: this.files.sprites, enemies: this.files.enemies, charsets: this.files.charsets,
                            music: this.files.music});
    this.sendWorkerMessage({message: 'start'});
    this.playing = true;
  } // startPlaying

  /**
   * @param {MessageEvent} event - From the worker.
   */
  handleWorkerMessage(event) {
    var data = event.data || {};
    if (data.message === 'continueFailed') {
      this.sendWorkerMessage({message: 'stop'});
      this.playing = false;
      this.startPlaying();
      return;
    }
    if (data.message === 'frame') {
      // R-037: drawn on the message — and heard on it (M6)
      this.showFrame(data);
      this.hearFrame(data);
      this.fps.workerFrames++;
      if (this.fps.lastFrame !== false) { this.fps.ticks += data.frame-this.fps.lastFrame; }
      this.fps.lastFrame = data.frame;
      this.drawModel();
      this.needDraw = false;
      if (data.score !== undefined) { this.last = {score: data.score, level: data.level, frame: data.frame, state: data.state}; }
      // ★ the original waits for the tape (or resets): the remake's end of the game
      if (data.over && !this.over) {
        this.over = true;
        this.playing = false;
        this.app.setModel('GameOverModel', {score: data.score, level: data.level, frames: data.frame, ended: data.state, canContinue: !!data.canContinue});
      }
    }
  } // handleWorkerMessage

  /**
   * ★ M6: the sound of a frame — what the level's player wrote into
   * `$D400`-`$D418` this frame (`frame.sid`, `app/sidPlayer.js`) goes to the
   * chip model in the worklet with the frame's number, so the writes keep
   * their place in the frame and the audio thread keeps its own clock
   * (`app/audioManager.js`, R-040/R-044).
   * @param {Object} data - The `frame` message.
   */
  hearFrame(data) {
    if (!this.app.audioManager || (!data.sid && !data.sidRoles)) { return; }
    this.app.audioManager.writeFrame(data.frame, data.sid, data.sidRoles);
  } // hearFrame

  /**
   * R-045: `drawn/messages/ticks FPS` in the border of a developer build.
   * @param {number} timestamp - What the animation loop was given.
   */
  updateFps(timestamp) {
    if (!this.borderEntity || !this.borderEntity.fpsEntity) { return; }
    this.fps.frames++;
    if (this.fps.since === false) { this.fps.since = timestamp; return; }
    var elapsed = timestamp-this.fps.since;
    if (elapsed < 1000) { return; }
    this.borderEntity.setFps(Math.round(this.fps.frames*1000/elapsed)+'/'
                             +Math.round(this.fps.workerFrames*1000/elapsed)+'/'
                             +Math.round(this.fps.ticks*1000/elapsed)+' FPS');
    this.fps.frames = 0;
    this.fps.workerFrames = 0;
    this.fps.ticks = 0;
    this.fps.since = timestamp;
  } // updateFps

  /**
   * R-037: the loop draws only when no frame came, and raises the flag.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.updateFps(timestamp);
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

  /**
   * Whether a keyboard action of SETTINGS (`app.controls.keyboard`) is down.
   * @param {string} action - 'left' … 'pause'.
   * @returns {boolean}
   */
  keyDown(action) {
    var key = this.app.controls.keyboard[action];
    return !!this.keys[(typeof key === 'string' && key.length === 1) ? key.toUpperCase() : key];
  } // keyDown

  /**
   * The joystick byte out of what is down: the keys of SETTINGS (the arrows
   * and space unless remapped; Z fires too), a gamepad configured in SETTINGS
   * by its events, one not configured by its d-pad, stick and button 0, and
   * the touch stick and fire.
   * @returns {number} `$DC00` as port 2 gives it, active low.
   */
  joystickOf() {
    var k = this.keys;
    var up = this.keyDown('up') || k.GamepadUp || k.B12 || k['A1<'];
    var down = this.keyDown('down') || k.GamepadDown || k.B13 || k['A1>'];
    var left = this.keyDown('left') || k.GamepadLeft || k.B14 || k['A0<'];
    var right = this.keyDown('right') || k.GamepadRight || k.B15 || k['A0>'];
    var fire = this.keyDown('fire') || k.Z || k.GamepadFire || k.B0 || k.TouchFire;
    if (this.stick) {
      var dx = this.stick.x-this.stick.x0, dy = this.stick.y-this.stick.y0;
      if (dy < -GameModel.STICK_DEAD) { up = true; }
      if (dy > GameModel.STICK_DEAD) { down = true; }
      if (dx < -GameModel.STICK_DEAD) { left = true; }
      if (dx > GameModel.STICK_DEAD) { right = true; }
    }
    var value = 0x7F;
    if (up) { value &= ~0x01; }
    if (down) { value &= ~0x02; }
    if (left) { value &= ~0x04; }
    if (right) { value &= ~0x08; }
    if (fire) { value &= ~0x10; }
    return value & 0xFF;
  } // joystickOf

  /**
   * Sends the joystick byte and the original's space bar when they changed.
   * ★ The original's space bar detaches the Force and calls it back
   * (`$2A2A`, `$2AB0`); here it is the FORCE key of SETTINGS (**S** unless
   * remapped), the gamepad's FORCE event or B1, or the touch.
   */
  pushInput() {
    var value = this.joystickOf();
    var k = this.keys;
    var space = !!(this.keyDown('force') || k.GamepadForce || k.B1 || k.TouchSpace);
    // ★ F7 is the original's pause ($0E96) — fire goes on. The remake does not use it at all (operator 2026-10-20):
    // its pause is Escape and the panel, so the worker is told `f7` false for good and the original's code stays
    // as it is for the tools
    var f7 = false;
    if (value === this.joystick && space === this.space && f7 === this.f7) { return; }
    this.joystick = value;
    this.space = space;
    this.f7 = f7;
    this.sendWorkerMessage({message: 'input', joystick: value, space: space, f7: f7});
  } // pushInput

  /**
   * ★ The touchscreen: one half of the picture is a stick — where the
   * finger went down is the centre, and moving it away pushes the stick;
   * the other half is fire, its top quarter the space bar. The stick is on
   * the right (as the siblings have it) unless SETTINGS says `rightButton`
   * (`app.controls.touchscreen`).
   * @param {Object} event - A `Touch` event with `x`, `y` and `identifier`.
   */
  touch(event) {
    var w = this.desktopEntity.width, h = this.desktopEntity.height;
    var x = event.x-this.borderWidth, y = event.y-this.borderHeight;
    if (event.id === 'keyPress') {
      // ★ the touch is bound to its half of the television: the input manager sends `keyMove` only for
      // a touch bound to an entity (`InputEventsManager.eventTouchMove`) — without this the stick never moved
      var left = x < w/2;
      var half = this.borderEntity && (left ? this.borderEntity.leftControlEntity : this.borderEntity.rightControlEntity);
      this.app.inputEventsManager.touchesMap[event.identifier] = half || this.desktopEntity;
      var stickSide = (this.app.controls.touchscreen.type === 'rightButton') ? left : !left;
      if (stickSide) {
        this.stick = {id: event.identifier, x0: x, y0: y, x: x, y: y};
      } else if (y < h/4) {
        this.keys.TouchSpace = event.identifier;
      } else {
        this.keys.TouchFire = event.identifier;
      }
    } else if (event.id === 'keyMove') {
      if (this.stick && this.stick.id === event.identifier) { this.stick.x = x; this.stick.y = y; }
    } else {
      if (this.stick && this.stick.id === event.identifier) { this.stick = null; }
      if (this.keys.TouchFire === event.identifier) { delete this.keys.TouchFire; }
      if (this.keys.TouchSpace === event.identifier) { delete this.keys.TouchSpace; }
    }
    this.pushInput();
  } // touch

  /**
   * The icons of the two halves into the border (`controlsOptions.touchscreen.icons`
   * by the `sprite` of each half of the chosen `type`), as the siblings have
   * them; the border draws them only where there is room outside the picture.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity || !this.borderEntity.setGameControlIcons) { return; }
    var ts = this.app.controlsOptions.touchscreen;
    var halves = ts.types[this.app.controls.touchscreen.type] || ts.types[ts.types.keys[0]];
    this.borderEntity.setGameControlIcons(ts.icons[halves.left.sprite], ts.icons[halves.right.sprite]);
  } // showTouchIcons

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    if (event.id === 'continueGame') {
      this.resumeGame();
      return true;
    }
    if (event.id === 'blurWindow') {
      this.pauseGame();
      return true;
    }
    if (event.key === 'Touch') {
      this.touch(event);
      return true;
    }
    // ★ a letter comes from the browser as it was typed (`a`, `A` with Shift), SETTINGS keeps it upper case
    // (RemapKeysEntity): the siblings' rule, a single character is kept upper case here too
    var key = (typeof event.key === 'string' && event.key.length === 1) ? event.key.toUpperCase() : event.key;
    if (event.id === 'keyRelease') {
      delete this.keys[key];
      this.pushInput();
      return true;
    }
    if (event.id !== 'keyPress') {
      return false;
    }
    if (key === 'Escape') {
      this.pauseGame();
      return true;
    }
    this.keys[key] = true;
    this.pushInput();
    return true;
  } // handleEvent

  /**
   * Stops the world and puts the panel up. ★ The worker has to be told: its
   * clock is its own, and a panel over a running world would hide it.
   */
  pauseGame() {
    if (this.paused) { return; }
    this.paused = true;
    if (this.playing) {
      this.sendWorkerMessage({message: 'stop'});
      // ★ M6: and the chip with the world — the last write may have left a gate open, and a tone hanging
      // on it would play on; `pause`, not `stop`: `stop` would reset the registers (Impossible Mission, R-044)
      if (this.app.audioManager) { this.sendEvent(0, {id: 'pauseAllAudioBuses'}); }
      this.keys = {};
      this.stick = null;
      this.pushInput();
    }
    // R-049: EXIT GAME ends the game — through the end-of-game screen, which keeps the score;
    // four rows the way `manicminer` has them (RESUME GAME, SOUNDS, MUSIC, EXIT GAME): a 12 px heading,
    // the menu's 8 px top margin and four rows at MenuEntity's 16 px pitch, so 88 tall; on the
    // 8x8 character grid — columns 10–29 and rows 7–17 of the 320 x 200 picture, centred
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity,
      80, 56, 160, 88, 'PAUSE GAME', 'GameExitModel'));
  } // pauseGame

  /** The panel's RESUME (or Escape again): the worker ticks on. */
  resumeGame() {
    if (!this.paused) { return; }
    this.paused = false;
    if (this.playing) {
      this.sendWorkerMessage({message: 'start'});
      if (this.app.audioManager) { this.sendEvent(0, {id: 'continueAllAudioBuses'}); }
    }
  } // resumeGame

  /**
   * ★ Whichever way the model is left, the world is stopped here: the
   * worker hangs on the application and would tick into nobody.
   */
  shutdown() {
    if (this.playing) {
      this.sendWorkerMessage({message: 'stop'});
      // M6: stopped, not closed — the menu closes the buses (R-024), so the chip is dropped with its registers there
      if (this.app.audioManager) { this.sendEvent(0, {id: 'stopAllAudioBuses'}); }
      this.playing = false;
    }
    // what the end-of-game screen shows when the game was left early (R-049)
    this.app.lastGame = {score: this.last.score, level: this.last.level, frames: this.last.frame, ended: 'exit'};
    super.shutdown();
  } // shutdown

  /**
   * @param {Object} message - To the application's worker.
   */
  sendWorkerMessage(message) {
    if (this.app.worker) {
      this.app.worker.postMessage(message);
    }
  } // sendWorkerMessage

} // GameModel
