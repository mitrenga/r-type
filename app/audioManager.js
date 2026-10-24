const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioChipHandler } = await import('./svision/js/audio/audioChipHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { SID } = await import('./svision/js/audio/chip/sid.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * The sound of R-Type: one bus, **`sid`**, which is the machine's own chip
 * (svision `audio/chip/sid.js`, the 6581 at the PAL clock) driven by the
 * register writes the worker reports frame by frame (`frame.sid`,
 * `WORKER-PROTOCOL.md`) — ★ what the player of the level's `M` writes into
 * `$D400`-`$D418` where it writes it (`app/sidPlayer.js`, M6): the tune of
 * the level, the boss's, the sequence's and GAME OVER's, and the effects,
 * which are tracks of the same song on voice 3. The stream runs in an
 * AudioWorklet (svision `AudioChipHandler`, `ChipStream`, R-040/R-044): the
 * writes keep their place in the frame, the audio thread keeps its clock.
 *
 * **Two sliders over the one chip** (R-055): ★ the original has no
 * music/effects switch — F7 is its pause (`sources/docs/disasm_notes.md`
 * §1) — and its effects play on the voice the tune plays on, so the split
 * is not a bus: the worker says beside the writes which voice has taken an
 * effect and when the tune took it back (`frame.sidRoles`), the model of
 * the 6581 scales each voice by the gain of its **role**, and MUSIC and
 * SOUNDS of the menu are those two gains (the volume cookies of the
 * siblings, `audioBusMusicLevel` / `audioBusSoundsLevel`). The menu's
 * dialogs open buses of their own, `music` and `sounds`, for their samples,
 * and ABOUT a `title` bus for ★ the tune of the original's title screen,
 * played once (`app/aboutModel.js`, `music.title`).
 * The menu itself is silent and closes every bus (R-024); the `sid` bus
 * opens in the game behind the user's gesture. A browser without
 * AudioWorklet gets the silent handler.
 */
export class AudioManager extends AbstractAudioManager {

  /**
   * ★ The bus of the chip: the 6581 at 985 248 Hz, fifty frames a second,
   * and the unit a write is placed by is **a cycle of the 6510** — 19 656
   * of them in a PAL frame (R-038, R-044). The writes are placed 60 ms
   * ahead of the audio thread. `gain` 3 brings the chip's own scale up to
   * the loudness of the sibling remakes at the same slider.
   */
  static get SID_OPTIONS() {
    return {chip: 'SID', chipSource: 'audio/chip/sid.js', clock: SID.CLOCK_PAL,
            rate: 50, lines: 19656, latency: 0.06, maxLead: 0.25, gain: 3};
  } // SID_OPTIONS

  /** the effects of the SOUNDS sample: the plain shot ten times (`$3413`'s number 0, the one `Ship.sound` plays on fire; operator 2026-10-21) */
  static get SAMPLE_EFFECTS() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  /** frames between the shots of the sample: ★ the shot is 5 frames of rest and 9 of sound with no release in the original's data, 15 is the closest they play whole */
  static get SAMPLE_EVERY() { return 15; }

  /**
   * ★ M6: asks the worker for the samples of the volume dialogs that are not
   * here yet — the opening of level 1's tune played by the game's own player
   * (MUSIC, ten seconds) and the beam shot ten times over it (SOUNDS, one
   * every 15 frames; the tune under them muted by its role, R-055). The
   * answers land in `sample` (`MainApp`, the worker's messages). Called by
   * the menu once the song is in storage, and by the SOUNDS / MUSIC screen.
   * @param {Object} music - `data/music.json`, or null when not here yet.
   * @returns {boolean} Whether anything was asked for.
   */
  askSamples(music) {
    var worker = this.app.worker;
    if (!worker || !music) {
      return false;
    }
    var asked = false;
    if (!this.sample.music) {
      worker.postMessage({message: 'sample', kind: 'music', music: music, level: 1, frames: 500});
      asked = true;
    }
    if (!this.sample.sounds) {
      var effects = AudioManager.SAMPLE_EFFECTS, every = AudioManager.SAMPLE_EVERY;
      worker.postMessage({message: 'sample', kind: 'sounds', music: music, level: 1, frames: every*effects.length+1, effects: effects, every: every});
      asked = true;
    }
    return asked;
  } // askSamples

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.music = this.cookieLevel('audioBusMusicLevel');
    this.volume.sounds = this.cookieLevel('audioBusSoundsLevel');
    /**
     * ★ The samples of the volume dialogs: the opening of level 1's tune
     * (`music`) and a few effects over it (`sounds`) as frames of writes,
     * **played by the game's own player** in the worker (`sample` message,
     * `app/gameWorker.js`) and kept here by the menu; until they arrive the
     * dialogs play a plain note.
     */
    this.sample = {music: null, sounds: null, title: null};
  } // constructor

  /**
   * @param {string} cookie - The volume cookie.
   * @returns {number} 0-10.
   */
  cookieLevel(cookie) {
    return Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie(cookie, 5)))));
  } // cookieLevel

  /**
   * The handler of a bus: the chip in a worklet, or the silent one when
   * nothing would be heard (unless the volume dialog says otherwise) or when
   * the worklet is not supported.
   *
   * - `sid`, the game: the bus at full gain and the **roles** at the two
   *   sliders — the tune at MUSIC, the effects at SOUNDS;
   * - `music`, `sounds`, the dialogs' samples: the bus at its own slider;
   *   under the effects the tune is muted by its role.
   * @param {string} bus - The bus asked for.
   * @param {Object} options - The bus options, which the chip's are put into.
   * @returns {Object|boolean} The handler, or false for a bus that is not ours.
   */
  createAudioHandler(bus, options) {
    if (bus != 'sid' && bus != 'music' && bus != 'sounds' && bus != 'title') {
      return false;
    }
    var music = this.volumeLevel(this.volume.music), sounds = this.volumeLevel(this.volume.sounds);
    // the title's tune under ABOUT goes at the MUSIC slider
    var volume = bus == 'sid' ? Math.max(music, sounds) : this.volumeLevel(this.volume[bus == 'title' ? 'music' : bus]);
    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }
    if (this.unsupportedAudioBus === false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }
    if (this.unsupportedAudioBus !== false) {
      Tool.writeCookie('unsupportedAudioBus', 'AudioChipHandler');
      return new AudioSilentHandler(this.app);
    }
    Object.assign(options, AudioManager.SID_OPTIONS);
    var handler = new AudioChipHandler(this.app);
    if (bus == 'sid') {
      handler.setBusVolume(1);
      handler.setRoleGain(SID.ROLE_MUSIC, this.roleGain('music'));
      handler.setRoleGain(SID.ROLE_EFFECTS, this.roleGain('sounds'));
    } else {
      handler.setBusVolume(volume);
      handler.setRoleGain(SID.ROLE_MUSIC, bus == 'sounds' ? 0 : 1);
      handler.setRoleGain(SID.ROLE_EFFECTS, 1);
    }
    return handler;
  } // createAudioHandler

  /**
   * ★ A slider moved while its bus is open (the volume dialog, VolumeControl):
   * the open bus gets the sliders' levels again, the way createAudioHandler
   * set them — the game's `sid` its two roles, a sample's bus its gain, the
   * title's the MUSIC slider.
   * @param {string} bus - The bus whose level may have changed.
   */
  refreshVolume(bus) {
    var handler = this.buses[bus];
    if (!handler || typeof handler.setBusVolume !== 'function') {
      return;
    }
    if (bus == 'sid') {
      handler.setRoleGain(SID.ROLE_MUSIC, this.roleGain('music'));
      handler.setRoleGain(SID.ROLE_EFFECTS, this.roleGain('sounds'));
    } else {
      handler.setBusVolume(this.volumeLevel(this.volume[bus == 'title' ? 'music' : bus]));
    }
  } // refreshVolume

  /**
   * The gain of a role of the game's `sid` bus: its slider, or nothing while
   * the pause panel has it switched off (`app.muted`, SOUNDS / MUSIC). The
   * dialogs' sample buses do not look at the switch — a slider one moves
   * ought to be heard.
   * @param {string} role - `music` or `sounds`.
   * @returns {number} The gain.
   */
  roleGain(role) {
    return this.app.muted && this.app.muted[role] ? 0 : this.volumeLevel(this.volume[role]);
  } // roleGain

  /** the slider's ten steps as a gain, the table of the sibling remakes */
  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

  /**
   * A frame of the game into the `sid` bus: the writes, and the voices'
   * role changes as the pseudo-registers of the model (R-055), placed in
   * the frame where the player made them.
   * @param {number} frame - The frame number.
   * @param {Array} [writes] - `[[cycle, register, value], …]`.
   * @param {Array} [roles] - `[[cycle, voice, role], …]`.
   */
  writeFrame(frame, writes, roles) {
    var all = writes ? writes.slice() : [];
    if (roles) {
      for (var i = 0; i < roles.length; i++) {
        all.push([roles[i][0], SID.ROLE_REGISTER+roles[i][1], roles[i][2]]);
      }
    }
    this.writeChip('sid', {frame: frame, writes: all});
  } // writeFrame

  /**
   * The sample of a volume dialog: ★ the first seconds of **level 1's
   * tune** as the game's player writes them (`sample.music`), the effects
   * over it (`sample.sounds`), or — before the worker answered — a plain
   * pulse note of the chip for a second.
   * @param {string} bus - The bus: `music` or `sounds`.
   * @param {string} sound - Which sample.
   * @param {Object} options - Unused.
   * @returns {Object|boolean} `{script: [[…writes], …]}` or false.
   */
  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }
    if (bus == 'title' && sound == 'titleTune') {
      return this.sample.title && this.sample.title.length ? {script: this.sample.title} : false;
    }
    if ((bus == 'music' && sound == 'exampleMusic') || (bus == 'sounds' && sound == 'exampleSound')) {
      if (this.sample[bus] && this.sample[bus].length) {
        return {script: this.sample[bus]};
      }
      var frames = [];
      for (var f = 0; f < 50; f++) {
        var writes = [];
        if (f == 0) {
          // voice 1: a pulse at about 440 Hz ($1CD6), no attack, full sustain, the volume the game runs at
          writes.push([0, 0x18, 0x0F], [0, 0x02, 0x00], [0, 0x03, 0x08], [0, 0x05, 0x00], [0, 0x06, 0xF0],
                      [0, 0x00, 0xD6], [0, 0x01, 0x1C], [0, 0x04, 0x41]);
          if (bus == 'sounds') { writes.unshift([0, SID.ROLE_REGISTER, SID.ROLE_EFFECTS]); }
        }
        if (f == 40) {
          writes.push([0, 0x04, 0x40]);
        }
        frames.push(writes);
      }
      frames.push([[0, 0x04, 0x08], [0, 0x18, 0x00]]);
      return {script: frames};
    }
    return false;
  } // audioData

} // AudioManager
