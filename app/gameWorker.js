// classic worker script (importScripts): no import, no export — R-001
// begin code

// The world of R-Type, ticking in its own thread: the clock, the joystick,
// **the level** scrolled by the original's code (`app/levelScroll.js`),
// **the ship and everything it fires** (`app/ship.js`), **the enemies, the
// waves, the multiplexer and the bosses** (`app/enemies.js`,
// `app/levelCode.js`) and, from M5, **the rules around the level**
// (`app/gameRules.js`: READY, the restart from the checkpoint, the level's
// end and the next level, GAME OVER). Every frame the main thread gets the
// memory the chip would read and how the chain would show it (`mode`).
//
// The version the application was started with rides on this worker's own
// URL; whoever is pulled in later gets it passed on, so that a browser does
// not keep an old copy of a file edited every day (dev mode serves `app/`
// file by file).
var workerVersion = (self.location && self.location.search) || '';
importScripts('levelScroll.js'+workerVersion, 'sidPlayer.js'+workerVersion, 'ship.js'+workerVersion, 'enemies.js'+workerVersion, 'levelCode.js'+workerVersion, 'gameRules.js'+workerVersion);

/** ★ a frame of a PAL machine: 19 656 cycles at 0,985 MHz is 19,95 ms */
var FRAME_MS = 20;
/** ★ at most this many ticks at once after the tab was in the background */
var MAX_CATCHUP = 4;

var state = {
  seed: 1,
  rng: null,
  frame: 0,
  running: false,
  timer: null,
  lastTime: false,
  accumulator: 0,
  /** ★ the byte `$DC00` would read: port 2, active low (`disasm_notes.md` §4) */
  joystick: 0x7F,
  /** the space bar, which the original reads through the keyboard matrix (`$2A2A`, `$2AB0`) */
  space: false,
  /** F7, the original's pause (`$0E96`); fire goes on */
  f7: false,
  /** the level in memory, scrolled by the original's code */
  scroll: null,
  /** the ship, its weapons and the panel — the original's code */
  ship: null,
  /** the rules around the level (M5) */
  rules: null,
  /** the eight entries of data/levels.json, by index */
  levels: null,
  /** the events of the rules already sent */
  eventsSent: 0,
  level: 0
};

/**
 * ★ The world's random source — what the remake puts where the original
 * reads **CIA 1 timer A, `$DC04`** (16 places in the core,
 * `sources/docs/hw_notes.md`): the ship's generator (`Ship.rnd`, a 16-bit
 * LFSR seeded from `init`), the same one the measuring harness puts into
 * the original (`tools/traceship.py`). Never `Math.random()` in the game
 * (`CLAUDE.md`): a run can be repeated. `random` answers from it too.
 * @param {number} seed - Non-zero 16 bits.
 * @returns {function(): number} 0-255 on every call.
 */
function makeRandom(seed) {
  var s = (seed & 0xFFFF) || 1;
  return function () {
    var c = s & 1;
    s >>>= 1;
    if (c) { s ^= 0xB400; }
    return s & 0xFF;
  };
} // makeRandom

/**
 * One frame of the world: the interrupt chain of the original (`Ship.frame`
 * — the scroll step, the enemy loop, the game step and the ship step) and
 * the picture for the main thread: screen and colour RAM, the VIC registers
 * of the sprites, the shapes the bits are drawn into, glyph $DD.
 */
function tick() {
  state.frame++;
  var message = {message: 'frame', frame: state.frame, joystick: state.joystick, space: state.space};
  if (state.ship) {
    var ship = state.ship, rules = state.rules, r = ship.ram;
    ship.joystick = state.joystick;
    ship.space = state.space;
    ship.f7 = state.f7;
    rules.frame();
    var s = state.scroll.state();
    state.level = ship.levelIndex+1;
    message.level = state.level;
    // M5: how the chain would show the frame, where the rules stand, the panel's numbers, the events
    message.mode = rules.mode();
    message.state = rules.state;
    message.score = scoreOf(r);
    message.lives = r[0x281D];
    message.events = rules.events.slice(state.eventsSent);
    state.eventsSent = rules.events.length;
    message.over = rules.state === 'rewind' || rules.state === 'ending';
    // ★ the remake's continue (`ZADANI.md` §10.7): whether the end-of-game screen offers it — a game
    // that got past the start of level 1, at the rewind screen (never after the ending)
    if (message.over) { message.canContinue = rules.state === 'rewind' && rules.continuePoint().worth; }
    message.screen = state.scroll.screen.slice();
    message.color = state.scroll.color.slice(0, 1000);
    message.fine = s.fine;
    message.fineY = s.fineY;
    message.pointer = s.pointer;
    message.running = s.running;
    message.reg64 = s.reg64;
    message.vic = state.ship.vic.slice();
    message.sprites = state.ship.spriteRAM.slice(0, 0x300);
    message.glyphDD = state.ship.glyphDD.slice();
    message.lifeOver = ship.ready;
    message.gameOver = ship.gameOver;
    message.levelOver = ship.levelOver;
    // ★ the multiplexer's three groups of sprites 3-7 as the bands write them, or the boss's rows (M4)
    message.boss = ship.bossChain ? ship.enemies.bossRows() : null;   // (the chain as raster 48 set it, M5)
    // $A000-$FFFF when the level's code drew into it (sprites under the KERNAL, glyphs), and on the first frame
    if (state.ship.highDirty || state.frame === 1) { message.high = state.ship.high.slice(); state.ship.highDirty = false; }
    message.bands = message.boss ? null : [ship.enemies.group(0), ship.enemies.group(1), ship.enemies.group(2)];
    // ★ M6: **the sound is a list of writes into the SID**, not an event — what the player of the level's
    // `M` wrote into $D400-$D418 this frame, in its order, with its place in the frame (`app/sidPlayer.js`,
    // R-044); the main thread hands it to the chip model in the worklet (`app/audioManager.js`)
    if (ship.sid) {
      var sid = ship.sid.take();
      if (sid.length) { message.sid = sid; }
      // R-055: which voice plays an effect and which the tune, beside the writes (not a write — `matchsound`)
      var roles = ship.sid.takeRoles();
      if (roles.length) { message.sidRoles = roles; }
    }
  }
  postMessage(message);
  // ★ the game is over (PLEASE REWIND TAPE, or the ending): the world stops by itself
  if (message.over && state.running) {
    state.running = false;
    if (state.timer !== null) { clearTimeout(state.timer); state.timer = null; }
  }
} // tick

