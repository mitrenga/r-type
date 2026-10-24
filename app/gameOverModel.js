const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { DialogScreenModel } = await import('./dialogScreenModel.js?ver='+window.srcVersion);
// begin code

/**
 * The end of a game and the hall of fame — the remake's, a screen of the
 * menu like SOUNDS or SETTINGS: the logo of the title screen, the heading
 * HALL OF FAME in the original's font and the table under them
 * (HallOfFameEntity), CLOSE back to the menu.
 *
 * ★ The original has nothing of the kind: after the last life it shows GAME
 * OVER, then PLEASE REWIND TAPE and loads whatever the tape gives
 * (`sources/docs/disasm_notes.md` §13); the score lives in `$338B` until the
 * next `$0818` zeroes it, no high score is kept anywhere, and the ending
 * after level 8 (`E`) ends in a RESET. The remake keeps a hall of fame
 * (R-049: a game ended early counts too) in the database behind
 * `db/saveGame.php`, and shows the ten best **players** out of it —
 * `db/hallOfFame.php`, one row per name as Manic Miner's: the best score
 * and the level of that game.
 *
 * Opened with `{score, level, frames, ended, canContinue}` after a game — the
 * score goes to the database at once under the PLAYER NAME of the menu (the
 * game cannot start without one, `MenuModel.startGame`), so nothing is typed
 * here; a zero score is not saved — or with `{table: true}` from the menu to
 * look at the table.
 *
 * ★ **CONTINUE** (`ZADANI.md` §10.7, the remake's — the original has no
 * credits): after a GAME OVER past the start of level 1 (`canContinue`, the
 * worker's `GameRules.continuePoint`) a button on the left offers to go on
 * from the checkpoint the lost life would have gone back to, with the score
 * zeroed and three lives — as Manic Miner offers the last cave — for ten
 * seconds counted down on the button; then the offer is gone. The worker
 * still holds the game at its rewind screen (`GameModel` with
 * `{continue: true}`).
 */
export class GameOverModel extends DialogScreenModel {

  constructor(app, options) {
    // the heading: HALL OF FAME from the menu, GAME OVER (THE END after level 8) after a game
    var o = options || {};
    super(app, o.table ? 'HALL OF FAME' : (o.ended === 'ending' ? 'THE END' : 'GAME OVER'), true);
    this.id = 'GameOverModel';
    this.options = o;
  } // constructor

  newContentEntity(c) {
    return new HallOfFameEntity(this.desktopEntity, c.x, c.y, c.width, c.height, this.options, this.app.playerName);
  } // newContentEntity

} // GameOverModel

/**
 * The table under the logo and the heading (HALL OF FAME, or GAME OVER after
 * a game): the ten rows — the place, the
 * name as typed (the ROM's second set has the lower case), the score and
 * the level — with the row of the game just played highlighted, and CLOSE
 * (Enter, Escape, space, the gamepad) on the right under them as ABOUT has it.
 * ★ With `canContinue` a CONTINUE button on the left takes Enter and the
 * gamepad's OK from CLOSE while its ten seconds run (the count in the
 * button, Manic Miner's shape); at zero it goes and CLOSE has them back.
 * The game's own SCORE and LEVEL line is shown only when the table does not
 * carry the game — it did not make the ten, or the name's best is older. Without the
 * database (offline) the table says so, as Manic Miner's. Closes with
 * `destroy()`, which the screen turns into the menu (DialogScreenModel).
 */
export class HallOfFameEntity extends AbstractEntity {

