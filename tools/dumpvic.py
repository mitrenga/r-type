#!/usr/bin/env python3
"""dumpvic — VIC-II registers at every raster interrupt of the game, frame by frame.

★ The game's frame is a **chain of raster interrupts**, each handler setting
the next one through CINV `$0314` and `$D012` (`sources/docs/disasm_notes.md`
§2). This tool stops at the entry of every handler of the chain for
`--frames` consecutive frames, starting `--at` game interrupts into level 1,
and records the raster line, the VIC registers, CIA 2 port A (the VIC bank)
and the sprite pointers. The values at a handler's entry are what the
previous one left — the state of the band above it.

★ The monitor's `m` command **hangs** in a batch run (even over RAM — it
waits on its pager), so every stop saves its bytes with `bsave` into
`build/vic/<name>/NNN_*.bin` instead. `chis` and `bsave` do not hang.

    tools/dumpvic.py --at 300 --frames 3 -o build/vic/at300.json
"""
import argparse, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot, GAME_IRQ  # noqa: E402

# ★ the chain during level play (disasm_notes §2)
CHAIN = [0x0DE6, 0x0EC5, 0x0F4D, 0x0D04, 0x0F6C, 0x0FB7, 0x1066, 0x10B6, 0x114C]
STOP = re.compile(r'#\d+ \(Stop on\s+exec ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--at', type=int, default=300, help='game interrupts into the level')
    ap.add_argument('--frames', type=int, default=3)
    ap.add_argument('--immortal', action='store_true', help='$319C <- RTS (see tracecoverage.py)')
    ap.add_argument('-o', required=True)
    a = ap.parse_args()

    e = boot()
    if a.immortal:
        e.cmd('> 319c 60')
    e.brk(GAME_IRQ).ignore(1, a.at).go()
    e.cmd('del 1')
    for addr in CHAIN:
        e.brk(addr)
    stops = a.frames * len(CHAIN)
    tmp = os.path.join(PROJECT, 'build', 'vic', os.path.splitext(os.path.basename(a.o))[0])
    os.makedirs(tmp, exist_ok=True)
    for n in range(stops):
        e.go()
        e.bsave('%s/%03d_vic.bin' % (tmp, n), 0xD000, 0xD02E)
        e.bsave('%s/%03d_cia2.bin' % (tmp, n), 0xDD00, 0xDD00)
        e.bsave('%s/%03d_scr.bin' % (tmp, n), 0xCC00, 0xCFFF, bank='ram')   # ★ bank 3, $D018 $32: screen + pointers
    r = e.run(cycles=2_000_000_000, monlog=os.path.join(PROJECT, 'build', 'run', 'dumpvic.log'))

    out = []
    hits = [s for s in STOP.finditer(r.log) if int(s.group(1), 16) in CHAIN]
    for s in hits[1:stops + 1]:        # hits[0] is the `--at` stop itself
        n = len(out)
        vic = open('%s/%03d_vic.bin' % (tmp, n), 'rb').read()
        out.append(dict(handler='%04X' % int(s.group(1), 16), line=int(s.group(2)),
                        cycle=int(s.group(3)), vic=vic.hex(),
                        dd00=open('%s/%03d_cia2.bin' % (tmp, n), 'rb').read().hex()))
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    json.dump(dict(at=a.at, frames=a.frames, chain=['%04X' % c for c in CHAIN], stops=out),
              open(a.o, 'w'), indent=1)
    print('%d stops -> %s' % (len(out), a.o))


if __name__ == '__main__':
    main()