/** ★ `$338B`-`$3390`: the six digits of player 1's score as a number. */
function scoreOf(r) {
  var n = 0;
  for (var i = 0; i < 6; i++) { n = n*10 + (r[0x338B+i] % 10); }
  return n;
} // scoreOf

/**
 * The clock of the world — ★ `setTimeout` with an accumulator, never
 * `setInterval` (**R-046**): the browser rounds and coalesces timers, and a
 * fixed period gives 42-47 Hz instead of 50. The accumulator spends what
 * really passed in whole ticks, at most {@link MAX_CATCHUP} at once.
 */
function schedule() {
  if (!state.running) {
    return;
  }
  state.timer = setTimeout(function () {
    if (!state.running) { return; }
    var now = Date.now();
    if (state.lastTime === false) { state.lastTime = now; }
    state.accumulator += now-state.lastTime;
    state.lastTime = now;
    var steps = Math.min(Math.floor(state.accumulator/FRAME_MS), MAX_CATCHUP);
    state.accumulator -= steps*FRAME_MS;
    for (var step = 0; step < steps; step++) { tick(); }
    schedule();
  }, FRAME_MS);
} // schedule

onmessage = function (event) {
  var data = event.data || {};
  switch (data.message) {
    case 'init':
      state.seed = data.seed || 1;
      state.rng = makeRandom(state.seed);
      state.frame = 0;
      state.joystick = 0x7F;
      state.space = false;
      state.scroll = null;
      state.ship = null;
      state.rules = null;
      state.levels = null;
      state.eventsSent = 0;
      state.f7 = false;
      state.level = 0;
      // the levels: all eight entries of data/levels.json (`levels`), and the one to start in (`level`:
      // 1-8); a single entry in `level` is taken as the only level (the tools of M2-M4)
      var entry = null;
      if (data.levels) {
        state.levels = [];
        for (var i = 0; i < data.levels.length; i++) { state.levels[data.levels[i].index] = data.levels[i]; }
        entry = state.levels[(data.level || 1)-1] || null;
      } else if (data.level && typeof data.level === 'object') {
        state.levels = [];
        state.levels[data.level.index] = data.level;
        entry = data.level;
      }
      if (entry) {
        state.scroll = new LevelScroll();
        state.level = entry.level;
        if (data.ship && data.sprites && data.panel) {
          // ★ the ship, the enemies' memory and the rules; `Ship.init` is $0818 → $088A: the level's
          // files, its state, the map ($162F) and READY — the game begins there, as on the machine
          state.ship = new Ship(state.scroll);
          state.rules = new GameRules(state.ship);
          state.rules.levels = state.levels;
          state.ship.loadData(data.ship, data.sprites, data.enemies, data.charsets, data.music);
          state.ship.seed = (state.seed & 0xFFFF) || 1;
          // the harness patch $319C = RTS, in the browser only on `?devImmortal=1`
          state.ship.immortal = !!data.immortal;
          state.ship.init(entry, Uint8Array.from(data.panel.screen), Uint8Array.from(data.panel.color));
        } else {
          // the scroll alone (M2's tools): the map and the first screen
          state.scroll.init(entry);
        }
      }
      postMessage({message: 'ready', seed: state.seed, level: state.level});
      break;
    case 'start':
      if (!state.running) {
        state.running = true;
        state.accumulator = 0;
        // ★ the clock is read here, not in the first timeout: otherwise the
        // first wake-up only notes the time and the world starts a frame late
        state.lastTime = Date.now();
        schedule();
      }
      break;
    case 'continue':
      // ★ the remake's continue (`ZADANI.md` §10.7): the world stays as GAME OVER left it, the score is
      // zeroed, the lives are three and the game goes on from the checkpoint as after a lost life
      // (`GameRules.continueGame`); when there is nothing to go on with, the main thread is told and starts
      // a new game instead
      if (state.rules && state.rules.continueGame()) {
        postMessage({message: 'continued', level: state.level, frame: state.frame});
      } else {
        postMessage({message: 'continueFailed'});
      }
      break;
    case 'stop':
      state.running = false;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      break;
    case 'input':
      if (data.joystick !== undefined) { state.joystick = data.joystick & 0xFF; }
      if (data.space !== undefined) { state.space = !!data.space; }
      if (data.f7 !== undefined) { state.f7 = !!data.f7; }
      break;
    case 'random':
      postMessage({message: 'random', value: state.rng ? state.rng() : 0});
      break;
    case 'sample':
      // M6: a few seconds of a level's tune for the volume dialog, played by the same player
      postMessage({message: 'sample', kind: data.kind || 'music', frames: data.kind === 'title'
        ? titleSampleOf(data.music, data.frames || 10000) : sampleOf(data.music, data.level || 1, data.frames || 200, data.effects, data.every || 40)});
      break;
  }
}; // onmessage