  /** the rows of the table */
  static get SIZE() { return 10; }
  /** the width of the name column — what PLAYER NAME lets through */
  static get NAME_LENGTH() { return 15; }
  /** ★ how long CONTINUE is offered, in seconds (Manic Miner's) */
  static get CONTINUE_SECONDS() { return 10; }
  /** the keys of CLOSE: without CONTINUE, and beside it */
  static get CLOSE_KEYS() { return ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit']; }
  static get CLOSE_KEYS_BESIDE() { return ['Escape', ' ', 'GamepadExit']; }

  /**
   * @param {AbstractEntity} parentEntity - The desktop.
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {Object} options - `{score, level, ended}` of the game, or `{table: true}` for the table alone.
   * @param {string} playerName - PLAYER NAME of the menu, in its own case.
   */
  constructor(parentEntity, x, y, width, height, options, playerName) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'HallOfFameEntity';
    this.options = options || {};
    this.name = String(playerName || '').slice(0, HallOfFameEntity.NAME_LENGTH);
    this.font = null;
    /** where the rows start: under the game's score line, or right under the heading */
    this.top = this.options.table ? 8 : 16;
    /** the rows of `hallOfFame.db` on the screen */
    this.rowEntities = [];
    /** ★ CONTINUE, its count and when it began; null without the offer */
    this.closeEntity = null;
    this.continueEntity = null;
    this.countEntity = null;
    this.continueSince = false;
  } // constructor

  init() {
    super.init();
    this.font = this.app.fonts.c64Fonts8x8Lower;   // monospaced, both cases
    var o = this.options;
    // CLOSE on the right of the last rows, where the about screen has it (200, 176 of the picture), Manic Miner's keys (keyboard and gamepad)
    var offer = !!o.canContinue && !o.table && o.ended === 'rewind';
    this.closeEntity = new ButtonEntity(this, this.app.fonts.c64Fonts8x8Proportional, 200-this.x, 176-this.y, 96, 14, 'CLOSE', {id: 'closeHallOfFame'},
      offer ? HallOfFameEntity.CLOSE_KEYS_BESIDE : HallOfFameEntity.CLOSE_KEYS, C64Color.color(0), C64Color.color(3), {align: 'center', margin: 3});
    this.addEntity(this.closeEntity);
    if (offer) {
      // ★ CONTINUE on the left (24, 176), Enter and the gamepad's OK; the seconds left in the small font at its right edge
      this.continueEntity = new ButtonEntity(this, this.app.fonts.c64Fonts8x8Proportional, 24-this.x, 176-this.y, 112, 14, 'CONTINUE', {id: 'continueGame'},
        ['Enter', 'GamepadOK'], C64Color.color(0), C64Color.color(13), {align: 'left', leftMargin: 6, topMargin: 3});
      this.addEntity(this.continueEntity);
      this.countEntity = new TextEntity(this.continueEntity, this.app.fonts.fonts5x5, 112-20, 4, 16, 5, HallOfFameEntity.CONTINUE_SECONDS.toString(), C64Color.color(0), false, {align: 'right'});
      this.continueEntity.addEntity(this.countEntity);
    }
    if (!navigator.onLine) {
      this.showOfflineNotice();
    } else if (o.score && !o.table) {
      // the game first, the table when the game is in it (`setData`)
      this.fetchData('saveGame.db', false, {name: this.name || 'R-9', score: o.score, level: o.level || 1});
    } else {
      this.fetchData('hallOfFame.db', false, {});
    }
  } // init

  /**
   * The answers: `saveGame.db` brings the high score of the database and the
   * table is asked for; `hallOfFame.db` brings the table.
   * @param {Object} data - `{url, data}`.
   */
  setData(data) {
    if (data.url === 'saveGame.db') {
      if (data.data && typeof data.data.hiScore === 'number') { this.app.hiScore = data.data.hiScore; }
      this.fetchData('hallOfFame.db', false, {});
      return;
    }
    if (data.url === 'hallOfFame.db') {
      var rows = data.data || {};
      var table = [];
      for (var i = 0; i < Object.keys(rows).length && i < HallOfFameEntity.SIZE; i++) {
        table.push({name: String(rows[i].name || ''), score: Number(rows[i].score) || 0, level: Number(rows[i].level) || 1});
      }
      if (table.length) { this.app.hiScore = table[0].score; }
      this.showTable(table);
      return;
    }
    super.setData(data);
  } // setData

  /** No database (offline, or the project without one): the table says so. */
  errorData(error) {
    this.showOfflineNotice();
  } // errorData

