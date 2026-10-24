// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The SID player of R-Type — ★ the routine at `$6370`-`$6D3F` of every
 * level's `M` file, transcribed instruction by instruction, with its
 * variables **at the addresses the original keeps them** in the flat `ram`
 * of {@link Ship} (`sources/docs/disasm_notes.md` §14, `data/music.json`).
 * It plays the level's tune, the boss's, the one of the level-end sequence
 * and GAME OVER's, and the **effects**, which are tracks of the same song
 * played on voice 3 for a number of sequence steps (`$6376`, `$6544`).
 *
 * | entry | what the original calls it for |
 * |---|---|
 * | `$6370` {@link SidPlayer#play} | once a frame: the raster-202 handler (`$0E46`, not inside a column shift), every iteration of READY (`$0C09`) and of the level-end sequence (`$0A38`) |
 * | `$6373` {@link SidPlayer#init} | silence: the end of the sequence (`$0A4E`), and inside a tune's start |
 * | `$6376` {@link SidPlayer#fx} | an effect, A the track, X the voice (always 2 — `$340E`, `Ship.sound`) |
 * | `$6379` {@link SidPlayer#start} | a tune, A its number (3 the level, 0 the boss, 2 the sequence, 1 GAME OVER) |
 * | `$637C` {@link SidPlayer#setup} | the pointer table from the song's relative table (`$0896`: `$6D40`) and silence |
 *
 * ★ **What comes out is a list of writes with their order**, not sound: every
 * `STA $D4xx` of the original is {@link SidPlayer#poke} here, which appends
 * `[where, register, value]` to {@link SidPlayer#writes} — `where` the unit
 * {@link ChipStream} spaces the writes by, a cycle of the 6510 from the
 * frame's start (R-044) — and the worker empties the list once a frame
 * (`frame.sid`, `WORKER-PROTOCOL.md`). The library's SID model in the
 * worklet turns them into sound (`app/audioManager.js`); the order and the
 * values are what `tools/matchsound.mjs` compares with the running original,
 * register by register, and the variables with its memory.
 *
 * ★ The position is **a model of the cadence, not a measurement**: the
 * raster-202 handler writes the chip at about line 204 of the 312, READY
 * at line `$43` after its colour change, the sequence at `$FA`
 * ({@link Ship.MUSIC_LINES}). Within one call the writes keep the
 * original's order at one position.
 *
 * ★ Three things the code does that a reader would not expect: the start
 * of a tune **writes the current sequence position into the song** (`$64B7`,
 * row `+$C0` of the tune table — and reads it back into a temporary that is
 * overwritten at once, so the song carries the position for nothing); X of
 * `$6379` is stored in `$63C0` and **never read** (`$64B9` loads it and the
 * next instruction overwrites A); and the **new rows of all three voices are
 * read one frame after the tick ran out** (`$65A2`: `$63B5` set at `$65CD`,
 * acted on by the next call — a frame without the filter and volume writes
 * of `$65D8`). The player writes `$D416`-`$D418` every tick, but ★ **no
 * instrument of any level routes a voice through the filter** (byte 11 of
 * every instrument is `$FF`, `tools/dumpmusic.py`): `$D417` stays 0.
 *
 * @param {Uint8Array} ram - The machine's memory the variables and the song live in (`Ship.ram`).
 * @constructor
 */
function SidPlayer(ram) {
  this.ram = ram;
  /** the writes since the last {@link SidPlayer#take}: `[where, register, value]` in the original's order */
  this.writes = [];
  /** called when the sequence goes back to the loop position (the tune starts over), or null */
  this.onLoop = null;
  /** the role changes of the SID voices since the last take: `[[where, voice, role], …]` (R-055) */
  this.roles = [];
  /** the chip's registers as the writes left them (for a tool) */
  this.regs = new Uint8Array(25);
  /** where in the frame the writes that follow belong (a cycle of the 6510) */
  this.pos = 0;
  /** every write ever made, counted (for a tool) */
  this.count = 0;
}

/** ★ `$0896`: X/Y of the `JSR $637C` of a level's start — the song's pointer table */
SidPlayer.TABLE = 0x6D40;
/** ★ the two frequency tables of the code (low and high byte by note) and the waveforms of the commands `$E9`-`$F3` */
SidPlayer.FREQ_LO = 0x6CD2;
SidPlayer.FREQ_HI = 0x6C72;
SidPlayer.WAVEFORMS = 0x6D31;

/**
 * One write of one register, as the chip would see it.
 * @param {number} reg - 0-24 (`$D400` + reg).
 * @param {number} value - A byte.
 */
SidPlayer.prototype.poke = function (reg, value) {
  reg &= 0x1F;
  value &= 0xFF;
  if (reg > 0x18) { return; }
  this.regs[reg] = value;
  this.writes.push([this.pos, reg, value]);
  this.count++;
}; // poke

/**
 * The writes since the last call, for the worker's frame message.
 * @returns {Array} `[[where, register, value], …]`.
 */
SidPlayer.prototype.take = function () {
  var out = this.writes;
  this.writes = [];
  return out;
}; // take

/**
 * R-055: the SID voice of the player's voice `x` has taken a role — an
 * effect started on it (`$6544`) or ended (`$6622`), or the tune took it
 * back (`$649B`, `$6476`). Not a write into the chip: the model of the
 * 6581 scales the voice by the gain of its role (the MUSIC and SOUNDS
 * sliders), so this goes beside the writes, and `matchsound` does not
 * see it.
 * @param {number} x - The player's voice 0-2.
 * @param {number} role - 0 music, 1 effects.
 */
SidPlayer.prototype.role = function (x, role) {
  this.roles.push([this.pos, (this.ram[0x63C6+x]/7) | 0, role]);
}; // role

/**
 * The role changes since the last call.
 * @returns {Array} `[[where, voice, role], …]`.
 */
SidPlayer.prototype.takeRoles = function () {
  var out = this.roles;
  this.roles = [];
  return out;
}; // takeRoles

/** a 16-bit pointer out of two bytes of ram */
SidPlayer.prototype.word = function (a) { return this.ram[a] | this.ram[a+1] << 8; };

// ---------------------------------------------------------------- the entry points

/**
 * ★ `$6476` (`$6373`): silence — the three gates to test, every register
 * to zero, `$6386` (playing) and `$63BF` (the tune request) cleared.
 * @param {number} [pos] - Where in the frame.
 */
SidPlayer.prototype.init = function (pos) {
  var r = this.ram;
  if (pos !== undefined) { this.pos = pos; }
  r[0x6386] = 0;
  this.poke(0x04, 8); this.poke(0x0B, 8); this.poke(0x12, 8);
  for (var v = 2; v >= 0; v--) { this.role(v, 0); }
  for (var y = 0x18; y >= 0; y--) { this.poke(y, 0); }    // $648A: Y from $18 down to 0
  r[0x63BF] = 0xFF;                                       // $6490: STY with Y = $FF
}; // init

/**
 * ★ `$6494` (`$6379`): a tune requested — A the tune, X kept in `$63C0`
 * (never read). The player starts it in its next step.
 * @param {number} a - The tune.
 * @param {number} [x] - What X held.
 */
SidPlayer.prototype.start = function (a, x) {
  this.ram[0x63BF] = a & 0xFF;
  if (x !== undefined) { this.ram[0x63C0] = x & 0xFF; }
}; // start

/**
 * ★ `$653D` (`$6376`): an effect requested — A its track, X the voice.
 * @param {number} a - The track.
 * @param {number} x - The voice (2).
 */
SidPlayer.prototype.fx = function (a, x) {
  this.ram[0x63C2] = x & 0xFF;
  this.ram[0x63C1] = a & 0xFF;
}; // fx

/**
 * ★ `$6564` (`$637C`): the 22 absolute pointers `$6388`-`$63B3` out of the
 * song's relative table at X/Y, `$6386` cleared, `$63B4` ← `$2C`.
 * @param {number} table - The address X/Y held (`$6D40`).
 */
SidPlayer.prototype.setup = function (table) {
  var r = this.ram;
  r[0x6386] = 0;
  for (var y = 0; y < 0x2C; y += 2) {
    var abs = (table + (r[(table+y) & 0xFFFF] | r[(table+y+1) & 0xFFFF] << 8)) & 0xFFFF;   // $6571-$657C: 16-bit add with the carry
    r[0x6388+y] = abs & 0xFF;
    r[0x6389+y] = abs >> 8;
  }
  r[0x63B4] = 0x2C;
}; // setup

/**
 * ★ `$6588` (`$6370`): the player's step, once a frame — a pending effect
 * started, a pending tune started (and nothing else that frame), else the
 * new rows of the voices or a tick of every voice, and the filter and
 * volume registers.
 * @param {number} [pos] - Where in the frame the writes belong.
 */
SidPlayer.prototype.play = function (pos) {
  var r = this.ram, x;
  if (pos !== undefined) { this.pos = pos; }
  if (r[0x63C1] < 0x80) { this.fxStart(); }               // $6588: BMI
  if (r[0x63BF] < 0x80) { this.tuneStart(r[0x63BF]); return; }   // $6595: JMP $649B
  if (r[0x6386] === 0) { return; }                        // $659B
  x = r[0x63B5];
  if (x !== 0) {                                          // $65A0: new rows for voices x..0
    for (; x >= 0; x--) { this.newRow(x); }
    r[0x6385] = (r[0x6385]+1) & 0xFF;
    r[0x63B5] = 0;
    return;
  }
  r[0x63F9] = (r[0x63F9]-1) & 0xFF;                       // $65B0
  if (r[0x63F9] === 0) {                                  // $65C7: the tick ran out — the rows next frame
    r[0x63F9] = r[0x63FA];
    r[0x63B5] = 2;
    for (x = 2; x >= 0; x--) { this.voiceStep(x); }
  } else {
    for (x = 2; x >= 0; x--) { this.voiceStep(x); }      // $65B7
    if (r[0x63F9] === 1) { this.sequence(); return; }    // $65C0: JMP $6B1E — no $65D8 this frame
  }
  this.poke(0x17, r[0x63FB]);                             // $65D8
  this.poke(0x18, (r[0x63FC] & 0xF0) | r[0x637F]);
  this.poke(0x16, r[0x646D]);
}; // play

// ---------------------------------------------------------------- tunes, effects, the sequence

/**
 * ★ `$649B`: a tune starts — silence first, then the tune's row of the
 * table: start, loop, end, flags, speed, effect length; the three voices'
 * tracks of the start position loaded, the state cleared.
 * @param {number} a - The tune.
 */
SidPlayer.prototype.tuneStart = function (a) {
  var r = this.ram, x;
  this.init();
  var fa = (this.word(0x63A0) + a) & 0xFFFF;             // $64A0-$64AB
  r[0x6381] = r[(fa+0xC0) & 0xFFFF];                      // $64AF
  r[(fa+0xC0) & 0xFFFF] = r[0x6380];                      // $64B7: the position written into the song
  r[0x6381] = r[fa];                                      // $64B9: LDA $63C0 is dead — overwritten here
  r[0x6380] = r[0x6381];
  r[0x6383] = r[(fa+0x40) & 0xFFFF];
  r[0x6382] = r[(fa+0x20) & 0xFFFF];
  r[0x63FA] = r[(fa+0x80) & 0xFFFF];
  r[0x6384] = r[(fa+0xA0) & 0xFFFF];
  var flags = r[(fa+0x60) & 0xFFFF];
  r[0x6424] = flags & 1; r[0x6425] = (flags >> 1) & 1; r[0x6426] = (flags >> 2) & 1; r[0x6427] = (flags >> 3) & 1;
  for (x = 2; x >= 0; x--) {                              // $6507
    r[0x63F3+x] = 0xE6; r[0x642B+x] = 0xE6;
    this.loadTrack(x);
    r[0x640F+x] = 0; r[0x63F0+x] = 0;
    if (r[0x63C9+x] !== 0) { this.role(x, 0); }
    r[0x63C9+x] = 0;
  }
  r[0x63BF] = 0xFF;                                       // $6522: STX with X = $FF
  r[0x63B5] = 0; r[0x6385] = 0; r[0x63FB] = 0; r[0x63FC] = 0;
  r[0x63F9] = 1; r[0x6386] = 1;
  r[0x6380] = (r[0x6380]+1) & 0xFF;
}; // tuneStart

/**
 * ★ `$6544`: an effect starts — the track of its number loaded on the
 * requested voice (the sequence position borrowed for the lookup), the
 * voice's countdown set to the tune's effect length.
 */
SidPlayer.prototype.fxStart = function () {
  var r = this.ram;
  var x = r[0x63C2];
  var saved = r[0x6380];
  r[0x6380] = r[0x63C1];
  this.loadTrack(x);
  r[0x63C9+x] = r[0x6384];
  this.role(x, 1);
  r[0x63C1] = 0xFF;
  r[0x6380] = saved;
}; // fxStart

/**
 * ★ `$6B1E`: the sequence steps on — when a track ended (`$63BC`) or the
 * effect length of steps passed; at the end position back to the loop;
 * the voices without a running effect get the tracks of the new position.
 */
SidPlayer.prototype.sequence = function () {
  var r = this.ram;
  if (r[0x63BC] === 0 && r[0x6385] < r[0x6384]) { return; }   // $6B21-$6B29: BCC
  r[0x6385] = 0; r[0x63BC] = 0;
  if (r[0x6380] === r[0x6383]) {
    r[0x6380] = r[0x6382];
    if (this.onLoop) { this.onLoop(); }                   // the tune starts over (ABOUT plays the title's once)
  }
  for (var x = 2; x >= 0; x--) {                          // $6B41
    if (r[0x63C9+x] === 0) { this.loadTrack(x); }
  }
  r[0x6380] = (r[0x6380]+1) & 0xFF;
}; // sequence

/**
 * ★ `$6B52`: the track of the sequence position for a voice — the number
 * from the order list (bit 7: the two voices alternate rows), the
 * transpose, the instrument and table offsets, the duration flag, the
 * track's pointer.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.loadTrack = function (x) {
  var r = this.ram;
  r[0x63C4] = x;
  var x2 = x*2;
  var f0 = this.word(0x6388+x2), f2 = this.word(0x638E+x2), f4 = this.word(0x6394+x2), f6 = this.word(0x639A+x2);
  var f8 = this.word(0x63A2), fa = this.word(0x63B2);
  var y = r[0x6380];
  r[0x63DB+x] = 1;
  r[0x63DE+x] = r[(f2+y) & 0xFFFF];
  r[0x63E1+x] = r[(f4+y) & 0xFFFF];
  r[0x63E4+x] = r[(f6+y) & 0xFFFF];
  var a = r[(f0+y) & 0xFFFF];
  r[0x63D8+x] = a;
  y = a & 0x7F;
  if (r[0x63B4] !== 0) { r[0x63CC+x] = r[(fa+y) & 0xFFFF]; }
  r[0x63CF+x] = 1;
  y = (y*2) & 0xFF;                                       // $6BC5: TYA ASL TAY — eight bits
  r[0x63D2+x] = r[(f8+y) & 0xFFFF];
  r[0x63D5+x] = r[(f8+((y+1) & 0xFF)) & 0xFFFF];
}; // loadTrack

// ---------------------------------------------------------------- a row

/**
 * ★ `$65F0`: a voice silenced — the gate to test, the program stopped —
 * and its tick.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.silence = function (x) {
  var r = this.ram;
  var y = r[0x63C6+x];
  this.poke(0x04+y, 8);
  r[0x640F+x] = 8;
  r[0x63F3+x] = 0xE6;
  r[0x6428+x] = 0;
  r[0x63CF+x] = 0;
  this.voiceStep(x);                                      // $6608: JMP $67ED
}; // silence

/**
 * ★ `$661A`: a new row of a voice — the effect countdown, the note's
 * remaining rows, then the row: the note (0 a rest, `$80` the gate off,
 * bit 7 the gate on), the instrument and table nibbles, the duration when
 * the track carries one; a track with bit 7 of its number lets two voices
 * take rows in turn.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.newRow = function (x) {
  var r = this.ram, a, y, x2;
  if (r[0x63C9+x] !== 0) {                                // $661A: an effect running on this voice
    r[0x63C9+x] = (r[0x63C9+x]-1) & 0xFF;
    if (r[0x63C9+x] === 0) {                              // $6622: over — silenced
      this.role(x, 0);
      r[0x63D8+x] = 0xFE;
      this.silence(x);
      return;
    }
  }
  r[0x63CF+x] = (r[0x63CF+x]-1) & 0xFF;                   // $662B
  if (r[0x63CF+x] !== 0) { this.voiceStep(x); return; }
  r[0x63CF+x] = (r[0x63CF+x]+1) & 0xFF;
  r[0x63C4] = x; r[0x63C5] = x;
  a = r[0x63D8+x];
  if (a === 0xFE) { this.voiceStep(x); return; }
  if (a === 0xFF) { this.silence(x); return; }
  var f0 = r[0x63D2+x] | r[0x63D5+x] << 8;
  y = 2;
  if (r[0x63CC+x] !== 0) { r[0x63CF+x] = r[(f0+2) & 0xFFFF]; y = 3; }   // $6650-$665A
  var p = r[0x63D2+x] + y;                                // $665B: the pointer on by y
  r[0x63D2+x] = p & 0xFF;
  r[0x63D5+x] = (r[0x63D5+x] + (p >> 8)) & 0xFF;
  if (r[(f0+y) & 0xFFFF] === 0xFF) { r[0x63BC] = 0xFF; }  // $666B: the next row ends the track
  a = r[f0 & 0xFFFF];                                     // $6674
  if (a === 0) { this.voiceStep(x); return; }
  r[0x63C3] = a;
  if (r[0x63D8+x] & 0x80) {                               // $667D: BPL — the alternating voices
    r[0x63DB+x] = (r[0x63DB+x]+1) & 1;
    x2 = x + r[0x63DB+x];
    if (x2 === 3) { x2 = 0; }
    if (r[0x63D8+x2] !== 0xFE) {                          // $6699
      var fc = r[0x63D2+x2] | r[0x63D5+x2] << 8;
      if (r[fc & 0xFFFF] !== 0) { x2 = r[0x63C4]; }
    }
    r[0x63C5] = x2;
  }
  a = r[0x63C3];                                          // $66B6
  if (a === 0x80) {
    r[0x642F] = 0;
    this.gateOnly();                                      // $660B
    return;
  }
  r[0x642F] = a;
  a &= 0x7F;
  x = r[0x63C4];
  r[0x642E] = (a + r[0x63DE+x]) & 0xFF;
  a = r[(f0+1) & 0xFFFF];                                 // $66D4: Y = 1
  r[0x63C3] = a;
  r[0x6430] = ((a >> 4) + r[0x63E4+x]) & 0xFF;
  r[0x6431] = ((a & 0x0F) + r[0x63E1+x]) & 0xFF;
  x = r[0x63C5];
  this.instrument(x, r[0x6431]);                          // $66F4
  r[0x642B+x] = r[0x6431];
  r[0x6409+x] = r[0x6430];
  r[0x63ED+x] = r[0x642E];
  r[0x643B+x] = 0; r[0x643E+x] = 0; r[0x6447+x] = 0; r[0x644A+x] = 0;
  r[0x63FD+x] = 0; r[0x6400+x] = 0; r[0x6441+x] = 0; r[0x6444+x] = 0;
  x = r[0x63C5];
  r[0x63F0+x] = r[0x642F];
}; // newRow

/** ★ `$660B`: a row of `$80` — the note byte to the voice taking the row, then its tick. */
SidPlayer.prototype.gateOnly = function () {
  var r = this.ram;
  var x = r[0x63C5];
  r[0x63F0+x] = r[0x642F];
  this.voiceStep(r[0x63C4]);                              // $6617: JMP $67ED with X = $63C4
}; // gateOnly

/**
 * ★ `$6730`: an instrument into a voice — only when the row's note has
 * its gate bit; ATDCY, SUREL, the pulse sweep period, the pulse width and
 * its step (kept when the same instrument plays on with bit 0 of byte 2
 * clear), the vibrato, the pitch offset, and the filter row when byte 11
 * is not `$FF` (★ it always is).
 * @param {number} x - The voice.
 * @param {number} a - The instrument (`$6431`).
 */
SidPlayer.prototype.instrument = function (x, a) {
  var r = this.ram;
  var y = (a*2) & 0xFF;                                   // $6730: ASL A; TAY — eight bits
  if (r[0x642F] < 0x80) { return; }                       // $6735: BPL — no gate, nothing loaded
  var f0 = this.word(0x63A4);
  var f2 = r[(f0+y) & 0xFFFF] | r[(f0+((y+1) & 0xFF)) & 0xFFFF] << 8;
  var at = function (i) { return r[(f2+i) & 0xFFFF]; };
  r[0x6412+x] = at(0);
  r[0x6415+x] = at(1);
  a = at(2);
  r[0x6432+x] = r[0x6435+x] = ((a >> 4)+1) & 0xFF;
  if ((a & 1) === 0 && r[0x6431] === r[0x642B+x]) {       // $676A-$6774: the same instrument keeps its pulse
    // $679C
  } else {
    a = at(3);                                            // $6776
    r[0x641B+x] = a >> 4;
    r[0x6455+x] = (((a >> 4) ^ 0x0F)+1) & 0xFF;
    r[0x6418+x] = (a << 4) & 0xFF;
    r[0x641E+x] = at(4);
    r[0x6421+x] = at(5);
  }
  a = at(6);                                              // $679C
  r[0x645E+x] = a; r[0x6467+x] = a;
  a >>= 1;
  r[0x645B+x] = a; r[0x646A+x] = a;
  r[0x6458+x] = at(7);
  r[0x6461+x] = at(8);
  r[0x6464+x] = at(9);
  r[0x6438+x] = at(10);
  a = at(11);
  if (a !== 0xFF) {                                       // $67C8: the filter row
    r[0x63FC] = a;
    r[0x63FB] = at(12);
    r[0x646D] = at(13);
    r[0x6470] = at(14);
    r[0x6473] = at(15);
  }
  r[0x63F3+x] = 1;                                        // $67E7: the wave program starts
}; // instrument

// ---------------------------------------------------------------- a tick of a voice

/**
 * ★ `$67ED`: a tick of a voice — its wave program, the pulse sweep, the
 * vibrato, the filter sweep (voice 1 only), the frequency of its note with
 * the pitch offset and the vibrato (★ the carry of the first add is
 * dropped: `$680A CLC`), the slide, and the registers.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.voiceStep = function (x) {
  var r = this.ram;
  if (r[0x63D8+x] === 0xFF) { return; }
  this.waveProgram(x);
  this.pulseSweep(x);
  this.vibrato(x);
  this.filterSweep(x);
  var y = r[0x640C+x];
  var lo = (r[(SidPlayer.FREQ_LO+y) & 0xFFFF] + r[0x6438+x]) & 0xFF;   // $6803-$6807: CLC ADC (carry dropped by $680A)
  var sum = lo + r[0x63FD+x];                             // $680B: CLC ADC
  r[0x63E7+x] = sum & 0xFF;
  r[0x63EA+x] = (r[(SidPlayer.FREQ_HI+y) & 0xFFFF] + r[0x6400+x] + (sum > 0xFF ? 1 : 0)) & 0xFF;   // $6811: ADC with that carry
  this.slide(x);
  this.writeVoice(x);
}; // voiceStep

/**
 * ★ `$6825`-`$693F`: the wave program of a voice — a stream of notes
 * (absolute from `$80`, relative below) and commands: `$E0` slide on, `$E1`/`$E2`
 * gate from the row, `$E3` pulse, `$E4` filter cutoff and sweeps, `$E5`
 * portamento, `$E6` stop, `$E7` jump, `$E8` another program, `$E9`-`$F3` a
 * waveform from the table, `$F4` wait; a note or a wait ends the tick,
 * anything else runs on.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.waveProgram = function (x) {
  var r = this.ram, a, y, f4;
  a = r[0x63F3+x];
  if (a === 0xE6) { return; }                             // $682A: stopped
  if (a !== 0) { this.programStart(x); }                  // $682E
  f4 = r[0x6403+x] | r[0x6406+x] << 8;                    // $6853
  for (var guard = 0; guard < 4096; guard++) {            // $685D
    y = r[0x63F6+x];
    if (r[0x63B6+x] !== 0) { r[0x63B6+x] = (r[0x63B6+x]-1) & 0xFF; return; }   // $6821
    a = r[(f4+y) & 0xFFFF];
    y = (y+1) & 0xFF;
    if (a < 0xE0) {                                       // $6881: a note
      if (a < 0x80) { a = (a + r[0x63ED+x]) & 0xFF; }
      r[0x640C+x] = a & 0x7F;
      r[0x644D+x] = 0;
      r[0x63F6+x] = y;
      return;
    }
    if (a === 0xE0) { r[0x644D+x] = 1; r[0x63F6+x] = y; return; }   // $6898
    if (a === 0xF4) { r[0x63B6+x] = r[(f4+y) & 0xFFFF]; y = (y+1) & 0xFF; }   // $68A5: wait
    else if (a === 0xE5) { y = this.portamento(x, f4, y); }          // $689F
    else if (a === 0xE3) {                                            // $68AE: the pulse
      a = r[(f4+y) & 0xFFFF];
      r[0x641B+x] = a >> 4;
      r[0x6455+x] = (((a >> 4) ^ 0x0F)+1) & 0xFF;
      r[0x6418+x] = (a << 4) & 0xFF;
      y = (y+1) & 0xFF; r[0x641E+x] = r[(f4+y) & 0xFFFF];
      y = (y+1) & 0xFF; r[0x6421+x] = r[(f4+y) & 0xFFFF];
      y = (y+1) & 0xFF;
    } else if (a === 0xE4) {                                          // $68D7: the filter
      r[0x646D] = r[(f4+y) & 0xFFFF]; y = (y+1) & 0xFF;
      r[0x6470] = r[(f4+y) & 0xFFFF]; y = (y+1) & 0xFF;
      r[0x6473] = r[(f4+y) & 0xFFFF]; y = (y+1) & 0xFF;
    } else if (a === 0xE7) { r[0x63F6+x] = r[(f4+y) & 0xFFFF]; continue; }   // $68EB: jump — the position itself
    else if (a === 0xE6) { r[0x63F3+x] = 0xE6; return; }                       // $68F3: stop
    else if (a === 0xE8) {                                                      // $68F7: another program
      r[0x6409+x] = r[(f4+y) & 0xFFFF];
      this.programStart(x);
      f4 = r[0x6403+x] | r[0x6406+x] << 8;
      continue;
    } else if (a === 0xE2 || a === 0xE1) {                                      // $68FF, $6907: the gate from the row
      r[0x6428+x] = a === 0xE1 ? 1 : 0;
      a = r[(f4+y) & 0xFFFF]; y = (y+1) & 0xFF;                                 // $690C: the waveform follows
      r[0x640F+x] = a < 0xE1 ? a : this.waveformOf(x, a);
    } else {                                                                    // $6913: $E9-$FF — a waveform by table
      r[0x640F+x] = this.waveformOf(x, a);
    }
    r[0x63F6+x] = y;                                      // $6923: and the next command of the same tick
  }
}; // waveProgram

/** ★ `$682E`-$6850`: a wave program begins — its pointer from the table, the position and the wait cleared. */
SidPlayer.prototype.programStart = function (x) {
  var r = this.ram;
  r[0x63F3+x] = 0; r[0x63F6+x] = 0; r[0x63B6+x] = 0;
  var y = (r[0x6409+x]*2) & 0xFF;
  var f0 = this.word(0x63A6);
  r[0x6403+x] = r[(f0+y) & 0xFFFF];
  r[0x6406+x] = r[(f0+((y+1) & 0xFF)) & 0xFFFF];
}; // programStart

/** ★ `$6913`: the waveform of a command `$E9`… from the table at `$6D31` (X borrowed, kept in `$63C4`). */
SidPlayer.prototype.waveformOf = function (x, a) {
  this.ram[0x63C4] = x;
  return this.ram[(SidPlayer.WAVEFORMS + ((a-0xE9) & 0xFF)) & 0xFFFF];
}; // waveformOf

/**
 * ★ `$69F8`: the `$E5` command — a slide (`$30`: from the current note; below
 * `$20`: free) or a portamento to a note, the speed in the low nibble, the
 * step in the two bytes after (negated for bit 4).
 * @param {number} x - The voice.
 * @param {number} f4 - The program.
 * @param {number} y - The position after the command.
 * @returns {number} The position after the command's bytes.
 */
SidPlayer.prototype.portamento = function (x, f4, y) {
  var r = this.ram;
  r[0x63C3] = 0;
  r[0x6450+x] = 0;
  var a = r[(f4+y) & 0xFFFF];
  if (a === 0x30 || a >= 0x20) {                          // $6A02-$6A0A
    if (a !== 0x30) { r[0x6450+x] = a; }
    r[0x6447+x] = r[0x63E7+x];                            // $6A0D
    r[0x644A+x] = r[0x63EA+x];
    a = r[(f4+y) & 0xFFFF] & 0x10;
  }
  if (a === 0x10) { r[0x63C3] = 0xFF; }                   // $6A1D
  a = r[(f4+y) & 0xFFFF];                                 // $6A24
  r[0x6441+x] = r[0x6444+x] = ((a & 0x0F)+1) & 0xFF;
  y = (y+1) & 0xFF;
  r[0x643B+x] = r[(f4+y) & 0xFFFF] ^ r[0x63C3];
  y = (y+1) & 0xFF;
  r[0x643E+x] = r[(f4+y) & 0xFFFF] ^ r[0x63C3];
  return (y+1) & 0xFF;
}; // portamento

/**
 * ★ `$6A59`: the slide of a voice, every `$6444` ticks — a free slide adds
 * its step; a portamento steps toward the note's frequency by a step
 * scaled by the distance, and lands on it.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.slide = function (x) {
  var r = this.ram, a, y;
  r[0x6441+x] = (r[0x6441+x]-1) & 0xFF;
  if (r[0x6441+x] !== 0) { return; }
  r[0x6441+x] = r[0x6444+x];
  if (r[0x6450+x] === 0) {                                // $6A45: the free slide
    var s = r[0x6447+x] + r[0x643B+x];
    r[0x6447+x] = s & 0xFF;
    r[0x644A+x] = (r[0x644A+x] + r[0x643E+x] + (s >> 8)) & 0xFF;
    return;
  }
  r[0x6453] = r[0x643B+x]; r[0x6454] = r[0x643E+x];
  a = (r[0x644A+x] - r[0x63EA+x]) & 0xFF;                 // $6A75: SEC SBC
  if (r[0x644A+x] < r[0x63EA+x]) { a = ((a ^ 0xFF)+1) & 0xFF; }   // $6A7C: BCS — negate below
  y = a >> 2;                                             // $6A83
  if (y !== 0) {
    if (y >= 6) { y = 6; }
    for (; y >= 0; y--) {                                 // $6A8E: BPL — y + 1 doublings
      var d = r[0x6453] << 1;
      r[0x6453] = d & 0xFF;
      r[0x6454] = ((r[0x6454] << 1) | (d >> 8)) & 0xFF;
    }
  }
  var hi = r[0x644A+x], thi = r[0x63EA+x], lo = r[0x6447+x], tlo = r[0x63E7+x];   // $6A9F
  var up;
  if (hi === thi) {
    if (lo === tlo) { this.slideSet(x); return; }         // $6B11
    up = lo < tlo;
  } else {
    up = hi < thi;
  }
  if (!up) {                                              // $6AB5: down
    var dh = (hi - thi) & 0xFF;
    if (dh < r[0x6454]) { this.slideSet(x); return; }
    if (dh === r[0x6454]) {
      var dl = (lo - tlo) & 0xFF;
      if (dl < r[0x6453]) { this.slideSet(x); return; }
    }
    var sub = lo - r[0x6453];                             // $6ACF: SEC SBC, the borrow into the high byte
    r[0x6447+x] = sub & 0xFF;
    r[0x644A+x] = (hi - r[0x6454] - (sub < 0 ? 1 : 0)) & 0xFF;
    return;
  }
  var dh2 = (thi - hi) & 0xFF;                            // $6AE3: up
  if (dh2 < r[0x6454]) { this.slideSet(x); return; }
  if (dh2 === r[0x6454]) {
    var dl2 = (tlo - lo) & 0xFF;
    if (dl2 < r[0x6453]) { this.slideSet(x); return; }
  }
  var add = lo + r[0x6453];                               // $6AFD: CLC ADC
  r[0x6447+x] = add & 0xFF;
  r[0x644A+x] = (hi + r[0x6454] + (add >> 8)) & 0xFF;
}; // slide

/** ★ `$6B11`: the portamento landed — the slide frequency is the note's. */
SidPlayer.prototype.slideSet = function (x) {
  var r = this.ram;
  r[0x6447+x] = r[0x63E7+x];
  r[0x644A+x] = r[0x63EA+x];
}; // slideSet

/**
 * ★ `$69B3`: the pulse sweep of a voice — every `$6435` ticks the width
 * steps; at the limit the step turns round and the limit flips.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.pulseSweep = function (x) {
  var r = this.ram;
  r[0x6432+x] = (r[0x6432+x]-1) & 0xFF;
  if (r[0x6432+x] !== 0) { return; }
  r[0x6432+x] = r[0x6435+x];
  var lo = r[0x6418+x] + r[0x641E+x];                     // $69BE: CLC ADC
  r[0x6418+x] = lo & 0xFF;
  var hi = (r[0x641B+x] + r[0x6421+x] + (lo >> 8)) & 0xFF;
  r[0x641B+x] = hi;
  if (hi !== r[0x6455+x]) { return; }                     // $69D1
  var n = (r[0x641E+x] ^ 0xFF) + 1;                       // $69D7: the step negated
  r[0x641E+x] = n & 0xFF;
  r[0x6421+x] = ((r[0x6421+x] ^ 0xFF) + (n >> 8)) & 0xFF;
  r[0x6455+x] = ((r[0x6455+x] ^ 0x0F)+1) & 0xFF;          // $69EC: TAY INY TYA
}; // pulseSweep

/**
 * ★ `$6BD4`: the vibrato of a voice — after its delay, `$645B` ticks up by
 * the step and `$645E` down, the step growing at the half; then reloaded.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.vibrato = function (x) {
  var r = this.ram;
  if (r[0x6458+x] !== 0) { r[0x6458+x] = (r[0x6458+x]-1) & 0xFF; return; }
  if (r[0x645B+x] !== 0) {                                // $6BDD: up
    if (r[0x645B+x] === r[0x646A+x]) { this.vibratoGrow(x); }
    r[0x645B+x] = (r[0x645B+x]-1) & 0xFF;
    var s = r[0x63FD+x] + r[0x6461+x];
    r[0x63FD+x] = s & 0xFF;
    r[0x6400+x] = (r[0x6400+x] + (s >> 8)) & 0xFF;
    return;
  }
  if (r[0x645E+x] !== 0) {                                // $6C00: down
    if (r[0x645E+x] === r[0x646A+x]) { this.vibratoGrow(x); }
    r[0x645E+x] = (r[0x645E+x]-1) & 0xFF;
    var d = r[0x63FD+x] - r[0x6461+x];
    r[0x63FD+x] = d & 0xFF;
    r[0x6400+x] = (r[0x6400+x] - (d < 0 ? 1 : 0)) & 0xFF;
    return;
  }
  r[0x645B+x] = r[0x645E+x] = r[0x6467+x];                // $6C23
  r[0x646A+x] = r[0x6467+x] >> 1;
}; // vibrato

/** ★ `$6C31`: the vibrato's step grows by its increment. */
SidPlayer.prototype.vibratoGrow = function (x) {
  this.ram[0x6461+x] = (this.ram[0x6461+x] + this.ram[0x6464+x]) & 0xFF;
}; // vibratoGrow

/**
 * ★ `$6C3C`: the filter sweep, on voice 1's tick only — the cutoff up by
 * twice the instrument's low nibble for `$6470` ticks, then down for `$6473`.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.filterSweep = function (x) {
  var r = this.ram;
  if (x !== 0) { return; }
  var step = ((r[0x63FC] & 0x0F) << 1) & 0xFF;
  if (r[0x6470] !== 0) {
    r[0x646D] = (r[0x646D] + step) & 0xFF;
    r[0x6470] = (r[0x6470]-1) & 0xFF;
    return;
  }
  if (r[0x6473] !== 0) {
    r[0x63C3] = step;
    r[0x646D] = (r[0x646D] - step) & 0xFF;
    r[0x6473] = (r[0x6473]-1) & 0xFF;
  }
}; // filterSweep

/**
 * ★ `$6940`: the registers of a voice — the control (the gate from the
 * row's note when `$6428` says so, else as the waveform byte has it), the
 * envelope, the pulse width, and the frequency: the note's, or the slide's
 * added to it, or the portamento's with the vibrato.
 * @param {number} x - The voice.
 */
SidPlayer.prototype.writeVoice = function (x) {
  var r = this.ram;
  var a = 0;
  if (r[0x6428+x] !== 0) { a = r[0x63F0+x] >> 7; }
  var y = r[0x63C6+x];
  this.poke(0x04+y, a | r[0x640F+x]);
  this.poke(0x05+y, r[0x6412+x]);
  this.poke(0x06+y, r[0x6415+x]);
  this.poke(0x02+y, r[0x6418+x]);
  this.poke(0x03+y, r[0x641B+x]);
  var lo, hi;
  if (r[0x644D+x] === 0) {                                // $6990: the note
    this.poke(y, r[0x63E7+x]);
    this.poke(0x01+y, r[0x63EA+x]);
    return;
  }
  if (r[0x6450+x] !== 0) {                                // $699F: the portamento with the vibrato
    lo = r[0x6447+x] + r[0x63FD+x];
    hi = r[0x644A+x] + r[0x6400+x] + (lo >> 8);
  } else {                                                // $697A: the note with the slide
    lo = r[0x63E7+x] + r[0x6447+x];
    hi = r[0x63EA+x] + r[0x644A+x] + (lo >> 8);
  }
  this.poke(y, lo & 0xFF);
  this.poke(0x01+y, hi & 0xFF);
}; // writeVoice

if (typeof self !== 'undefined') { self.SidPlayer = SidPlayer; } else if (typeof globalThis !== 'undefined') { globalThis.SidPlayer = SidPlayer; }
if (typeof module !== 'undefined' && module.exports) { module.exports = SidPlayer; }
