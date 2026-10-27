# tools/

The remake's tools. `../../STANDARDS.md` applies to them, as does the
`dump*` → `trace*` → `match*` methodology from `../../METHODOLOGY.md`:

- **`dump*` / `mk*`** pull data out of the original and store it in `../data/`
- **`trace*`** record the running original — the recording is what we measure against
- **`match*`** compare the remake with the original and **print the number of
  checks and the number of differences**. A milestone is done when the
  differences are zero.

The Python tools read the tape from `../sources/tape/` and run the original
in VICE `x64sc` under `xvfb-run` (the `trace*` tools and `mkscreen.py`), with
the C64 ROMs in `../sources/rom/` (`svision/tools/retro/fetchroms.py c64`).
The Node tools (`*.mjs`) run **the real code from `../app/`**, loaded through
the shim `app/svision/tools/nodeEnv.mjs` (R-001); the worker's classic
scripts come through `app/svision/tools/classicScript.cjs`. The recordings
go to `../build/`, which is not in git. Every tool says how it is run in the
comment at its top.

## Tape, boot and disassembly

| tool | what it does |
|---|---|
| `rtlib.py` | **the one place that says what is on the tape**: the Rainbow Arts turbo of `BOOT` block by block, and `image()`, the program in memory after loading. |
| `rtboot.py` | the original from tape into the game in VICE, with the operator's keys scripted (SPACE after the loading picture, the tape sides, fire); `boot(level=N)` starts straight in level N. The harness of every `trace*` tool. |
| `matchimage.py` | the program in memory after loading, from the tape and from the disk cracks, compared region by region; every differing byte must be named. |
| `tracecoverage.py` | which instructions the original executes: the CPU history sampled every few game interrupts → `sources/asm/coverage_samples.txt`. |
| `dumpasm.py` | disassembly into `sources/asm/` through `svision/tools/retro/dis6502.py`, from entry points read from the code and sampled by `tracecoverage.py`. |
| `scanhw.py` | which instructions of the disassembly touch the hardware (`$D000`-`$DFFF`, the interrupt vectors, banking), grouped by register. |
| `dumpvic.py` | the VIC-II registers at every raster interrupt of the chain, frame by frame. |

## Screen (M1)

| tool | what it does |
|---|---|
| `mkscreen.py` | one frame of the original as data — memory at the top of the playfield and **every store** to the VIC-II and the sprite pointers with its raster line and cycle — and the same frame as VICE drew it. |
| `matchscreen.mjs` | the frame composed by svision (`C64TextRAM` with the fine scroll, 38 columns and splits, `C64Sprites`, the border) against VICE's pixels, pixel by pixel. |
| `dumppicture.py` | the loading picture of side A (file `P`) → `data/picture.json`. |
| `dumptitle.py` | the logo of the title screen → `data/title.json`. |

## Levels, character sets, sprites, texts (M2)

| tool | what it does |
|---|---|
| `dumplevels.py` | the eight levels from the tape (files `M`, `G`, `S`; the map script, blocks, the level's own code) → `data/levels.json`. |
| `dumpcharset.py` | the three character sets of the raster bands → `data/charsets.json`. |
| `dumpsprites.py` | the sprite blocks of VIC bank 3 → `data/sprites.json`. |
| `dumptexts.py` | the texts, the panel and the colour tables, each block with its printer → `data/texts.json`. |
| `dumpglobal.py` | the core's tables and constants → `data/global.json`. |
| `dumpwaves.py` | the enemy waves and the enemy-type tables of each level → `data/waves.json`. |
| `tracelevels.py` | the original scrolling through a level: the RAM at the first `$08C1` and samples of the screen, colour RAM and state. |
| `matchlevels.mjs` | the level built and scrolled by `app/levelScroll.js` against the memory of the running original. |
| `matchcharset.mjs` | `data/charsets.json` against the RAM of every level. |
| `matchsprites.mjs` | `data/sprites.json` against the RAM of every level, decoded by `C64SpriteData`. |
| `matchcompose.mjs` | the level loader's picture (`app/levelLoader.js`) against the recorded frames of M1, pixel by pixel. |

## Ship (M3)

| tool | what it does |
|---|---|
| `dumpship.py` | the tables and start values of the ship's code → `data/ship.json`. |
| `traceship.py` | the original flying the ship with scripted input, the joystick, space bar and `$DC04` replaced by hooks at `$6000` (R-052), no enemies. |
| `matchship.mjs` | `app/ship.js` against the recordings, the RAM at the original's addresses frame by frame. |
| `debugship.mjs` | the remake and the original side by side for a range of samples and chosen addresses — where a difference of `matchship.mjs` comes from. |

## Enemies (M4)

| tool | what it does |
|---|---|
| `dumpenemies.py` | the memory the enemy code works in, as the tape holds it → `data/enemies.json`. |
| `traceenemies.py` | the harness of `traceship.py` with the wave spawner in: enemies, waves and the boss of each level. |
| `matchenemies.mjs` | `app/enemies.js` + `app/levelCode.js` against the recordings: the enemies, the waves, the multiplexer's slots and the bosses (R-053). |
| `scancoverage.mjs` | what the recordings cover (enemy types, path commands, multiplexer crossings), so that a zero of `matchenemies.mjs` proves something. |

## Rules around a level (M5)

| tool | what it does |
|---|---|
| `tracerules.py` | whole games in the original: deaths, READY, the checkpoint, the end of a level, the next level from tape, GAME OVER. |
| `matchrules.mjs` | `app/gameRules.js` with the ship and the enemies against those games, stop by stop (R-054). |

## Sound (M6)

| tool | what it does |
|---|---|
| `dumpmusic.py` | the SID player's memory of every level's `M` → `data/music.json`. |
| `tracesound.py` | a second pass over a recording of `tracerules.py`: every write into the SID with its place. |
| `matchsound.mjs` | `app/sidPlayer.js` against those writes, write by write, and the player's variables. |

## Worker

| tool | what it does |
|---|---|
| `runworker.mjs` | `app/gameWorker.js` without a browser (`app/WORKER-PROTOCOL.md`): the answers, whole frames, and the same seed giving the same sequence. |
| `regress.mjs` | the fingerprint of a scripted game against `regress/reference.json` — regress, not match: no original here, only the last state of the remake. |
