#!/usr/bin/env python3
"""rtboot — the original from tape into the game, with the operator's keys scripted.

★ The game waits for a human three times and never asks the keyboard
buffer (`sources/docs/disasm_notes.md` §0, §1), so `keybuf` cannot get it
through. The script does what the hand would:

| where   | waits for                       | the script                    |
|---------|---------------------------------|-------------------------------|
| `$9849` | SPACE after the loading picture | `r pc=$9850`                  |
| `$82F5` | F1 on the title (`$CB` = 4)     | `> cb 04` on entry            |
| `$8355` | SPACE after "INSERT SIDE B"     | `r pc=$835C`, attach side B   |

Everything else runs as on the machine (PAL, `-seed 12345`).

    from rtboot import boot
    e = boot()                     # C64Emu with the script up to the game
    e.brk(0x0815).go(); ...; e.run(...)

CLI:
    tools/rtboot.py --cycles 900000000 --screenshot build/shots/game.png
"""
import argparse, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PROJECT, '..', 'svision', 'tools', 'retro', 'c64'))
from c64emu import C64Emu  # noqa: E402
sys.path.insert(0, HERE)
from rtlib import level_tape  # noqa: E402

SIDE_A = os.path.join(PROJECT, 'sources', 'tape', 'rtype_side1.tap')
SIDE_B = os.path.join(PROJECT, 'sources', 'tape', 'rtype_side2.tap')
TITLE_IRQ = 0x82F5
TITLE_WAIT = 50          # title interrupts before F1 (the title has drawn by then)


GAME_IRQ = 0x0DE6        # ★ set at $0C50 when the level starts
LEVEL_LOADED = 0x0880    # ★ after the turbo loaded M, G and S of the level ($0860-$087F)


def boot(fast=True, title_wait=TITLE_WAIT, fire=True, level=1, **kw):
    """Checkpoints are numbered by VICE from 1 and reused after `del`, so the
    script deletes each one before it sets the next: every step is #1.

    ★ `level` > 1: side B is cut so that it begins at that level's files
    (`rtlib.level_tape`) and the level number `$0200` (0-based) is poked at
    `$0880`, right after the three files are in and before the level's
    init runs (`$088A`, `sources/docs/disasm_notes.md` §7)."""
    e = C64Emu(SIDE_A, project=PROJECT, fast=fast, **kw)
    side_b = SIDE_B
    if level > 1:
        side_b = os.path.join(PROJECT, 'build', 'tape', 'side2_level%d.tap' % level)
        if not os.path.exists(side_b):
            os.makedirs(os.path.dirname(side_b), exist_ok=True)
            level_tape(SIDE_B, level, side_b)
    e.brk(0x9849).go()                       # picture: SPACE
    e.cmd('r pc=$9850').cmd('del 1')
    e.brk(TITLE_IRQ).ignore(1, title_wait).go()   # title: F1
    e.cmd('> cb 04').cmd('del 1')
    e.brk(0x8355).go()                       # "INSERT SIDE B ... THEN PRESS SPACE"
    e.attach_tape(side_b)
    e.cmd('r pc=$835c').cmd('del 1')
    if level > 1:
        e.brk(LEVEL_LOADED).go()             # the three files are in: the level number
        e.cmd('> 0200 %02x' % (level - 1)).cmd('del 1')
    if fire:
        e.brk(0x0C27).go()                   # level loaded, "READY": fire
        e.cmd('r pc=$0c2e').cmd('del 1')
    return e


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--cycles', type=int, default=900_000_000)
    ap.add_argument('--screenshot')
    ap.add_argument('--break', dest='brk', metavar='ADDR')
    ap.add_argument('--dump', metavar='FILE', help='64 KB RAM at the break')
    ap.add_argument('--slow', action='store_true', help='x64sc instead of x64')
    ap.add_argument('--level', type=int, default=1)
    a = ap.parse_args()
    e = boot(fast=not a.slow, level=a.level)
    if a.brk:
        e.brk(int(a.brk, 16)).go().regs()
        if a.dump:
            e.bsave(a.dump, 0, 0xffff, bank='ram')
    else:
        e.go()
    r = e.run(cycles=a.cycles, screenshot=a.screenshot)
    print(r.log[-3000:])
    print('[exit %d, %s]' % (r.rc, 'checkpoint' if r.hit() else 'cycles'))


if __name__ == '__main__':
    main()
