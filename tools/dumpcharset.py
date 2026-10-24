#!/usr/bin/env python3
"""dumpcharset — the character sets from the tape into data/charsets.json.

★ The game shows three sets in three raster bands (`sources/docs/vic_state.md`,
`disasm_notes.md` §2), all in VIC bank 3:

| set | `$D018` | where | from | who puts it there |
|---|---|---|---|---|
| **upper playfield** | `$30`/`$31` | `$C000` | glyphs `$00`-`$BF` from the level's `G` (`$86AC`, 1 536 B), `$C0`-`$FF` from side A's `M` (`$8C53`, 512 B) | `$11FA` after every level load; `$17D3` once at `levelStart` |
| **lower playfield** (from raster 140) | `$38`/`$39` | `$E000` | the level's `S`, first 2 048 B | the turbo loader itself |
| **panel** (from raster 202) | `$32`/`$33` | `$C800` | side A's `M` at `$9D53` (1 024 B) | `$17D3` once at `levelStart` |

The upper and the lower set share the screen codes: a cell shows glyph *n*
of the upper set in rows 0-11 and glyph *n* of the lower set below. The
same 64 shared glyphs `$C0`-`$FF` sit in both (the level's `S` carries its
own copy).

★ **The level init comes first**: before `$11FA` copies the upper set,
level 1's init clears glyphs **`$AF`-`$BF`** of both sets (`$1254`, 136 B
at `$8C24` and `$E578` — on the tape those slots of level 1 hold 80 bytes
of leftover art) and seeds six bits in each (`$127E`, `$1292`); level 4's
clears `$B3`-`$BF` of the upper set and seeds six bits (`$136E`, `$1385`).
The dump applies that (`INIT`), so the sets here are the sets at the level
start. **Written at run time** after that (named so that
`tools/matchcharset.mjs` can tell them from a wrong byte): the **stars** in
those glyphs, moved every frame by the level's own routine (`$940A`/`$945C`
of level 1, `$943B` of level 2 and `$93B6` of level 7 from `$DC04`); **`$9531`** (level 1) draws an animation into
`$FD40`-`$FE42`, outside the sets. The panel set's last 31 bytes
(`$CBE1`-`$CBFF`, glyphs `$FC`-`$FF`) lie **past the end of the side A
file** (`$A134`) and hold whatever was in RAM.

    tools/dumpcharset.py       # -> data/charsets.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

UPPER, LOWER, PANEL, SHARED = 0xC000, 0xE000, 0xC800, 0xC600
STARS = (0xAF, 0xBF)
# ★ what the level init does to the sets before $11FA copies the upper one
# ($139A -> $1224 for level 1, $134D for level 4; the others leave them):
# (level, clear ranges as (set, from glyph, to glyph), seed bytes as (addr, value))
INIT = {
    1: dict(who='$1224: $1254 clears glyphs $AF-$BF of both sets, $127E/$1292 seed six bits each',
            clear=[('upper', 0xAF, 0xC0), ('lower', 0xAF, 0xC0)],
            seeds=[(0x8C3C, 0x80), (0x8C5E, 0x80), (0x8C77, 0x80), (0x8C48, 0x80), (0x8C59, 0x80), (0x8C6B, 0x80),
                   (0xE590, 0x80), (0xE5B2, 0x80), (0xE5CB, 0x80), (0xE59C, 0x80), (0xE5AD, 0x80), (0xE5BF, 0x80)]),
    4: dict(who='$134D: $136E clears glyphs $B3-$BF of the upper set, $1385 seeds six bits',
            clear=[('upper', 0xB3, 0xC0)],
            seeds=[(0x8C5C, 0x80), (0x8C7E, 0x80), (0x8C97, 0x80), (0x8C68, 0x80), (0x8C79, 0x80), (0x8C8B, 0x80)]),
}


def glyph_count(bytes_):
    return sum(1 for i in range(0, len(bytes_), 8) if any(bytes_[i:i+8]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'charsets.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    m0 = rtlib.image(core=core)
    panel = bytes(m0[PANEL:PANEL+0x400])
    shared = bytes(m0[SHARED:SHARED+0x200])
    levels = []
    for n in range(1, 9):
        m = rtlib.image(n, core=core)
        init = INIT.get(n)
        if init:
            # ★ the init runs before $11FA: it writes the source at $86AC and the lower set at $E000
            for which, lo, hi in init['clear']:
                base = rtlib.LEVEL_G if which == 'upper' else LOWER
                m[base+lo*8:base+hi*8] = bytes(hi*8-lo*8)
            for addr, value in init['seeds']:
                m[addr] = value
        m[UPPER:UPPER+0x600] = m[rtlib.LEVEL_G:rtlib.LEVEL_G+0x600]       # $11FA
        upper = bytes(m[UPPER:UPPER+0x800])
        lower = bytes(m[LOWER:LOWER+0x800])
        # ★ level 6's S is 1 280 B: glyphs $A0-$FF of its lower set are whatever
        # the previous level left at $E500-$E7FF (multiload) — not its data
        in_file = min(0x800, len(rtlib.level_files(n)['S']))
        levels.append(dict(level=n, lowerInFile=in_file, init=init['who'] if init else None,
                           upper=dict(addr='$%04X' % UPPER, source='$86AC (G) + $8C53 (M strany A)', glyphs=256,
                                      nonEmpty=glyph_count(upper), bytes=list(upper)),
                           lower=dict(addr='$%04X' % LOWER, source='$E000 (S)', glyphs=256,
                                      nonEmpty=glyph_count(lower), bytes=list(lower))))
        print('level %d: upper %d glyphs, lower %d glyphs' % (n, glyph_count(upper), glyph_count(lower)))
    out = dict(
        source='R-Type, kazeta Electric Dreams; tools/dumpcharset.py (obraz paměti z kazety, kopie jako $1794/$11FA)',
        note='tři sady v pásmech: horní plocha $C000 ($D018 $30), dolní plocha od rastru 140 $E000 ($38), panel od 202 $C800 ($32)',
        runtime=[dict(glyphs='$AF-$BF', sets=['upper', 'lower'],
                      who='$1254 maže (136 B na $8C24 a $E578), $127E (úroveň 1) a $1385 (úroveň 4) sázejí bity, '
                          '$940A/$945C (kód úrovně 1 v G, čte $DC04) hýbe hvězdami každý snímek'),
                 dict(glyphs='$FC-$FF', sets=['panel'],
                      who='$CBE1-$CBFF leží za koncem souboru M strany A ($A134): obsah RAM, ne data')],
        panel=dict(addr='$%04X' % PANEL, source='$9D53 (M strany A, $17D3)', glyphs=256,
                   nonEmpty=glyph_count(panel), fileEnd='$A134', bytes=list(panel)),
        shared=dict(addr='$%04X' % SHARED, source='$8C53 (M strany A, $17D3)', glyphs=64, codes='$C0-$FF',
                    nonEmpty=glyph_count(shared), bytes=list(shared)),
        levels=levels)
    json.dump(out, open(a.o, 'w'), indent=0, ensure_ascii=False)
    print('panel %d glyphs, shared %d glyphs -> %s' % (glyph_count(panel), glyph_count(shared), a.o))


if __name__ == '__main__':
    main()
