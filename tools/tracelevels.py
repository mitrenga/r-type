#!/usr/bin/env python3
"""tracelevels — the original scrolling through a level, sampled from a run.

For `matchlevels.mjs` (M2). The original boots straight into level N
(`rtboot.boot(level=N)`: side B cut to that level's files, `$0200` poked),
fire is pressed, and the run is sampled:

1. **`init`** — the whole RAM (under the ROMs) and the I/O page at the
   first entry of the main loop `$08C1`: the level's files are in, its init
   ran (`$088A`-`$08BE`: the map unpacked to `$9A00`, the character set
   copied to `$C000`, the screen built from the map by `$11A2`), the
   interrupt chain runs. The raster line of that moment goes to `meta.json`
   — it says whether the scroll step of that frame has already run.
2. **samples** every `--every` frames at **`$0DBA`** — the tail of the
   `$0D04` handler (raster 48), the instruction that decides whether the
   scroll step `$34FB` runs this frame: screen RAM, colour RAM, the VIC
   registers, the character sets and the game's state page. ★ Why there:
   a column shift takes some 18 000 cycles plus the interrupts nested in
   it — almost a whole frame — so a sample at the entry of `$0D04` or at
   `$114C` (raster 141) may catch it half done (measured: at `$0D04`
   between `$3636` and `$3650`, screen shifted, column not yet drawn). At
   `$0DBA` the previous step is complete, because the step runs inside
   this very handler and the next one cannot start before it returns. So
   hit *h* of `$0DBA` after the init sees exactly *h* − 1 steps, whatever
   the raster line of the init was.

Two patches make the run show **only the scroll**: `$319C` = `RTS`
(collisions off — second hand, verified in M0) and **`$4FA8` = `RTS`**
(★ the wave spawner, `disasm_notes.md` §8 — nothing is launched, so nothing
but the level's own code writes to the screen). What then still differs
between the sample and the remake's scroll is a finding.

    tools/tracelevels.py --level 1              # -> build/levels/l1/
    tools/tracelevels.py --all
"""
import argparse, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot  # noqa: E402

MAIN_LOOP = 0x08C1
TOP = 0x0DBA                   # ★ the tail of irqTop ($0D04): the step $34FB follows (disasm_notes §2)
COLLISION, SPAWNER = 0x319C, 0x4FA8
# ★ end pointer of each level ($13DA/$13E2) minus the start ($9A27): columns
# to scroll; level 3 (index 2) scrolls vertically by a script of its own
COLUMNS = [0x9BBB-0x9A27, 0x9B6A-0x9A27, None, 0x9B88-0x9A27, 0x9B7D-0x9A27,
           0x9B46-0x9A27, 0x9B31-0x9A27, 0x9AFF-0x9A27]
FRAMES_PER_COLUMN = 16         # ★ 1 px / 2 frames, 8 px a column (§5)
STOP = re.compile(r'#\d+ \(Stop on\s+exec ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')


def record(level, every, frames, out, immortal=True, no_waves=True):
    os.makedirs(out, exist_ok=True)
    e = boot(level=level)
    if immortal:
        e.cmd('> %04x 60' % COLLISION)
    if no_waves:
        e.cmd('> %04x 60' % SPAWNER)
    e.brk(MAIN_LOOP).go()
    e.bsave(os.path.join(out, 'init_ram.bin'), 0, 0xFFFF, bank='ram')
    e.bsave(os.path.join(out, 'init_io.bin'), 0xD000, 0xDFFF, bank='io')
    e.cmd('del 1')
    e.brk(TOP)
    samples = frames // every
    for k in range(1, samples+1):
        e.ignore(1, every).go()
        p = os.path.join(out, 's%05d_' % (k*every))
        e.bsave(p+'state.bin', 0x0000, 0x03FF, bank='ram')
        e.bsave(p+'vars.bin', 0x3600, 0x3BFF, bank='ram')
        e.bsave(p+'bank.bin', 0xC000, 0xCFFF, bank='ram')
        e.bsave(p+'set2.bin', 0xE000, 0xE7FF, bank='ram')
        e.bsave(p+'color.bin', 0xD800, 0xDBFF, bank='io')
        e.bsave(p+'vic.bin', 0xD000, 0xD02E, bank='io')
    r = e.run(cycles=400_000_000 + frames*19656*2,
              monlog=os.path.join(out, 'monitor.log'), moncmds=os.path.join(out, 'moncmds.txt'))
    stops = STOP.findall(r.log)
    init = next((s for s in stops if s[0] == '%04x' % MAIN_LOOP), None)
    tops = [s for s in stops if s[0] == '%04x' % TOP]
    meta = dict(level=level, every=every, frames=frames, samples=len(tops), sampleAt='$%04X' % TOP,
                immortal=immortal, noWaves=no_waves,
                initRaster=int(init[1]) if init else None, initCycle=int(init[2]) if init else None,
                note='init = RAM at the first $08C1; samples at $0DBA: sample k is hit k*(every+1) of the '
                     'checkpoint since init (VICE: ignore N skips N hits) and sees k*(every+1)-1 scroll steps; '
                     'patches $319C/$4FA8 = RTS')
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    print('level %d: init at raster %s, %d samples of %d -> %s' % (level, meta['initRaster'], len(tops), samples, out))
    return len(tops) == samples


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--every', type=int, default=47, help='hits skipped between samples (48 frames, a multiple of the 16 of a column)')
    ap.add_argument('--frames', type=int, help='how far (default: the level\'s length)')
    ap.add_argument('--mortal', action='store_true', help='leave collisions on')
    ap.add_argument('--waves', action='store_true', help='leave the wave spawner on')
    a = ap.parse_args()
    levels = range(1, 9) if a.all else [a.level]
    ok = True
    for level in levels:
        cols = COLUMNS[level-1]
        frames = a.frames or ((cols*FRAMES_PER_COLUMN + 64) if cols else 8000)
        ok &= record(level, a.every, frames, os.path.join(PROJECT, 'build', 'levels', 'l%d' % level),
                     immortal=not a.mortal, no_waves=not a.waves)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
