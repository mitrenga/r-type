#!/usr/bin/env python3
"""dumpwaves — the enemy waves and the enemy-type tables of each level into data/waves.json.

★ Read from the spawner **`$4FA8`** (`sources/docs/disasm_notes.md` §9),
which runs once a frame from the interrupt chain (`$1166`):

- The **wave table** is pairs `column, type` in the level's `M`; `$7AD2`
  points at its start (`$15A9`, the level start), `$7AD4` at the
  checkpoint's entry (`$090D`, after a death). The spawner compares the
  low byte of the map pointer `$0201` with the column and takes the pair.
  A type with bit 7 clear launches an enemy of that type (`$505E`…);
  `$FF`/`$FE` raise/lower `$0235` (`$4FD2`), `$FB`-`$FD` launch too;
  **`$80`-`$FA`** go to `$56CF` with the low 7 bits as an index — ? the
  end-of-level object (the boss, M4). ★ The table has no end mark: the
  dump stops at the first such entry and keeps the 32 bytes after it
  (`after`) for M4 to decide.
- **Fourteen tables of 62 entries** (`$3E` types) at fixed addresses in
  `M`, read by type: `$7AD6` (`$507E`, `$D3` = fixed X else random), `$7B14`
  (`$4FE6`, `$D3` = fixed Y else random), `$7B52` X, `$7B90` X high bit,
  `$7BCE` Y, `$7C0C` random mask for Y, `$7C4A` sprite pointer / colour
  (`$BE,X`), `$7C88` (`$045B,X`), and three pairs of pointers `$7CC6/$7D04`,
  `$7D42/$7D80`, `$7DBE/$7DFC` (`$7C`, `$7E`, `$80` — six bytes each are
  copied to `$053C`…, `$05A5`…, `$060E`…: ? the paths, M4).
- `$7AC0`-`$7AD1`: 18 bytes that `$56CF` spreads into its own code — the
  level's end object.

Nothing here is interpreted beyond what the spawner does with it; the
meaning of the paths and the states is M4. `tools/matchlevels.mjs` does
not use this file; M4's `matchenemies` will.

    tools/dumpwaves.py       # -> data/waves.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

TYPES = 0x3E
START_PTR, RESUME_PTR = 0x7AD2, 0x7AD4
END_OBJECT = (0x7AC0, 0x7AD2)
TABLES = [
    (0x7AD6, 'fixedX', '$507E: $D3 = X from $7B52 as is, else + ($DC04 & $7F)'),
    (0x7B14, 'fixedY', '$4FE6: $D3 = Y from $7BCE as is, else + ($DC04 & mask $7C0C)'),
    (0x7B52, 'x', '$508B/$509F: X of the new enemy ($82,X)'),
    (0x7B90, 'xHigh', '$5092/$50A4: 0 = X high bit clear, else from $56BD,X ($91,X)'),
    (0x7BCE, 'y', '$4FF4/$4FF9: Y ($505F -> $A0,X after the band test)'),
    (0x7C0C, 'yMask', '$4FF0: mask for the random part of Y'),
    (0x7C4A, 'sprite', '$5062: $BE,X — sprite pointer / colour of the band entry'),
    (0x7C88, 'arg5B', '$5067: $045B,X'),
]
POINTERS = [
    (0x7CC6, 0x7D04, 'ptr7C', '$50AE: $7C/$7D -> $0488,X/$04A6,X; $5112 copies 6 B to $053C.. $0596,X'),
    (0x7D42, 0x7D80, 'ptr7E', '$50C4: $7E/$7F -> $04C4,X/$04E2,X; $513B copies 6 B to $05A5.. $05FF,X'),
    (0x7DBE, 0x7DFC, 'ptr80', '$50DA: $80/$81 -> $0500,X/$051E,X; $5164 copies 6 B to $060E.. $0668,X'),
]


def wave_table(m, at):
    out, p = [], at
    while True:
        col, typ = m[p], m[p+1]
        out.append([col, typ]); p += 2
        if typ >= 0x80 and typ not in (0xFE, 0xFF):
            break    # ? the last entry: $80-$FA go to $56CF, $FB-$FD take the launch path with an index past the tables (M4)
        if p - at > 2000:
            raise SystemExit('wave table at $%04X has no end' % at)
    return out, p


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'waves.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    levels = []
    for n in range(1, 9):
        m = rtlib.image(n, core=core)
        start = rtlib.word(m, START_PTR)
        resume = rtlib.word(m, RESUME_PTR)
        entries, end = wave_table(m, start)
        launches = sum(1 for c, t in entries if t < 0x80)
        d = dict(level=n, table=dict(addr='$%04X' % start, end='$%04X' % end, resume='$%04X' % resume,
                                     resumeIndex=(resume - start)//2 if start <= resume < end else None,
                                     entries=entries, launches=launches,
                                     after=list(m[end:end+32])),
                 endObject=dict(addr='$%04X-$%04X' % (END_OBJECT[0], END_OBJECT[1]-1),
                                bytes=list(m[END_OBJECT[0]:END_OBJECT[1]])),
                 types={name: dict(addr='$%04X' % at, reader=what, values=list(m[at:at+TYPES]))
                        for at, name, what in TABLES})
        for lo, hi, name, what in POINTERS:
            d['types'][name] = dict(addr='$%04X/$%04X' % (lo, hi), reader=what,
                                    values=['$%04X' % (m[lo+i] | m[hi+i] << 8) for i in range(TYPES)])
        levels.append(d)
        print('level %d: wave table $%04X-$%04X, %d entries, %d launches, end type $%02X, resume at entry %s'
              % (n, start, end, len(entries), launches, entries[-1][1], d['table']['resumeIndex']))
    out = dict(
        source='R-Type, kazeta Electric Dreams (soubor M každé úrovně); tools/dumpwaves.py',
        note='dvojice (sloupec = dolní bajt $0201, typ); typ < $80 spouští nepřítele ($505E), $FF/$FE mění $0235, '
             '$80-$FA končí tabulku a jde do $56CF (objekt na konci úrovně); 14 tabulek po 62 typech na pevných adresách v M',
        spawner='$4FA8', startPointer='$%04X' % START_PTR, resumePointer='$%04X' % RESUME_PTR, types=TYPES,
        levels=levels)
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    print('->', a.o)


if __name__ == '__main__':
    main()
