const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { C64TextModeEntity } = await import('./svision/js/platform/canvas2D/c64/c64TextModeEntity.js?ver='+window.srcVersion);
const { C64Color } = await import('./svision/js/platform/canvas2D/c64/c64Color.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { DialogEntity } = await import('./svision/js/platform/canvas2D/dialogs/dialogEntity.js?ver='+window.srcVersion);
const { WaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/dialogs/waitForAudioEventEntity.js?ver='+window.srcVersion);
// begin code

/**
 * What the project is and how far it has got, with the buttons of the
 * siblings' about panels (Booty, Manic Miner, Jet Set Willy): MORE INFO
 * opens the /about page, CLOSE (Escape, the gamepad's exit) goes back to
 * the menu — and the heading hides the same two screens behind it: five
 * clicks on it show the game statistics (`stats.db`; the project has no
 * database yet, so the answer is the siblings' "not available"), five more
 * the system information, five more the about text again.
 */
export class AboutModel extends AbstractModel {

  /** the rows of the screen the texts take (under the heading, over the buttons) */
  static get FIRST_ROW() { return 4; }
  static get ROWS() { return 18; }

  constructor(app) {
    super(app);
    this.id = 'AboutModel';
    this.screen = null;
    this.heading = null;
    this.clickCounter = 0;
    this.tuneAsked = false;
    this.tunePlayed = false;
    this.busOpened = false;
    this.tuneRetries = 0;
    this.gestureAsked = false;
    /** where the gesture dialog sits: as the menu's (`MainApp.dialogProperties`) */
    this.dialogProperties = app.dialogProperties;
    this.statsText = 'ERROR:\nSTATISTICS DATA NOT AVAILABLE!';
    // the about text, the siblings' shape (Booty, Manic Miner): paragraphs split by '\n', wrapped to the screen
    this.aboutText = 'R-TYPE IS A REMAKE OF THE 1988 COMMODORE 64 CONVERSION OF IREM\'S ARCADE CLASSIC '+
                     'BY MANFRED TRENZ AND ANDREAS ESCHER - RAINBOW ARTS.\n'+
                     'THE R-9 FIGHTER FLIES INTO THE BYDO EMPIRE: EIGHT LEVELS, THE FORCE POD THAT SHIELDS '+
                     'THE SHIP AND FIRES THROUGH IT, THE CHARGED WAVE CANNON, AND A BOSS AT THE END OF EVERY LEVEL.\n'+
                     'IN THIS REMAKE YOU CAN ALSO CONTINUE FROM THE LEVEL WHERE YOUR LAST GAME ENDED. '+
                     'THE HIGH SCORES ARE KEPT IN THE HALL OF FAME.';
  } // constructor

  init() {
    super.init();
    // ★ the rows in the original's font: the title screen's character set, the ROM for what it lacks (`RTypeFonts8x8`)
    this.screen = new C64TextModeEntity(this.desktopEntity, 0, 0,
      this.desktopWidth, this.desktopHeight, this.app.fonts.rtype.charset());
    this.desktopEntity.addEntity(this.screen);
    var text = this.screen.textRAM;
    text.setBackground(0).showCursor(false);
    text.clear(15);
    this.desktopEntity.bkColor = C64Color.color(0);
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = C64Color.color(0);
    }
    // the heading is a button: the clicks on it count (Booty's title bar)
    this.heading = new ButtonEntity(this.desktopEntity, this.app.fonts.rtype, 0, 8, 320, 8, 'ABOUT', {id: 'clickLabel'}, [],
      C64Color.color(10), false, {align: 'center'});
    this.desktopEntity.addEntity(this.heading);
    // the hover and click colours resolved in init() are dropped, so the heading looks like plain text
    // and the five clicks stay a secret (the siblings do the same)
    this.heading.hoverColor = false;
    this.heading.clickColor = false;
    this.showAbout();
    // the buttons on the last rows: MORE INFO (Enter) and CLOSE (Escape), as Booty's about panel
    var font = this.app.fonts.c64Fonts8x8Proportional;
    this.desktopEntity.addEntity(new ButtonEntity(this.desktopEntity, font, 24, 176, 96, 14, 'MORE INFO', {id: 'openAboutURL'},
      ['Enter', 'GamepadOK'], C64Color.color(0), C64Color.color(15), {align: 'center', margin: 3}));
    this.desktopEntity.addEntity(new ButtonEntity(this.desktopEntity, font, 200, 176, 96, 14, 'CLOSE', {id: 'closeAbout'},
      ['Escape', 'GamepadExit'], C64Color.color(0), C64Color.color(3), {align: 'center', margin: 3}));
    this.fetchData('stats.db', false, {});
    this.playTitleTune();
  } // init

  /**
   * ★ The tune of the original's title screen, once (the operator's choice
   * 2026-10-20; ChipStream could repeat it): the worker renders it with the
   * title's player (`sample` of kind `title`, `app/gameWorker.js`, up to the
   * song's loop position), the audio manager keeps it, and the `title` bus
   * plays it at the MUSIC slider. Opened only behind the user's gesture (R-024): without one the
   * screen stays silent rather than asking.
   */
  playTitleTune() {
    var am = this.app.audioManager;
    if (!am || this.tunePlayed) { return; }
    if (!am.sample.title) {
      if (!this.tuneAsked && this.app.worker) {
        // from localStorage at once, or from the server when it is missing there (R-062)
        this.tuneAsked = true;
        this.loadDataFiles(['music'], (files) => {
          if (files && files.music && this.app.model === this) {
            this.app.worker.postMessage({message: 'sample', kind: 'title', music: files.music});
          } else {
            this.tuneAsked = false;
          }
        });
      }
    }
    // the bus is opened at once — its worklet loads meanwhile; the tune starts when both the bus and the
    // sample are here. ★ Without the browser's gesture for audio the screen asks for one the way START
    // GAME does (R-024, `ZXWaitForAudioEventEntity`), once; the gesture's event comes back as 'playTitleTune'
    if (!this.busOpened) {
      if (this.app.inputEventsManager.needEventForAudio()) {
        if (!this.gestureAsked && !this.desktopEntity.modalEntity) {
          this.gestureAsked = true;
          var p = this.dialogProperties;
          this.desktopEntity.addModalEntity(new DialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, false, p,
            (dialog) => new WaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'playTitleTune', p)));
        }
        return;
      }
      this.busOpened = true;
      this.sendEvent(0, {id: 'openAudioBus', bus: 'title', options: {}});
    }
    if (!am.sample.title) { return; }
    if (!('title' in am.buses) || !am.buses.title.busIsReady()) {
      if (this.tuneRetries++ < 100) { this.sendEvent(100, {id: 'playTitleTune'}); }   // up to 10 s for the worklet
      return;
    }
    this.tunePlayed = true;
    this.sendEvent(0, {id: 'playSound', sound: 'titleTune', bus: 'title', options: false});
  } // playTitleTune

  /**
   * @param {MessageEvent} event - From the worker: the title's sample.
   */
  handleWorkerMessage(event) {
    var data = event.data || {};
    if (data.message === 'sample' && data.kind === 'title' && this.app.audioManager && data.frames && data.frames.length) {
      this.app.audioManager.sample.title = data.frames;
      this.playTitleTune();
    }
  } // handleWorkerMessage

  /** The tune does not outlive the screen. */
  shutdown() {
    super.shutdown();
    if (this.app.audioManager) { this.app.audioManager.closeBus('title'); }
  } // shutdown

  /**
   * The text rows: cleared and written again, every line centred, a colour a line.
   * @param {Array<Array>} lines - `[[text, colour], …]`; a line over 40 characters is cut.
   */
  showLines(lines) {
    var text = this.screen.textRAM;
    for (var row = 0; row < AboutModel.ROWS; row++) {
      text.printAt(0, AboutModel.FIRST_ROW+row, ' '.repeat(40), 15);
      if (row < lines.length) {
        var line = String(lines[row][0]).slice(0, 40);
        text.printAt(Math.floor((40-line.length)/2), AboutModel.FIRST_ROW+row, line, lines[row][1]);
      }
    }
  } // showLines

  /**
   * A text wrapped to the screen: words up to `width` a row, a paragraph
   * ('\n') ends its row and leaves one empty.
   * @param {string} text - The text.
   * @param {number} width - Characters a row.
   * @returns {Array<string>} The rows.
   */
  static wrap(text, width) {
    var rows = [];
    text.split('\n').forEach((paragraph, i) => {
      if (i > 0) { rows.push(''); }
      var row = '';
      paragraph.split(' ').forEach((word) => {
        if (row.length && row.length+1+word.length > width) { rows.push(row); row = ''; }
        row += (row.length ? ' ' : '')+word;
      });
      rows.push(row);
    });
    return rows;
  } // wrap

  /** the colours of the paragraphs: light blue, light grey, light green */
  static get PARAGRAPH_COLORS() { return [14, 15, 13]; }

  showAbout() {
    this.heading.setText('ABOUT');
    var lines = [];
    this.aboutText.split('\n').forEach((paragraph, i) => {
      if (i > 0) { lines.push(['', 15]); }
      var colour = AboutModel.PARAGRAPH_COLORS[i%AboutModel.PARAGRAPH_COLORS.length];
      AboutModel.wrap(paragraph, 38).forEach((row) => lines.push([row, colour]));
    });
    this.showLines(lines);
  } // showAbout

  /**
   * The screens behind the heading, by the count of clicks on it (five a screen).
   */
  updateAbout() {
    switch (Math.floor(this.clickCounter/5)) {
      case 1:
        this.heading.setText('GAME STATS');
        this.showLines(this.statsText.split('\n').map((line) => [line, 15]));
        break;
      case 2:
        this.heading.setText('SYSTEM INFO');
        var ip = String(window.clientIP || '');
        var lines = [
          ['VERSION: '+this.app.version, 15],
          ['ELEMENT: '+this.app.element.clientWidth+' X '+this.app.element.clientHeight, 15],
          ['CANVAS: '+this.app.element.width+' X '+this.app.element.height, 15],
          ['RATIO: '+this.app.layout.ratio, 15]
        ];
        if (ip.indexOf(':') >= 0) { lines.push(['IP:', 15], [ip, 15]); } else { lines.push(['IP: '+ip, 15]); }
        this.showLines(lines);
        break;
      default:
        this.showAbout();
        break;
    }
  } // updateAbout

  /**
   * The statistics behind the heading, the shape Booty's `stats.db` answers.
   * @param {Object} data - `{url, source, data}`.
   */
  setData(data) {
    if (data && data.url === 'stats.db' && data.data && typeof data.data === 'object') {
      this.statsText = '';
      Object.entries(data.data).forEach(([periodKey, periodValue]) => {
        this.statsText += periodKey+': ['+Object.entries(periodValue).map(([key, value]) => key+':'+value).join(', ')+']\n';
      });
      this.statsText = this.statsText.trimEnd();
      if (this.clickCounter >= 5 && this.clickCounter < 10) { this.updateAbout(); }
      return;
    }
    super.setData(data);
  } // setData

  /**
   * No statistics (the project has no database): the siblings' text stays,
   * without the application's error panel.
   * @param {Error} error - The failed fetch.
   */
  errorData(error) {
    this.statsText = 'ERROR:\nSTATISTICS DATA NOT AVAILABLE!';
  } // errorData

  /**
   * The buttons' events: the /about page, back to the menu, the heading's clicks.
   * @param {Object} event - The library's event.
   * @returns {boolean} Whether it was taken.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'openAboutURL':
        window.location.href = 'about';
        return true;
      case 'closeAbout':
        this.app.setModel('MenuModel');
        return true;
      case 'playTitleTune':
        this.playTitleTune();
        return true;
      case 'clickLabel':
        this.clickCounter = this.clickCounter < 14 ? this.clickCounter+1 : 0;
        if (this.clickCounter%5 === 0) { this.updateAbout(); }
        return true;
      case 'resizeModel':
        if (this.clickCounter >= 10) { this.updateAbout(); }
        return false;
    }
    return false;
  } // handleEvent

  /**
   * R-037: a static screen redraws here.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.drawModel();
  } // loopModel

} // AboutModel
