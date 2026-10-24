#!/usr/bin/env python3
"""dumppicture — the loading picture of side A (file `P`) into data/picture.json.

★ `P` (`$7000`-`$985E`, 10 335 B) is the second file of side A, loaded by
`BOOT` before the core. Its own code at the end shows it and waits for
SPACE (`tools/rtboot.py` breaks at `$9849`):

| part of the file | what | where the code puts it |
|---|---|---|
| `$7000`-`$8F3F` | the bitmap, 8 000 B — multicolour, 160 × 200 pairs | `$E000` (VIC bank 3, `$D018` = `$38`, `$D016` = `$18`) |
| `$9000`-`$93E7` | Screen RAM: the colours of the pairs 01 (high nibble) and 10 (low nibble) | `$CC00` |
| `$93E8`-`$97CF` | Colour RAM: the colour of the pairs 11 | `$D800` |
| `$97D0`-`$985E` | the code: `$D020` = `$D021` = 0, `$DD00` = 0, sprites off, the copies, `$D011` = `$3B`, wait for SPACE, blank | |

The pairs 00 are the background, `$D021` = 0 (black), the border is black too.

    tools/dumppicture.py       # -> data/picture.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

FILE_START = 0x7000
BITMAP, SCREEN, COLOR, CODE = 0x7000, 0x9000, 0x93E8, 0x97D0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'picture.json'))
    a = ap.parse_args()
    p = rtlib.core_files()['P']
    assert len(p) == 0x985F - FILE_START, len(p)        # the header's end $985F is exclusive
    at = lambda addr, n: list(p[addr - FILE_START:addr - FILE_START + n])
    code = at(CODE, 0x985F - CODE)
    # ★ the registers the code writes, read off it (SEI, wait $FA, LDA #0 -> $D011/$D020/$D021/$DD00/$D015 …)
    assert code[:7] == [0x78, 0xAD, 0x12, 0xD0, 0xC9, 0xFA, 0xD0], code[:7]
    out = dict(
        source='R-Type, kazeta Electric Dreams, strana A, soubor P ($7000-$985E); tools/dumppicture.py',
        note='nahrávací obrázek: multicolour bitmapa 160 x 200 párů; 00 = $D021, 01 = horní nibble Screen RAM, 10 = dolní nibble, 11 = Color RAM',
        file=dict(name='P', addr='$%04X' % FILE_START, length=len(p)),
        width=320, height=200,
        bitmap=dict(addr='$%04X' % BITMAP, shown='$E000', bytes=at(BITMAP, 8000)),
        screen=dict(addr='$%04X' % SCREEN, shown='$CC00', bytes=at(SCREEN, 1000)),
        color=dict(addr='$%04X' % COLOR, shown='$D800', bytes=at(COLOR, 1000)),
        background=0, border=0,
        vic={'$D011': 0x3B, '$D016': 0x18, '$D018': 0x38, '$DD00': 0, '$D015': 0},
        code=dict(addr='$%04X' % CODE, wait='$9849: SPACE through $DC01 bit 4', bytes=code),
    )
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    print('P: %d B, bitmap %d, screen %d, colour %d, code %d B -> %s' % (len(p), 8000, 1000, 1000, len(code), a.o))


if __name__ == '__main__':
    main()
