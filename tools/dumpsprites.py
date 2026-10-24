#!/usr/bin/env python3
"""dumpsprites — the sprite blocks from the tape into data/sprites.json.

★ Sprites live in VIC bank 3 **under the I/O and the KERNAL**
(`sources/docs/vic_state.md`): a pointer `p` means `$C000 + p*64`.

- **`$40`-`$7F`** (`$D000`-`$DFFF`): 64 blocks that `levelStart` (`$1794`)
  copies once from side A's `M` at `$8E53` — the ship and what belongs to
  the player (the init `$1425` clears parts of `$D000`-`$D27E`, the ship's
  shape is composed there at run time, M3).
- **`$A0`…** (`$E800`-`$FD3F`): the level's `S` after its character set —
  the enemies of that level (`$7C4A` by enemy type gives the pointer, M4).
- `$FD40`-`$FF3F` (`$F5`-`$FC`) is cleared by `$124B` and drawn into by the
  level's own code (`$9531` of level 1) — not data.

Who uses which block is read from the code where it is plain (`names`);
the rest waits for M3/M4. `tools/matchsprites.mjs` measures every block
against the memory of the running original.

    tools/dumpsprites.py       # -> data/sprites.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

BANK = 0xC000
GLOBAL = (0xD000, 0xE000)
LEVEL_FIRST = 0xE800
# ★ named by the place in the code that sets the pointer
NAMES = {
    0x4A: '$14EF: sprite 0 (the ship) at a restart; $1825/$1927 test it',
    0x44: '$147D: sprite 1 at the level start ($CFF9)',
    0x45: '$147D: sprite 2 at the level start ($CFFA)',
    0x5B: '$1829/$192B: tested with $4A, $5C, $5D (? the ship\'s shots)',
    0x5C: '$182D/$192F: tested with $4A, $5B, $5D',
    0x5D: '$1831/$1933: tested with $4A, $5B, $5C',
}


def blocks(m, lo, hi, names=None):
    out = []
    for a in range(lo, hi, 64):
        b = bytes(m[a:a+64])
        if not any(b[:63]):
            continue
        p = (a - BANK) // 64
        d = dict(pointer='$%02X' % p, addr='$%04X' % a, bytes=list(b))
        if names and p in names:
            d['what'] = names[p]
        out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'sprites.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    m0 = rtlib.image(core=core)
    glob = blocks(m0, GLOBAL[0], GLOBAL[1], NAMES)
    levels = []
    for n in range(1, 9):
        files = rtlib.level_files(n)
        m = rtlib.image(n, core=core, side_b=files)
        end = rtlib.LEVEL_S + len(files['S'])
        lv = blocks(m, LEVEL_FIRST, end)
        levels.append(dict(level=n, addr='$%04X-$%04X' % (LEVEL_FIRST, end-1), source='S', blocks=lv))
        print('level %d: %d blocks $A0-$%02X' % (n, len(lv), (end - BANK)//64 - 1))
    out = dict(
        source='R-Type, Electric Dreams tape; tools/dumpsprites.py (memory image from the tape, copy as $1794)',
        note='pointer p = $C000 + p*64 (bank 3, sprites under the I/O and the KERNAL); all-zero blocks are left out',
        blockBytes=64,
        runtime=['$1425 clears parts of $D000-$D27E (the ship is composed at run time, M3)',
                 '$124B clears $FD40-$FF3F; $9531 (level 1) draws an animation there'],
        globalBlocks=dict(addr='$D000-$DFFF', source='$8E53 (side A\'s M, $1794)', blocks=glob),
        levels=levels)
    rtlib.save_json(out, a.o, drop=('source', 'runtime',), indent=0, ensure_ascii=False)   # without the notes (rtlib.strip_notes)
    print('global %d blocks -> %s' % (len(glob), a.o))


if __name__ == '__main__':
    main()
