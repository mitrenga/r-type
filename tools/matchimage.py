#!/usr/bin/env python3
"""matchimage — is the program in memory the same, whichever image it came from?

★ Decided by the operator 2026-10-18 (`ZADANI.md` §1): until a second
independent tape dump turns up, the second and third sources are **disk
cracks**, and what is compared is **the program in memory after loading**,
not the medium. Every image is driven to the same point — level 1 loaded,
the "READY" loop asking for fire at `$0C27` — and its RAM (under the ROMs)
is saved. Then the reference (the tape) and each crack are compared region
by region; every differing byte is listed, and a difference is a finding to
be explained (trainer, crack, another build), never noise.

Each crack needs its own keys through its intro; they are scripted in
`CRACKS` and every step is a measured wait loop (address, what it waits for).

    tools/matchimage.py                 # all images, report
    tools/matchimage.py --only rawhead
"""
import argparse, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(PROJECT, '..', 'svision', 'tools', 'retro', 'c64'))
from c64emu import C64Emu  # noqa: E402
from rtboot import boot  # noqa: E402

READY = 0x0C27
DISK = os.path.join(PROJECT, 'sources', 'disk')
# ★ regions of the running game (sources/tape/README.md, disasm_notes §1)
REGIONS = [
    (0x0812, 0x5FBC, 'jádro G (kód hry)'),
    (0x6370, 0x86A1, 'úroveň 1: M (hudba a ?)'),
    (0x86AC, 0x99FF, 'úroveň 1: G'),
    (0xE000, 0xFD40, 'úroveň 1: S'),
]
# crack -> image and the monitor steps through its intro (each one measured)
CRACKS = {
    'rawhead': ('R-Type_1988_Electric_Dreams_cr_Rawhead_t_3_Rawhead.d64', [
        'break $0fba', 'g', 'r pc=$0fbf', 'del 1',       # intro: CMP $DC01 #$EF (SPACE)
        'break $f6bc', 'g', 'del 1', 'keybuf " "',        # trainer menu: GETIN, SPACE = start, all NO
        'break $82f5', 'ignore 1 $32', 'g', '> cb 04', 'del 1',   # title: F1 as on tape
    ]),
    # "R-TYPE++ 101%", Beastie Boys 18.12.1988: "original cracked from tape by
    # Hotline, trained, level-packed and improved"; adds a 2-player mode
    'bb': ('R-Type_1988_Electric_Dreams_cr_BB_t_2_BB.d64', [
        'break $1ed0', 'g', 'r pc=$1ed7', 'del 1',       # intro, IRQ: CMP $DC01 #$EF (SPACE)
        'break $0aaa', 'g', 'r pc=$0ab1', 'del 1',       # second screen: SPACE
        'break $c01f', 'g', 'r pc=$c026', 'del 1',       # info screen: SPACE
        'break $f6bc', 'g', 'del 1', 'keybuf "nnnn"',    # trainer (Y/N) via GETIN: no
        'break $82f5', 'ignore 1 $32', 'g', '> cb 04', 'del 1',   # title: F1 as on tape
    ]),
}


def dump_tape(path):
    e = boot(fire=False)
    e.brk(READY).go()
    e.bsave(path, 0, 0xFFFF, bank='ram')
    r = e.run(cycles=2_000_000_000, monlog=os.path.join(PROJECT, 'build', 'run', 'mi_tape.log'))
    return r.hit()


def dump_crack(name, path):
    image, steps = CRACKS[name]
    e = C64Emu(os.path.join(DISK, image), project=PROJECT, fast=True)
    for s in steps:
        e.cmd(s)
    e.brk(READY).go()
    e.bsave(path, 0, 0xFFFF, bank='ram')
    r = e.run(cycles=3_000_000_000, monlog=os.path.join(PROJECT, 'build', 'run', 'mi_%s.log' % name))
    return r.hit()


def runs(diffs):
    out, start, prev = [], None, None
    for a in diffs:
        if start is None: start = prev = a
        elif a == prev + 1: prev = a
        else: out.append((start, prev)); start = prev = a
    if start is not None: out.append((start, prev))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only')
    ap.add_argument('--reuse', action='store_true', help='compare dumps already in build/mem')
    a = ap.parse_args()
    out = os.path.join(PROJECT, 'build', 'mem')
    os.makedirs(out, exist_ok=True)
    ref = os.path.join(out, 'ready_tape.bin')
    if not a.reuse:
        print('tape:', 'ok' if dump_tape(ref) else 'DID NOT REACH $%04X' % READY)
    R = open(ref, 'rb').read()
    total = 0
    for name in CRACKS:
        if a.only and name != a.only:
            continue
        p = os.path.join(out, 'ready_%s.bin' % name)
        if not a.reuse:
            print('%s:' % name, 'ok' if dump_crack(name, p) else 'DID NOT REACH $%04X' % READY)
        C = open(p, 'rb').read()
        for lo, hi, what in REGIONS:
            d = [i for i in range(lo, hi) if R[i] != C[i]]
            total += hi - lo
            print('  %-8s $%04X-$%04X %-26s %6d B  %5d rozdílů' % (name, lo, hi - 1, what, hi - lo, len(d)))
            for s, e in runs(d)[:12]:
                print('      $%04X-$%04X (%d B): páska %s | crack %s' % (
                    s, e, e - s + 1, R[s:min(e + 1, s + 8)].hex(), C[s:min(e + 1, s + 8)].hex()))
            if len(runs(d)) > 12:
                print('      … %d úseků' % len(runs(d)))
    print('porovnáno %d B' % total)


if __name__ == '__main__':
    main()
