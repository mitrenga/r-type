#!/usr/bin/env python3
"""dumptexts — the texts, the panel and the colour tables into data/texts.json.

★ Every block has its printer in the code; the printer gives the length,
the place on the screen and the character set, and so the alphabet:

| block | printer | where on the screen | set | what |
|---|---|---|---|---|
| `$8B73` (side A `M`), 224 B | `$17BF` at `levelStart`, colours by character from `$5F61` | `$CF08`-`$CFE7`: rows 19-24 from column 8 | panel | **the panel**: BEAM meter frame `$1D`/`$1A`/`$1E`, labels |
| `$0C5B`, `$0C69` (14 + 14) | `$0B8B` (A = 0) | `$CD25`/`$CD4D` (rows 7-8) | panel | READY of player 1 (two text rows, big glyphs `$20`-`$44`) |
| `$0C77`, `$0C91` (26 + 26) | `$0B9E` (A < 0) | `$CD1F`/`$CD47` | panel | the end: GAME OVER / … |
| `$0CAB`, `$0CBC` (17 + 17) | `$0BB1` (A > 0) | `$CD21`/`$CD49` | panel | READY of player 2 |
| `$0CCD`, `$0CCF`, `$0CD1`, `$0CD3` (2 + 2) | `$0BC7`/`$0BDA` | `$CD35`/`$CD5D` | panel | the digit after PLAYER |
| `$5F0D` (18), `$5F1F`, `$5F2B`, `$5F37`, `$5F43` (12 each) | `$5E47` | `$CC33`, `$CC86`, `$CCD6`, `$CD26`, `$CD76` | panel | PLEASE REWIND TAPE / … (the tape's end-of-game screen) |
| `$36A7`… (89) | nobody found | — | — | "EVEN: CODING AND GAMEDESIGN BY MANFRED TRENZ GRAFIX BY ANDREAS ESCHER…" (PETSCII-like screen codes) |
| `$844E`, `$8472`, `$8482` (side A `M`) | title `$8355`… (`disasm_notes.md` §1) | `$CC00`… | title set `$85CB` | PLEASE INSERT SIDE B AND REWIND TAPE / THEN PRESS SPACE / PRESS PLAY ON TAPE |

★ **The panel set's alphabet** is read off `$5F0D`: `PLEASE REWIND TAPE`
gives `a` = `$57` … `z` = `$70`, `F1`/`2`/`3` give the digits `0` = `$71`
… `9` = `$7A`, space = `$00`. The big READY glyphs `$20`-`$44` and the
panel's own symbols have no alphabet — they stay codes. `$5F61` is the
colour of each panel character (`$17C6`), 91 B up to the end of the
core (`$5FBB`); characters past that read the loader's code as colours.

    tools/dumptexts.py       # -> data/texts.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

PANEL = dict(addr=0x8B73, length=0xE0, screen=0xCF08, colors=0x5F61, colorsLength=0x5FBC-0x5F61)
BLOCKS = [
    ('ready1', 0x0C5B, 14, 2, '$0B8B', '$CD25/$CD4D'),
    ('gameOver', 0x0C77, 26, 2, '$0B9E', '$CD1F/$CD47'),
    ('ready2', 0x0CAB, 17, 2, '$0BB1', '$CD21/$CD49'),
    ('player1', 0x0CCD, 2, 2, '$0BC7', '$CD35/$CD5D'),
    ('player2', 0x0CD1, 2, 2, '$0BDA', '$CD35/$CD5D'),
    ('tapeEnd0', 0x5F0D, 18, 1, '$5E47', '$CC33'),
    ('tapeEnd1', 0x5F1F, 12, 1, '$5E47', '$CC86'),
    ('tapeEnd2', 0x5F2B, 12, 1, '$5E47', '$CCD6'),
    ('tapeEnd3', 0x5F37, 12, 1, '$5E47', '$CD26'),
    ('tapeEnd4', 0x5F43, 12, 1, '$5E47', '$CD76'),
]
TITLE = [('insertSideB', 0x844E, 36), ('thenPressSpace', 0x8472, 16), ('pressPlay', 0x8482, 18)]
CREDITS = (0x36A9, 0x3702)
# ★ the panel set's alphabet, read off "PLEASE REWIND TAPE" / "PRESS F1 TO START"
ALPHA = {0: ' '}
ALPHA.update({0x57+i: chr(ord('a')+i) for i in range(26)})
ALPHA.update({0x71+i: chr(ord('0')+i) for i in range(10)})


def decode(codes):
    return ''.join(ALPHA.get(c, '?') for c in codes)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'texts.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    m = rtlib.image(core=core)
    blocks = {}
    for name, at, width, rows, printer, screen in BLOCKS:
        rowsv = [list(m[at+r*width:at+(r+1)*width]) for r in range(rows)]
        blocks[name] = dict(addr='$%04X' % at, width=width, rows=rows, printer=printer, screen=screen,
                            codes=rowsv, text=[decode(r) for r in rowsv])
    title = {name: dict(addr='$%04X' % at, codes=list(m[at:at+n]), set='$85CB -> $C000 (title)')
             for name, at, n in TITLE}
    panel = dict(addr='$%04X' % PANEL['addr'], length=PANEL['length'], screen='$%04X-$%04X' % (PANEL['screen'], PANEL['screen']+PANEL['length']-1),
                 printer='$17BF', codes=list(m[PANEL['addr']:PANEL['addr']+PANEL['length']]),
                 colors=dict(addr='$%04X' % PANEL['colors'], length=PANEL['colorsLength'], reader='$17C6',
                             values=list(m[PANEL['colors']:PANEL['colors']+PANEL['colorsLength']])))
    # ★ what the level start writes into the panel besides the template ($14FF, $0CD5)
    panel['initWrites'] = [
        dict(addr='$CF58', count=0x16, value=0x1A, who='$15D0: the BEAM meter, 22 cells of $1A (row 21 from column 16)'),
        dict(addr='$CF49', count=8, value=0, who='$0CD5: the lives, cleared'),
        dict(addr='$CF49', count='lives & 7', value=0x1F, color=9, who='$0CD5 from the main loop with $281D (3 at the start, $2819 table): one $1F a life, colour 9'),
    ]
    panel['later'] = '$32CD/$33A5 print the score and the high score into rows 22-23 on the first frame ($0E4E) — M5'
    out = dict(
        source='R-Type, kazeta Electric Dreams (jádro G, M strany A); tools/dumptexts.py',
        note='kódy znaků sady panelu ($C800); abeceda a-z = $57-$70, 0-9 = $71-$7A, mezera 0 — odečtená z $5F0D',
        alphabet={('$%02X' % k): v for k, v in sorted(ALPHA.items())},
        panel=panel, blocks=blocks, title=title,
        credits=dict(addr='$%04X' % CREDITS[0], codes=list(m[CREDITS[0]:CREDITS[1]]),
                     text=''.join(chr(c+64) if 1 <= c <= 26 else ' ' if c in (0x20, 0) else chr(c) if 0x20 < c < 0x60 else '?'
                                  for c in m[CREDITS[0]:CREDITS[1]])))
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    for k, b in blocks.items():
        print('%-10s %s %s' % (k, b['addr'], ' | '.join(b['text'])))
    print('credits:', out['credits']['text'])
    print('->', a.o)


if __name__ == '__main__':
    main()
