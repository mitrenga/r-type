![](/images/app-icon-256x256.png)

R-TYPE
=====================
The 1988 Commodore 64 conversion of the arcade classic, reborn for modern web browsers.

## About
R-Type is the 1987 arcade shooter by Irem. The Commodore 64 version came out
in 1988 under the Electric Dreams label of Activision, licensed from Irem and
developed by Rainbow Arts (Manfred Trenz, Andreas Escher; music Chris Hülsbeck
and Ramiro Vaca). This is a faithful remake based on that **Commodore 64
version** — not an emulator or a binary copy, and not the arcade game.

The R-9 fighter against the Bydo Empire: eight levels of scrolling terrain,
the detachable Force pod that shields the ship and fires through it, the
charged wave cannon, lasers, missiles and bits, and bosses that fill the
screen — the first of them, Dobkeratops, is the loading picture of the tape.

The whole game is playable: all eight levels with their enemies, waves and
bosses, the ship with every weapon, the checkpoints, GAME OVER and the end
after level 8, the original's music and sound effects on a model of the SID
chip, and the loading picture of the tape. The title screen of the original
and the end credits are still to come.

Supported:
- keyboard (redefinable keys)
- gamepad
- touchscreen
- PWA application


## Play now
Not deployed yet — the public release is the next milestone (M7).


## Controls
| key | action |
|---|---|
| arrows | fly |
| space | fire; hold to charge the beam |
| `S` | release / call back the Force |
| Esc | pause (RESUME GAME, SOUNDS, MUSIC, EXIT GAME) |

All keys can be redefined in the menu. On a gamepad the stick or d-pad
flies, one button fires and another handles the Force; on a touchscreen one
half of the picture is the stick and the other half fire, with a Force
button — the sides can be swapped in SETTINGS.


## How it is made
Nothing is redrawn or guessed. The levels, character sets, sprites, waves,
texts, the ship's tables, the enemy code and the music are extracted from
the original tape by the tools in `tools/`, and the game itself is the
original's code rewritten in JavaScript routine by routine, with its
variables at the original's addresses in a 64 KB `ram`. It runs in a web
worker at the 50 Hz of a PAL C64; the fine horizontal scroll, the three
character sets in raster bands and the sprite multiplexer are composed the
way the VIC-II composes them, and the chip's limits — eight sprites, the
multiplexer under load — are kept, not cleaned up.

Every part is checked by a `match*` tool against the running original
(VICE, driven by batch monitor scripts), and a milestone counts as done only
when the tool reports zero differences:

| what | tool | result |
|---|---|---|
| a frame of level 1 composed from the chip's memory and registers | `tools/matchscreen.mjs` | 23 frames, 1 472 000 pixels / 0 differences |
| all eight levels built and scrolled by the original's code | `tools/matchlevels.mjs` | 783 samples, 1 407 655 checks / 0 |
| character sets and sprites, byte for byte | `tools/matchcharset.mjs`, `tools/matchsprites.mjs` | 42 824 / 0, 49 696 / 0 |
| the ship, the Force, the weapons, death — frame by frame | `tools/matchship.mjs` | 17 recordings, 37 064 000 checks / 0 |
| enemies, waves, multiplexer and bosses | `tools/matchenemies.mjs` | 32 recordings, 1 433 643 140 checks; 19 recordings at 0, the rest open (long immortal flights, see `MILNIKY.md`) |
| whole games: READY, checkpoints, GAME OVER, the end | `tools/matchrules.mjs` | 24 games, 891 376 187 checks; events of all 24 match, RAM at 0 in 12 |
| sound: every write to the SID, in order | `tools/matchsound.mjs` | 24 recordings, 3 286 520 writes, 14 701 377 checks / 0 |

`tools/regress.mjs` keeps a fingerprint of a scripted game, SID writes
included, so a change anywhere shows up. The tools are `dump*.py` (the tape
→ `data/`), `trace*.py` (the original recorded in VICE) and `match*.mjs`
(the remake replayed against the recording); the milestones are in
`MILNIKY.md` and the specification in `ZADANI.md` (both in Czech, kept
outside this repository with the working notes).


## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 compatibility gate in `svtool verify` (`npm i -g es-check`)
- Python 3, only for the tools that extract and verify the data of the original
  (VICE `x64sc` under `xvfb-run` for the `trace*` tools)


## Install
(`~/` below refers to the project root, not your home directory.)
- clone this repository
- clone library repository https://github.com/mitrenga/svision **next to it** —
  `~/app/svision` is a relative symlink to `../../svision`
- check symlink ~/app/svision
- configure nginx (an example is in the Booty repository, `config/nginx.conf`)
- create path ~/js with permissions 0777
- create database (script: ~/config/createDB.sql) — without it the game runs, only the hall of fame and the statistics say they are not available
- create configuration file ~/config/config.php (example: ~/config/config.php.sample)
- build the production bundle: ~/app/svision/tools/svtool build bundle


