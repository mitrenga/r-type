#!/usr/bin/env python3
"""dumpenemies — the memory the enemy code works in, into data/enemies.json.

★ `app/enemies.js` and `app/levelCode.js` are the original's routines with
their variables **at the addresses the original keeps them** (M4, as the
ship's in M3), and some of those variables are operands of self-modifying
instructions in the middle of the code (`$5111` the formation flag, `$56CC`-
`$56CE` the round-robins of the slots, `$573E`… the boss's tables, `$5860`…
the row handler's pointers, `$8651`-`$8653` level 1's countdown…). So the
remake gets the bytes as the tape holds them, and `tools/matchenemies.mjs`
compares the same ranges whole against the running original:

- **core**: `$4F00`-`$5FBB` of `G` (side A) — the spawner, the state
  machine, the boss and the end of the level with their tables and operands
  (the enemy loop `$17FB`-`$1B60` reads only what `ship.json` carries);
- per level: **`M`** from `$7AC0` to `$86AC` — the end object's record
  (`$7AC0`), the wave pointers (`$7AD2`), the fourteen type tables
  (`$7AD6`-`$7DFC`, `waves.json` reads them too), the wave table, the boss's
  tables and its step with its variables — including what the title's `M`
  left beyond the level's file (level 3's wave table runs into it);
- per level: **`G`** from `$8E6C` to `$9A00` — the block table and the map
  script (`levels.json` has them decoded) and the level's own code: the hook
  of the chain and its animations, with their variables.

    tools/dumpenemies.py       # -> data/enemies.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

CORE = (0x4F00, 0x5FBC)
LEVEL_M = (0x7AC0, 0x86AC)
LEVEL_G = (0x8E6C, 0x9A00)
# ★ the variables and operands inside the code, for the reader (disasm_notes.md §12)
CORE_VARS = {
    '$505F': 'operand: the Y of the enemy being launched ($4FFC)',
    '$5111': 'a formation is being launched ($50FD)',
    '$52BD/$52BF': 'operands: the high bytes of the ship and the enemy in the homing X path ($52AA)',
    '$56BD-$56CB': 'the X high bit a slot takes ($56BD,X)',
    '$56CC-$56CE': 'the round-robins of the three groups of slots',
    '$573E-$5761': 'operands: the boss\'s five tables ($56FF-$5738)',
    '$57EF/$57F0': 'operand: the boss\'s colour table restored after a flash ($57E0)',
    '$57F8/$57F9': 'operand: the level\'s boss step, JSR ($56F3)',
    '$5860-$5874': 'operands: the sprite pointers of the boss\'s row shown next ($581E-$5839)',
    '$58E2-$58E8': 'level 1: X expansion of the boss\'s rows',
    '$58E9-$58EF': 'the boss: index, rows, flash, hits (16 bit), zone rows, the row scanned',
    '$58F0-$5901': 'the widths of the boss\'s hit zones (from $7AC7)',
    '$5A24': 'operand (always 0)',
    '$5A4B': 'operand: the beam\'s hits on the boss ($5A43)',
    '$5D98-$5DB0': 'level 4\'s boss: the X/2, Y, sizes, scan sizes of its three parts, the round-robin $5DAA, states $5DAB, hits $5DAE',
}
LEVEL_VARS = {
    1: {'$8647-$8658': 'the pointers and masks of the five sprite columns ($85A6)', '$8651-$8653': 'the arms\' tick and the countdown of the weak spot',
        '$8659-$8678': 'hit zones by the tail\'s phase', '$94B8-$94D6': 'the six shooting stars and the random star counter',
        '$95C3-$95CE, $961D/$961E': 'operands of the tail animation', '$02-$0C (zero page)': 'the tail animation\'s temporaries, $0C its phase'},
    2: {'$95D4-$95DA': 'glyph tick, wave tick, animation ticks, the end object\'s hits', '$95A0/$95A1, $95A6/$95A7': 'operands: the frames of the end\'s glyphs'},
    4: {'$91D5-$91F3': 'the six shooting stars', '$94AE-$94B3': 'the jump table of the parts\' X steps', '$94B4-$94BE': 'the parts\' step, tick, phase', '$94C4-$954F': 'the twenty phases'},
    5: {'$845F-$8463': 'direction X/Y, ticks, step', '$8432-$8454': 'the blink counters of the 35 sprites', '$8455-$8468': 'pointers and masks of the five columns'},
    6: {'$9328/$9329': 'glyph tick, wave tick'},
    7: {'$9487/$9488, $9490-$9493': 'operand of the glyph frame, glyph tick, wave tick, phase, tick'},
    8: {'$82B4-$82C3': 'pointers and masks of the five columns', '$82BE, $82C4/$82C5, $82F6/$82F7, $831C/$831D, $8324/$8325': 'the ticks and phases of the arms, the mouth, the eyes, the jaw glyphs and the char beam', '$8267/$8268': 'operand: the jaw glyphs\' frame'},
}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'enemies.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    m0 = rtlib.image(core=core)
    out = dict(
        source='R-Type, kazeta Electric Dreams (jádro G strany A, soubory M a G každé úrovně); tools/dumpenemies.py',
        note='paměť kódu nepřátel a bossů na adresách originálu: jádro $4F00-$5FBB, M úrovně $7AC0-$86AB, G úrovně $8E6C-$99FF; '
             'app/enemies.js a app/levelCode.js v ní mají proměnné, tools/matchenemies.mjs ji srovnává celou',
        core=dict(addr='$%04X-$%04X' % (CORE[0], CORE[1]-1), what='spawner $4FA8, state machine $518D, boss $56CF-$5E46, tables and operands',
                  variables=CORE_VARS, bytes=list(m0[CORE[0]:CORE[1]])),
        levels=[])
    for n in range(1, 9):
        m = rtlib.image(n, core=core)
        files = rtlib.level_files(n)
        out['levels'].append(dict(
            level=n,
            m=dict(addr='$%04X-$%04X' % (LEVEL_M[0], LEVEL_M[1]-1), fileEnd='$%04X' % (0x6370 + len(files['M'])),
                   what='end object record, wave pointers, type tables, wave table, boss tables, boss step ($7ACD)', bytes=list(m[LEVEL_M[0]:LEVEL_M[1]])),
            g=dict(addr='$%04X-$%04X' % (LEVEL_G[0], LEVEL_G[1]-1), fileEnd='$%04X' % (0x86AC + len(files['G'])),
                   what='block table, map script, the hook of the chain ($13BA) and the level\'s animations', bytes=list(m[LEVEL_G[0]:LEVEL_G[1]])),
            variables=LEVEL_VARS.get(n, {})))
        print('level %d: M $%04X-$%04X (file to $%04X), G $%04X-$%04X (file to $%04X)'
              % (n, LEVEL_M[0], LEVEL_M[1]-1, 0x6370 + len(files['M']), LEVEL_G[0], LEVEL_G[1]-1, 0x86AC + len(files['G'])))
    json.dump(out, open(a.o, 'w'), indent=None, separators=(',', ':'), ensure_ascii=False)
    print('core $%04X-$%04X, %d levels -> %s (%d KB)' % (CORE[0], CORE[1]-1, 8, a.o, os.path.getsize(a.o)//1024))


if __name__ == '__main__':
    main()