/**
 * ★ M6: the opening of a level's tune as frames of SID writes — the player
 * of `app/sidPlayer.js` over a scratch memory with the level's song
 * (`data/music.json`), started as `$088A` starts it (`$637C` with `$6D40`,
 * `$6379` with 3), stepped once a frame, and silenced at the end. The volume
 * dialog of the menu plays it as a script (`AudioManager.audioData`), so the
 * sample is the game's own sound and not a copy of it.
 * With `effects`, the sample is **the effects**: the numbers of `$3413`'s
 * table requested on voice 2 the way `Ship.sound` does (`$63C1`/`$63C2`)
 * one after another, and the voices' roles ride in the script as the
 * pseudo-registers of the SID model (R-055), so the SOUNDS bus can mute
 * the tune under them.
 * @param {Object} music - `data/music.json`.
 * @param {number} level - 1-8.
 * @param {number} frames - How many frames.
 * @param {Array<number>} [effects] - The effects to play, one every `every` frames.
 * @param {number} [every] - Frames between two effects (40).
 * @returns {Array} `[[[where, register, value], …], …]`, a frame each.
 */
/**
 * ★ The tune of the title screen, **once**: the title's player is the level
 * player relocated (`music.title`, `tools/dumpmusic.py`), so the same
 * SidPlayer plays its song — at the song's own addresses, with its table
 * `$71D0` and tune 2 as `$8000` starts it — until the sequence goes back to its loop position
 * (`SidPlayer.onLoop`, ★ 6 528 frames = 130 s), then it is silenced; `frames` is the cap.
 * @param {Object} music - `data/music.json`.
 * @param {number} frames - At most this many frames.
 * @returns {Array} `[[[where, register, value], …], …]`, a frame each.
 */
function titleSampleOf(music, frames) {
  var out = [];
  if (!music || !music.title || !music.levels || !music.levels[0] || typeof SidPlayer === 'undefined') { return out; }
  var ram = new Uint8Array(0xA000);
  // the player's variables, code and tables: level 1's (the title's are the same bytes, relocated); the song
  // at its own addresses — its order lists point to the tracks absolutely — and its table given to $637C
  ram.set(music.levels[0].bytes, parseInt(music.levels[0].addr.slice(1), 16));
  ram.set(music.title.bytes, parseInt(music.title.addr.slice(1), 16));
  var player = new SidPlayer(ram);
  var looped = false;
  player.onLoop = function () { looped = true; };
  player.setup(parseInt(music.title.table.slice(1), 16));
  player.start(music.title.tune, 0);
  for (var f = 0; f < frames; f++) {
    player.play(0);
    var writes = player.take();
    if (looped) { break; }                                // (the frame that started the tune over is dropped)
    out.push(writes);
  }
  player.init(0);
  out.push(player.take());
  return out;
} // titleSampleOf

function sampleOf(music, level, frames, effects, every) {
  every = every || 40;
  var out = [];
  if (!music || !music.levels || !music.levels[level-1] || typeof SidPlayer === 'undefined') { return out; }
  var ram = new Uint8Array(0xA000);
  var mu = music.levels[level-1];
  ram.set(mu.bytes, parseInt(mu.addr.slice(1), 16));
  var player = new SidPlayer(ram);
  player.setup(SidPlayer.TABLE);
  player.start(3, 0);
  var frame = function () {
    var writes = player.take();
    var roles = player.takeRoles();
    for (var i = 0; i < roles.length; i++) { writes.push([roles[i][0], 0x20+roles[i][1], roles[i][2]]); }
    return writes;
  };
  for (var f = 0; f < frames; f++) {
    // ★ the first effect a frame after the start: at frame 0 the tune's start wipes it (`tuneStart` after `fxStart`)
    if (effects && f%every === 1 && (f-1)/every < effects.length) { ram[0x63C1] = effects[(f-1)/every]; ram[0x63C2] = 2; }
    player.play(0);
    out.push(frame());
  }
  player.init(0);
  out.push(frame());
  return out;
} // sampleOf