## Developer mode
Developer mode is switched in `~/config/config.php` (both settings are optional; without them the app runs in production mode):

```php
$devMode = true;
$devModeName = '.{\"penColor\":\"#000000\",\"bkColor\":\"#fefe00\",\"width\":185}◢◤ ◢◤ ◢◤ ◢◤  DEVELOPER MODE ◢◤ ◢◤ ◢◤ ◢◤';
```

`$devMode` values:
- `true` — development: JS sources are served directly instead of the bundle and the service worker is unregistered/bypassed
- `['serviceWorker' => true]` — development, but the service worker stays enabled (for testing SW behavior against a built `js/` deploy)
- `false` or not set — production: minified bundle + service worker

`$devModeName` is a label rendered in the top border of the game screen, so a development instance is recognizable at a glance. Set it to `false` (or leave it empty) to hide the label. The value is either plain text, or text prefixed with `.{...}` — a JSON object whose properties are applied to the label's TextEntity, typically:
- `penColor` — text color
- `bkColor` — background color
- `width` — label width in game pixels (the text is centered inside it)

The config is written into a double-quoted JavaScript string, so quotes inside the JSON prefix must be escaped as `\"` (see the example above).

In developer mode the frame rate and the state of the controls are shown in
the border, not over the game screen.

### Developer parameters
In developer mode only (`Tool.devParam`): `?devLevel=N` starts the game in
level 1–8, `?devSeed=N` pins the seed of the game's randomness so a run can be
repeated, `?devImmortal=1` keeps the ship alive. The same knobs go into the
configuration as `$devMode = ['level' => 2, 'seed' => 123, 'immortal' => 1]`;
the address wins. On a production server the parameters do not exist.


## Build & tooling
The `svtool` CLI (`~/app/svision/tools/svtool`) builds and checks the deploy. Run it from the project root:
- `svtool build bundle` — minified production bundle `js/bundle.<version>.min.js` (requires terser)
- `svtool build debug-bundle` — the same concatenation left unminified, `js/bundle.<version>.js`, for debugging on a device whose console cannot be opened
- `svtool verify` — check the `js/` deploy is complete, matches the current sources, and stays within ES2018 (authoritative via es-check if installed, otherwise a heuristic scan)
- `svtool info` — show the app version, deploy state and the most recent database records
- `svtool clean` — remove everything generated from `js/`

Optional — run `svtool` from anywhere and enable bash completion (adjust the path to your svision clone):
- `sudo ln -s /path/to/svision/tools/svtool /usr/bin/svtool`
- `sudo ln -s /path/to/svision/tools/svtool-completion.bash /etc/bash_completion.d/svtool`

Open a new shell afterwards, then run `svtool <command>` from any project root.

Production serves the bundle; in development, with no bundle built, the sources under `app/` are served and loaded one by one through dynamic `import()`.


## Game data
All the data of the game are in `data/*.json` — `levels`, `charsets`,
`sprites`, `waves`, `texts`, `ship`, `enemies`, `music`, `picture`, `title`,
`global` and `screen` — described in [data/README.md](data/README.md). The
server sends them to the application in a single request (`db/appData.php`).
Each file is written by one tool from `tools/`, never by hand, so the game
runs from this repository as it is.

Regenerating or verifying the data needs the original tape image and the
Commodore 64 system ROMs, which are copyrighted and **not part of this
repository**. The tape is the Electric Dreams 1988 cassette (two sides, a
Rainbow Arts turbo loader with the eight levels on side B); it goes to
`sources/tape/`, the ROMs to `sources/rom/` (fetched by
`svision/tools/retro/fetchroms.py c64`). The tools need Python 3, VICE for
the recordings, and Node.js for the `*.mjs` tools, which load the game's own
code from `app/`.


## Repository layout
| path | contents |
|---|---|
| `app/` | the game — ES modules; the worker is a classic script |
| `data/` | the data extracted from the original (`*.json`) |
| `tools/` | extraction (`dump*`, `mk*`), recording (`trace*`) and verification (`match*`) tools |
| `db/` | PHP endpoints: game data, hall of fame, statistics |
| `config/` | database and bundle configuration |
| `images/` | icons, poster, cover |


## Credits
- **R-Type** © 1987 Irem Corp.; the Commodore 64 conversion © 1988
  Electric Dreams / Activision, developed by Rainbow Arts. This is an
  unofficial fan remake, not affiliated with the rights holders.
- Commodore 64 character ROM © Commodore / Cloanto, used for the menu
  and the dialogs through the svision library.
- Built on the [svision](https://github.com/mitrenga/svision) library; the
  original was studied with [VICE](https://vice-emu.sourceforge.io/).


## License
The remake's source code is licensed under CC BY-NC-SA 4.0, see the
[LICENSE](LICENSE) file. The license does not cover the original game — its
graphics, texts, music and the data extracted from it belong to their
authors.
