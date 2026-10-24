#!/usr/bin/env python3
"""tracecoverage — which instructions the original executes, sampled from a run.

The run is `rtboot.boot()` (tape A, title, tape B, level 1, fire). Then
every `--every` game interrupts (`$0DE6`, `rtboot.GAME_IRQ`) the monitor
prints the CPU history (`chis N`, the last N instructions), and every PC in
it is an executed instruction. The PCs go to
`sources/asm/coverage_samples.txt`, where `dis6502.py --coverage` takes them
as entry points (`dumpasm.py`).

★ It is a **sample**, not a trace: what ran between the windows is not seen.
It says "this is code", never "this is not". The memory image of the same
run (`build/mem/game_ram.bin`, RAM under the ROMs) is what the disassembly
reads.

    tools/tracecoverage.py --samples 40 --every 25 --history 6000
"""
import argparse, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot, GAME_IRQ  # noqa: E402

PC = re.compile(r'^\.C:([0-9a-f]{4})\s', re.M)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--samples', type=int, default=40)
    ap.add_argument('--every', type=int, default=25)
    ap.add_argument('--history', type=int, default=6000)
    ap.add_argument('-o', default=os.path.join(PROJECT, 'sources', 'asm', 'coverage_samples.txt'))
    ap.add_argument('--immortal', action='store_true',
                    help='$319C <- RTS: collisions off, so one life covers the level '
                         '(second hand, C64-Wiki "tape v1"; the bytes there are checked)')
    ap.add_argument('--image', default=os.path.join(PROJECT, 'build', 'mem', 'game_ram.bin'))
    a = ap.parse_args()

    e = boot()
    if a.immortal:
        e.cmd('> 319c 60')
    e.brk(GAME_IRQ)
    for i in range(a.samples):
        e.ignore(1, a.every).go()
        if i == 0:
            # ★ the first window reaches back into loading (KERNAL, the
            # turbo, the title) — code that is no longer in memory
            e.bsave(a.image, 0, 0xffff, bank='ram')
        else:
            e.history(a.history)
    r = e.run(cycles=2_000_000_000, monlog=os.path.join(PROJECT, 'build', 'run', 'coverage.log'))
    pcs = sorted({int(x, 16) for x in PC.findall(r.log)})
    hits = r.log.count('(Stop on  exec')
    os.makedirs(os.path.dirname(a.o), exist_ok=True)
    with open(a.o, 'w') as f:
        f.write('# PC vzorkované z běhu originálu (tools/tracecoverage.py): %d zastavení '
                'na $%04X po %d přerušeních, historie %d instrukcí%s\n'
                % (hits, GAME_IRQ, a.every, a.history,
                   ', kolize vypnuté ($319C = RTS)' if a.immortal else ''))
        for pc in pcs:
            f.write('%04X\n' % pc)
    print('%d stops, %d distinct PCs -> %s' % (hits, len(pcs), a.o))


if __name__ == '__main__':
    main()