  /**
   * Whether the row is the game just played: the name and the best score of
   * the name (the game can only raise it).
   * @param {Object} row - A row of the table.
   * @returns {boolean}
   */
  isMine(row) {
    var o = this.options;
    return !o.table && o.score && row.name === this.name && row.score === o.score;
  } // isMine

  /**
   * The rows: `NN. NAME............... SSSSSS  L8`, 30 columns centred.
   * @param {Array<Object>} table - `[{name, score, level}]`, best first.
   */
  showTable(table) {
    this.rowEntities.forEach((e) => e.destroy());
    this.rowEntities = [];
    // the game's own line only when the table does not show the game: it did not make the ten, or the name's best is an older game
    if (!this.options.table && !table.some((e) => this.isMine(e))) {
      this.showScoreLine();
    }
    var n = HallOfFameEntity.NAME_LENGTH;
    var x = this.tableX;
    for (var i = 0; i < HallOfFameEntity.SIZE; i++) {
      var e = table[i];
      var line = (i+1).toString().padStart(2, ' ')+'. ';
      line += e
        ? e.name.slice(0, n).padEnd(n, ' ')+' '+e.score.toString().padStart(6, '0')+'  L'+e.level
        : '.'.repeat(n)+' ......';
      var row = new TextEntity(this, this.font, x, this.top+i*8, 30*8, 8, line, C64Color.color(e ? (this.isMine(e) ? 7 : 15) : 11), false, {});
      this.rowEntities.push(row);
      this.addEntity(row);
    }
  } // showTable

  /** where the rows of the table start: 30 columns centred */
  get tableX() { return Math.floor((this.width-30*8)/2); }

  /**
   * The game just played under the heading, in yellow and in the columns of
   * the table: SCORE where the names are, its digits under the scores, the
   * level as the table has it (L1-L8) under the levels.
   */
  showScoreLine() {
    var o = this.options;
    var line = 'SCORE'.padEnd(HallOfFameEntity.NAME_LENGTH+1, ' ')+(o.score || 0).toString().padStart(6, '0')+'  L'+(o.level || 1);
    this.addEntity(new TextEntity(this, this.font, this.tableX+4*8, 0, line.length*8, 8, line, C64Color.color(7), false, {}));
  } // showScoreLine

  showOfflineNotice() {
    if (!this.options.table) { this.showScoreLine(); }
    this.addEntity(new TextEntity(this, this.font, 0, this.top+24, this.width, 8, 'SYSTEM OFFLINE', C64Color.color(2), false, {align: 'center'}));
    this.addEntity(new TextEntity(this, this.font, 0, this.top+40, this.width, 8, 'SCORES UNAVAILABLE', C64Color.color(2), false, {align: 'center'}));
  } // showOfflineNotice

  /**
   * ★ The count of CONTINUE: the seconds left on the button, and at zero the
   * offer withdrawn — the button goes and CLOSE takes Enter and OK back.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopEntity(timestamp) {
    super.loopEntity(timestamp);
    if (!this.continueEntity) { return; }
    if (this.continueSince === false) { this.continueSince = timestamp; }
    var left = HallOfFameEntity.CONTINUE_SECONDS-Math.floor((timestamp-this.continueSince)/1000);
    if (left > 0) {
      this.countEntity.setText(left.toString());
      return;
    }
    this.withdrawContinue();
  } // loopEntity

  /** CONTINUE gone, CLOSE with all its keys. */
  withdrawContinue() {
    if (!this.continueEntity) { return; }
    this.continueEntity.destroy();
    this.continueEntity = null;
    this.countEntity = null;
    this.closeEntity.hotKeys = HallOfFameEntity.CLOSE_KEYS;
  } // withdrawContinue

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    if (event.id === 'closeHallOfFame') {
      this.destroy();
      return true;
    }
    if (event.id === 'continueGame' && this.continueEntity) {
      // ★ the game goes on in the worker's world (`GameModel` with `continue`): no `destroy()` — that would be the menu
      this.app.setModel('GameModel', {continue: true});
      return true;
    }
    return false;
  } // handleEvent

} // HallOfFameEntity
