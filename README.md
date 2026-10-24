R-TYPE (Commodore 64) — remake
==============================

R-Type is © Irem 1987; the Commodore 64 conversion was published under
licence by Activision / Electric Dreams (1988, dating to be verified) and
written by Rainbow Arts (Manfred Trenz, Andreas Escher; music Chris Hülsbeck
and Ramiro Vaca — second-hand credits). The trademark is alive and actively
held; this is an unofficial, non-commercial fan remake — the source code of
the remake is under CC BY-NC-SA 4.0 (`LICENSE`), the game belongs to its
rights holders. It is also another consumer of the Commodore 64 platform
(`C64Platform`, `C64Layout`) in the **svision** library — the first one
that needs fine horizontal scrolling and sprite multiplexing — and to
carry the `dump*` → `trace*` → `match*` method onto it.

The reference is the **C64 program**, not the Irem arcade game; the
arcade, its MAME driver and the other home ports are second-hand sources
only.

**Status: M0 done 2026-10-18** (internal until 2026-10-24, public since —
the operator's decision). The tape is decoded, the original runs into
the game in VICE, the program is matched against two disk cracks, and the
disassembly, VIC-II measurements and findings are in `sources/`. No `app/`
yet — M1 is next.

**M1 done 2026-10-18** (the visual check in a browser is the operator's):
the application boots from tape and shows a frame of level 1 composed from
the original's memory and registers the way the VIC-II composes it — fine
scroll, three character sets in raster bands, multiplexed sprites —
matching VICE's pictures pixel for pixel on 23 frames
(`tools/matchscreen.mjs`). See `ZADANI.md` (what the
game is, what ★ is measured and what ? is still hearsay), `MILNIKY.md`
(milestones with `match*` acceptance) and `sources/README.md` (what to
find and where).

**M2 done 2026-10-18** (visual check by the operator 2026-10-18): the data of
all eight levels come from the tape (`data/*.json`, `tools/dump*.py`) and
the application builds and scrolls any level (`?devLevel=N` in dev mode)
with the original's own code — the map from blocks (`$162F`), the first
screen (`$11A2`), the step (`$34FB`; level 3 scrolls a window both ways,
`$3702`) — in a worker (`app/levelScroll.js`), composed with the three
character sets and the panel (`app/levelLoader.js`). `tools/matchlevels.mjs`
compares it with the memory of the running original across all levels:
1 407 655 checks, 0 differences; `matchcharset` and `matchsprites` match
the sets and sprites byte for byte.

**M3 done 2026-10-18** (visual check by the operator 2026-10-18): the ship flies with the
original's own code (`app/ship.js` — the ship step `$2821`, the game step
`$3D74`, the enemy loop `$17FB` for items, death `$31A2`): movement and
tilt, the basic shot, the BEAM charge and the beam, the Force in every
state, the three lasers, the bits, the missiles, the explosions of the
terrain, the panel (BEAM meter, score, 1UP, lives) and the collision with
the terrain. The variables live at the original's addresses, so
`tools/matchship.mjs` compares the same bytes against VICE: 17 recordings
of `tools/traceship.py` (scripted input, items poked into the sprite slots,
a seeded generator in place of the CIA timer on both sides) across all
eight levels, 37 064 000 checks, 0 differences, frame by frame. No enemies
yet (M4) — in the game that means no crystals and no Force either.


## Developer parameters

In dev mode only (`$devMode` in `config/config.php`; R-058, `Tool.devParam`):
`?devLevel=N` starts the game in level 1–8, `?devSeed=N` pins the seed of
the game's randomness so a run can be repeated, `?devImmortal=1` keeps the
ship alive (the harness patch `$319C` = RTS). The same knobs go into the
configuration as `$devMode = ['level' => 2, 'seed' => 123, 'immortal' => 1]`;
the address wins. On a production server the parameters do not exist.

## Running it

Like every svision project:
`config/config.php` out of `config/config.php.sample` (`$devMode = true`),
serve the directory with nginx + PHP; the browser loads `app/` directly,
nothing is built. The games played go into a local MariaDB (the statistics
behind the heading of ABOUT, the high score): `mysql < config/createDB.sql`
makes the database `rtype` with `rg_rt_hallOfFame`, the credentials go
into `config.php`; without a database the game runs the same, only the
statistics say they are not available.

Tools (M3): `tools/dumpship.py` (tables and start values of the ship's code
→ `data/ship.json`), `tools/traceship.py` (the original with scripted input,
hooks at `$6000`), `tools/matchship.mjs` (the acceptance tool),
`tools/debugship.mjs` (both sides of a difference).

**M4 done 2026-10-18** (visual check by the operator pending): the enemies,
the waves, the multiplexer and the bosses are the original's code —
`app/enemies.js` (the spawner `$4FA8`, the state machine `$518D`, the enemy
loop `$17FB`, the bullets `$2498`, the boss `$56CF`-`$5E46`) and
`app/levelCode.js` (the hook of every level's chain and the boss steps in
its `M`/`G`), with the variables at the original's addresses (`ram` to
`$9FFF`, `data/enemies.json`). The column shift of the original is ~16 000
cycles the interrupt chain nests into; the remake advances it part by part
to the measured state (`tools/traceenemies.py --timing`) and, in the game,
to the typical one (`Ship.shiftEstimate`, R-053). Findings:
`sources/docs/disasm_notes.md` §12.

Tools (M4): `tools/dumpenemies.py` (the memory of the enemy and boss code
→ `data/enemies.json`), `tools/traceenemies.py` (the original with its
enemies and bosses, scenarios e/f/g/h, `--timing`), `tools/matchenemies.mjs`
(the acceptance tool: 32 recordings, the state of every slot, the boss,
the level's code, the screen, the sprites), `tools/scancoverage.mjs` (what
the recordings cover), `tools/dumpasm.py` (now also `sources/asm/level<N>.asm`).

Tools (M0): `svision/tools/retro/c64/c64emu.py` (VICE under `xvfb-run`,
batch monitor scripts) and `c64tape.py` (TAP and KERNAL blocks),
`tools/rtlib.py` (the Rainbow Arts turbo), `tools/rtboot.py` (the original
from tape into the game), `tools/tracecoverage.py`, `tools/dumpasm.py`,
`tools/scanhw.py`, `svision/tools/retro/fetchroms.py c64`
(system ROMs into `sources/rom/`, prints only without `--confirm`),
`svision/tools/retro/dis6502.py` (C64 symbols), `tools/matchimage.py`
(three independent images → one program, per level if the game
multiloads), `tools/dumpvic.py` (VIC-II registers at every handler of the raster
interrupt chain → `sources/docs/vic_state.md`).

Tools (M2): `tools/dumplevels.py`, `dumpcharset.py`, `dumpsprites.py`,
`dumpwaves.py`, `dumptexts.py`, `dumpglobal.py` (the tape → `data/`),
`tools/tracelevels.py` (the original scrolling through a level, sampled
in VICE; `rtboot.boot(level=N)` boots straight into any level),
`tools/matchlevels.mjs`, `matchcharset.mjs`, `matchsprites.mjs`.

The original program images and the Commodore ROMs are copyrighted and are
**not** part of this directory; see `sources/README.md`.
