#!/usr/bin/env python3
"""dumptitle — the logo of the title screen into data/title.json.

★ The title (`$8000` of side A's core `M`, `sources/docs/disasm_notes.md`
§1) copies **six pages of its own character set** from `$85CB` to `$C000`
(`$803F`), fills the Colour RAM with `$09` (`$8092`: multicolour, colour 1
white), sets `$D018` = `$30`, `$D016` = `$18`, `$D022` = 3 (cyan) and
`$D023` = `$0B` (dark grey) (`$8057`-`$8068`), and slides the **logo** in
from the right column by column (`$80D7`): seven rows of screen codes at
`$84A6`, `$84CE`, `$84F6`, `$851E`, `$8546`, `$856E`, `$8596` (40 apart),
into rows 4-10 (`$CCA0`), then scrolls it down to rows 11-17 (`$811B`)
while a multicolour sprite (`$8494`, 18 B into block `$2F`) flies across.
★ The slide's last pass has `$57` = 1, so **39 codes of a row land in
columns 1-39** and column 0 stays empty; the 40th byte of a row is never
shown (the last row's is `$85BD`, the start of a table of the texts'
printer). The texts come after (`$8204`, `data/texts.json`).

    tools/dumptitle.py       # -> data/title.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

CHARSET, CHARSET_PAGES = 0x85CB, 6
LOGO_ROWS = [0x84A6, 0x84CE, 0x84F6, 0x851E, 0x8546, 0x856E, 0x8596]
SPRITE = (0x8494, 0x12)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'title.json'))
    a = ap.parse_args()
    m = rtlib.image()
    # ★ the registers, read off the code
    assert list(m[0x8057:0x805B]) == [0xA9, 0x30, 0x8D, 0x18] and list(m[0x8061:0x8063]) == [0xA9, 0x03] and list(m[0x8066:0x8068]) == [0xA9, 0x0B], 'title code moved'
    assert list(m[0x8092:0x8094]) == [0xA9, 0x09], 'colour fill moved'
    charset = list(m[CHARSET:CHARSET+CHARSET_PAGES*256])
    rows = [list(m[at:at+39]) for at in LOGO_ROWS]        # ★ the 40th byte of a row is never on the screen ($80E6, $57 from $27 down to 1)
    used = sorted({c for r in rows for c in r})
    empty = [c for c in range(CHARSET_PAGES*32) if not any(charset[c*8:c*8+8])]
    out = dict(
        source='R-Type, kazeta Electric Dreams, strana A, jádro M (titulka $8000); tools/dumptitle.py',
        note='logo titulky: 7 x 39 screen codes (sloupce 1-39) do vlastní sady $85CB -> $C000 (6 stránek), multicolour $D016 = $18, Color RAM $09 (bílá), $D022 = 3, $D023 = 11, pozadí 0',
        charset=dict(addr='$%04X' % CHARSET, shown='$C000', pages=CHARSET_PAGES, bytes=charset),
        logo=dict(addrs=['$%04X' % at for at in LOGO_ROWS], shownRows='4-10, then 11-17 ($811B)', column=1, width=39, height=len(LOGO_ROWS), codes=rows,
                  color=9, codesUsed=used, emptyCodes=empty[:8]),
        vic={'$D016': 0x18, '$D018': 0x30, '$D021': 0, '$D022': 3, '$D023': 0x0B, '$D020': 0},
        sprite=dict(addr='$%04X' % SPRITE[0], length=SPRITE[1], block=0x2F, multicolor=True, colors={'$D027': 1, '$D025': 3, '$D026': 0x0B},
                    bytes=list(m[SPRITE[0]:SPRITE[0]+SPRITE[1]]), what='$81A1: the sprite that flies over the logo'),
    )
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    print('logo %d x %d, codes used %d (%s..%s), empty codes %s -> %s' % (39, len(rows), len(used), hex(used[0]), hex(used[-1]), [hex(c) for c in empty[:4]], a.o))


if __name__ == '__main__':
    main()
