#!/usr/bin/env python3
"""dumpglobal — the core's tables and constants into data/global.json.

★ Everything here is read at its place in the code (`sources/docs/
disasm_notes.md` §7-§10) and measured by `tools/matchlevels.mjs` (the
scroll) or carried to M3-M5 (the rest). Each entry says who reads it.

    tools/dumpglobal.py       # -> data/global.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

# (addr, length, stride/kind, reader, what)
TABLES = [
    (0x139A, 16, 'words', '$161B', 'per level: the init routine ($1224, $12A7, $12BB, $134D, $17FA = none)'),
    (0x13AA, 16, 'words', '$162F', 'per level: the map script in G'),
    (0x13BA, 16, 'words', '$15F0 -> $0E83', 'per level: the routine the interrupt chain calls once a frame ($0E82 JSR)'),
    (0x13CA, 8, 'bytes', '$0958 -> $021E', 'per level: $D022 of the playfield after a restart'),
    (0x13D2, 8, 'bytes', '$095E -> $021F', 'per level: $D023 of the playfield after a restart'),
    (0x13DA, 8, 'bytes', '$15F0 -> $36A9', 'per level: end pointer, low byte'),
    (0x13E2, 8, 'bytes', '$15F0 -> $36AA', 'per level: end pointer, high byte (0 = level 3, no end)'),
    (0x207C, 16, 'words', '$15F0 -> $2068', 'per level: a hook of $2001 (0 = none)'),
    (0x0B64, 8, 'bytes', '$0902, $091F', 'per level: the checkpoint — low byte of the map pointer ($9Axx) a death restarts from'),
    (0x2F72, 25, 'bytes', '$1953, $2001', 'screen row addresses, low bytes ($CC00 + 40 × row)'),
    (0x2F8B, 25, 'bytes', '$195B', 'screen row addresses, high bytes'),
    (0x27F1, 20, 'bytes', '$27E1 -> $2805', 'the game\'s start state (two players side by side): $2819.. follows'),
    (0x2819, 8, 'bytes', '$08C1, $0CD5', '$2819 players? $281D/$281E lives of player 1/2 (3)'),
    (0x3AE4, 24, 'bytes', '$3733', 'level 3, script A: frames a tick'),
    (0x3AFC, 24, 'bytes', '$373C', 'level 3, script A: ticks'),
    (0x3B14, 24, 'bytes', '$3742', 'level 3, script A: direction (0 left, 1 right, $80 still)'),
    (0x3B2C, 24, 'bytes', '$37B1', 'level 3, script B: frames a tick'),
    (0x3B44, 24, 'bytes', '$37BA', 'level 3, script B: ticks'),
    (0x3B5C, 24, 'bytes', '$37C0', 'level 3, script B: direction (0 up, 1 down, $80 still)'),
    (0x36A7, 4, 'bytes', '$34FB, $3658', '$36A7 rows of the new column (19), $36A8 the frame counter of the scroll, $36A9/$36AA the end pointer'),
    (0x3AD6, 14, 'bytes', '$3702', 'level 3 state as the core carries it: $3AD6 column tick (16), $3AD7 phase, $3AD8 B index, $3AD9 redraw, $3ADA/B window, $3ADC-$3ADF A, $3AE0-$3AE3 B'),
]
# ★ constants with their place in the code
CONSTANTS = [
    ('mapStart', 0x9A27, '$1544: the map pointer at the start (column 39)'),
    ('fineScrollStart', 7, '$1591: $020C'),
    ('d011', 0x1B, '$1596: $020B, the $D011 of the bottom border ($0F52)'),
    ('scrollRunning', 1, '$15C6: $0221'),
    ('scrollFrames', 2, '$3503: frames per fine step ($36A8 reload) — 1 px every 2 frames'),
    ('columnFrames', 16, '8 fine steps a column'),
    ('newColumn', 38, '$366D: the column drawn from the map ($CC26)'),
    ('bands', [0x4F, 0x64, 0x67, 0x77, 0x8C, 0x8F], '$156A: rasters $023A-$023F of the multiplexer bands'),
    ('panelRaster', 0xCA, '$1151: the raster of the panel interrupt ($0DE6); level 3 $C6 ($12C5)'),
    ('playfieldTop', 0x30, '$0D04: raster 48'),
    ('lowerSetRaster', 0x8C, '$023E -> $10B6: from raster 140 the lower set ($D018 $39)'),
    ('d018', dict(upper=0x30, lower=0x38, panel=0x32), '$0D17, $10B6 (.. $39), $0E1A'),
    ('d016', dict(playfield='$020C | $10', panel=0x18), '$0D07, $0E1F'),
    ('colors', dict(d020=0, d021=0, panelD022=0x0F, panelD023=0x0B), '$13EA, $0D1F, $0E0D-$0E17'),
    ('lives', 3, '$281D/$281E'),
    ('vertical', dict(phases=0x19, columnTick=0x10, windowStart=0x9E3B, windowOffset=0xD9, stride=0x82, color=9),
     '$370A, $3724, $1343, $384D, $3853'),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'global.json'))
    a = ap.parse_args()
    m = rtlib.image()
    tables = []
    for at, n, kind, reader, what in TABLES:
        if kind == 'words':
            values = ['$%04X' % (m[at+i] | m[at+i+1] << 8) for i in range(0, n, 2)]
        else:
            values = list(m[at:at+n])
        tables.append(dict(addr='$%04X' % at, length=n, kind=kind, reader=reader, what=what, values=values))
    out = dict(
        source='R-Type, kazeta Electric Dreams (jádro G strany A); tools/dumpglobal.py',
        note='tabulky jádra po úrovních a konstanty s místem v kódu; scroll měří tools/matchlevels.mjs',
        tables=tables,
        constants={name: dict(value=value, where=where) for name, value, where in CONSTANTS})
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    for t in tables:
        print('%s %-16s %s' % (t['addr'], t['reader'], t['values'] if t['kind'] == 'words' or t['length'] <= 8 else '%d B' % t['length']))
    print('->', a.o)


if __name__ == '__main__':
    main()
