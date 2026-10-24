#!/usr/bin/env python3
"""dumplevels — the eight levels from the tape into data/levels.json.

★ Read from the code (`sources/docs/disasm_notes.md` §7-§8), measured by
`tools/matchlevels.mjs` against the memory of the running original.

**A level is three files** (`sources/tape/README.md`): `M` at `$6370`
(music and the enemies), `G` at `$86AC` (the character set, two tables
per character, the blocks and the map script, and the level's own code)
and `S` at `$E000` (the lower character set and the sprites).

**The map** is 19 rows of 512 columns at `$9A00` (row stride `$200`),
built once by **`$162F`** from the **map script** (`$13AA` + 2 × level
→ address in `G`): records of three bytes `block, x, row` or, with bit 7
of the block set, five bytes `block, x, row, repeatX, repeatY`; bit 7 of
`row` adds 256 to `x`; `$FF` ends the script. A **block** (`$8E6C` low,
`$8ECF` high byte, by number) is `width, height` and then width × height
screen codes, a zero leaves the map alone. Rows past 18 and columns past
511 are clipped (`$1765`, `$16F8`). The map is **not stored** — the remake
builds it with the same routine (`app/levelScroll.js`).

**The scroll** (`$34FB`, from the interrupt chain): every second frame the
fine scroll `$020C` goes down by one; past 0 it is 7 again and the 19 rows
of screen and colour RAM move left by a column (`$3519`), then **`$3641`**
draws column 38 from the map at the **map pointer** `$0201/$0202`
(`$9A27` at the start: column 39 of the map), with the colour of each
character from **`$8CAC`** (256 entries), and the pointer moves on; when
it reaches the **end** (`$13DA`/`$13E2` per level) the scroll stops
(`$0221` = 0). `$11A2` builds the first screen the same way: 40 columns
from pointer − 39.

**Level 3** (index 2) is different (§10): its `G` holds a 23 × 79 map
that the init `$12BB` copies into a 130-wide buffer at `$9EBA`, and the
step `$3702` moves a 19 × 39 window over it by two scripts from the core
(`$3AE4`…, `$3B2C`…), rebuilding all rows (`$3944`, `$3848`) with colour 9.

**Per level in the core** (index = level − 1): init routine `$139A`,
map script `$13AA`, interrupt hook `$13BA` (`JSR` at `$0E82`), the two
playfield colours `$13CA`/`$13D2` (→ `$021E`/`$021F` on a restart),
end pointer `$13DA`/`$13E2`, a hook `$207C` (→ `$2068`), the checkpoint
column `$0B64`. The init routines patch the step (`$0DC8`), the panel
raster (`$1152`), the colour table address (`$3685`) and `$64`.

    tools/dumplevels.py            # -> data/levels.json
    tools/dumplevels.py --show 1   # the map of level 1 as text
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

MAP, MAP_ROWS, MAP_STRIDE, START = 0x9A00, 19, 0x200, 0x9A27
BLOCK_LO, BLOCK_HI, BLOCKS = 0x8E6C, 0x8ECF, 0x63
CHAR_COLORS, CHAR_FLAGS = 0x8CAC, 0x8D6C
TABLES = dict(init=0x139A, script=0x13AA, irqHook=0x13BA, bg1=0x13CA, bg2=0x13D2,
              endLo=0x13DA, endHi=0x13E2, hook207C=0x207C, checkpoint=0x0B64)
# ★ what each init routine ($139A) patches, read from its code
INITS = {
    0x1224: dict(step=0x34FB, panelRaster=0xCA, reg64=0x38, colorTable=None,
                 clears=['$FD40-$FF3F', 'glyphs $AF-$BF of both sets ($8C24, $E578)'],
                 starSeeds=[0x8C3C, 0x8C5E, 0x8C77, 0x8C48, 0x8C59, 0x8C6B],
                 starSeeds2=[0xE590, 0xE5B2, 0xE5CB, 0xE59C, 0xE5AD, 0xE5BF],
                 starTables='$94C4->$94CA, $94B8->$94BE (6 B each, in G)', then='JMP $9531 (G: animation)',
                 unless='pointer past the checkpoint $9AD3 ($125F)'),
    0x12A7: dict(reg64=0x30, colorTable=0x8CAC, clears=['$134C <- 0']),
    0x12BB: dict(step=0x3702, panelRaster=0xC6, vertical=True,
                 clears=['$9A00-$B3FF (26 pages) unless $134C'],
                 then='$1321: $3AD7-$3AD9 <- 0, $3ADC-$3ADE, $3AE0-$3AE2 <- 1, $3ADA/$3ADB <- $9E3B; JMP $394A'),
    0x134D: dict(step=0x34FB, panelRaster=0xCA, colorTable=0x8CAC, reg64=0x30,
                 clears=['$8C44-$8CAB (glyphs $B3-$BF of the upper set)'],
                 starSeeds=[0x8C5C, 0x8C7E, 0x8C97, 0x8C68, 0x8C79, 0x8C8B],
                 starTables='$91E1->$91E7, $91D5->$91DB (6 B each, in G)'),
    0x17FA: dict(),
}
# ★ hooks of the interrupt chain ($13BA) that change what the scroll draws, read from their code
HOOKS = {
    0x943B: dict(colorSwitch=dict(pointer=0x9B4A, colorTable=0x937B, reg64=0x38, counter=0x95D4, reload=3,
                                  who='$943B (raster 202, after the step): DEC $95D4, at zero the glyph animation '
                                      '($947A, reload 3), else at $0201/$0202 = $9B4A the column colours come from '
                                      '$937B, $64 <- $38 (the lower set on top), $0B5E <- 0, music $6379')),
}
VERTICAL = dict(mapSrc=0x8E6C, rows=23, cols=79, dst=0x9EBA, stride=0x82, fill='$9A00-$B3FF',
                window=dict(rows=19, cols=39, start=0x9E3B, color=9),
                scriptA=dict(count=0x3AE4, reload=0x3AFC, dir=0x3B14, entries=24,
                             what='$3711: fine X ($020C) and the window start by a column; sprites ±4 ($4F58/$4F6C)'),
                scriptB=dict(count=0x3B2C, reload=0x3B44, dir=0x3B5C, entries=24,
                             what='$37A1: fine Y ($020B) and the window start by a row ($82); sprites ±8 ($4F80/$4F94)'),
                phases=0x19, columnFrames=0x10)


def script_records(m, at):
    out, p = [], at
    while m[p] != 0xFF:
        b0 = m[p]
        if b0 & 0x80:
            out.append([b0 & 0x7F, m[p+1], m[p+2], m[p+3], m[p+4]]); p += 5
        else:
            out.append([b0 & 0x7F, m[p+1], m[p+2], 1, 1]); p += 3
    return out, p


def blocks_of(m, records):
    used = sorted({r[0] for r in records})
    out = []
    for b in used:
        a = m[BLOCK_LO + b] | m[BLOCK_HI + b] << 8
        w, h = m[a], m[a+1]
        out.append(dict(block=b, addr='$%04X' % a, width=w, height=h,
                        cells=list(m[a+2:a+2+w*h])))
    return out


def unpack(m, script):
    """Port of `$162F`-`$1793` (the same as `app/levelScroll.js`), for `--show`
    and for the check inside `matchlevels`."""
    out = bytearray(MAP_ROWS*MAP_STRIDE)
    records, _ = script_records(m, script)
    for blk, x, row, nx, ny in records:
        a = m[BLOCK_LO+blk] | m[BLOCK_HI+blk] << 8
        w, h, data = m[a], m[a+1], a+2
        xhi = 1 if row & 0x80 else 0
        page = (row & 0x7F)*2 + xhi
        src, stop = data, False
        for _ry in range(ny):
            src = data
            for _yy in range(h):
                olo, ohi, pos, reps = x, xhi, page*0x100 + x, nx
                while True:
                    for i in range(w):
                        if ohi and olo+i > 0xFF:
                            break
                        v = m[src+i]
                        if v:
                            out[pos+i] = v
                    pos += w; olo += w
                    if olo > 0xFF:
                        olo &= 0xFF; ohi += 1
                    if ohi == 2:
                        break
                    reps -= 1
                    if reps == 0:
                        break
                src += w
                page += 2
                if page + 0x9A >= 0xC0:
                    stop = True; break
            if stop:
                break
    return bytes(out)


def level(n, core):
    m = rtlib.image(n, core=core)
    idx = n - 1
    t = {k: (m[a+idx] if k in ('bg1', 'bg2', 'endLo', 'endHi', 'checkpoint') else m[a+2*idx] | m[a+2*idx+1] << 8)
         for k, a in TABLES.items()}
    end = t['endLo'] | t['endHi'] << 8
    init = INITS[t['init']]
    out = dict(level=n, index=idx,
               files={k: dict(addr='$%04X' % a, length=0) for k, a in
                      (('M', rtlib.LEVEL_M), ('G', rtlib.LEVEL_G), ('S', rtlib.LEVEL_S))},
               init='$%04X' % t['init'], irqHook='$%04X' % t['irqHook'],
               step='$%04X' % init.get('step', 0x34FB), panelRaster=init.get('panelRaster', 0xCA),
               colorTable='$%04X' % (init.get('colorTable') or CHAR_COLORS), reg64=init.get('reg64', 0x30),
               bgColors=[t['bg1'], t['bg2']], hook207C='$%04X' % t['hook207C'],
               checkpoint=t['checkpoint'], end='$%04X' % end,
               columns=(end - START) if end else None,
               initPatches={k: v for k, v in init.items() if k not in ('step', 'panelRaster', 'colorTable', 'reg64')},
               charColors=list(m[CHAR_COLORS:CHAR_COLORS+256]),
               charFlags=list(m[CHAR_FLAGS:CHAR_FLAGS+256]))
    hook = HOOKS.get(t['irqHook'], {})
    if 'colorSwitch' in hook:
        cs = hook['colorSwitch']
        out['colorSwitch'] = dict(pointer='$%04X' % cs['pointer'], reg64=cs['reg64'], who=cs['who'],
                                  tableAddr='$%04X' % cs['colorTable'],
                                  counter=dict(addr='$%04X' % cs['counter'], initial=m[cs['counter']], reload=cs['reload']),
                                  colorTable=list(m[cs['colorTable']:cs['colorTable']+256]))
    files = rtlib.level_files(n)
    for k in 'MGS':
        out['files'][k]['length'] = len(files[k])
    if init.get('vertical'):
        v = VERTICAL
        rows = [list(m[v['mapSrc']+r*v['cols']:v['mapSrc']+(r+1)*v['cols']]) for r in range(v['rows'])]
        out['vertical'] = dict(mapSrc='$%04X' % v['mapSrc'], rows=v['rows'], cols=v['cols'],
                               dst='$%04X' % v['dst'], stride=v['stride'], fill=v['fill'],
                               window=dict(v['window'], start='$%04X' % v['window']['start']),
                               map=rows, phases=v['phases'], columnFrames=v['columnFrames'],
                               scripts={name: dict(what=s['what'], count=list(m[s['count']:s['count']+s['entries']]),
                                                   reload=list(m[s['reload']:s['reload']+s['entries']]),
                                                   dir=list(m[s['dir']:s['dir']+s['entries']]),
                                                   addr='$%04X/$%04X/$%04X' % (s['count'], s['reload'], s['dir']))
                                        for name, s in (('A', v['scriptA']), ('B', v['scriptB']))})
        out['script'] = dict(addr='$%04X' % t['script'], records=[])
    else:
        records, endp = script_records(m, t['script'])
        out['script'] = dict(addr='$%04X' % t['script'], end='$%04X' % endp, records=records)
        out['blocks'] = blocks_of(m, records)
    return out, m


def show(m, data):
    if data.get('vertical'):
        for row in data['vertical']['map']:
            print(''.join('.' if v == 0 else '#' if v >= 0x80 else '+' for v in row))
        return
    mp = unpack(m, int(data['script']['addr'][1:], 16))
    cols = data['columns'] + 39
    for r in range(MAP_ROWS):
        print(''.join('.' if v == 0 else '*' if 0xAF <= v <= 0xBF else '#' for v in mp[r*MAP_STRIDE:r*MAP_STRIDE+cols]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'levels.json'))
    ap.add_argument('--show', type=int, metavar='LEVEL')
    a = ap.parse_args()
    core = rtlib.core_files()
    levels, mems = [], {}
    for n in range(1, 9):
        d, m = level(n, core)
        levels.append(d); mems[n] = m
    if a.show:
        show(mems[a.show], levels[a.show-1]); return
    out = dict(
        source='R-Type, Electric Dreams tape (side B, files M/G/S of each level; tables from core G of side A); tools/dumplevels.py',
        note='the 19 × 512 map at $9A00 is not built here — the routine $162F builds it from the blocks and the script (app/levelScroll.js), '
             'tools/matchlevels.mjs measures it against the original\'s memory',
        map=dict(base='$%04X' % MAP, rows=MAP_ROWS, stride=MAP_STRIDE, start='$%04X' % START,
                 unpacker='$162F', blockTable='$%04X/$%04X' % (BLOCK_LO, BLOCK_HI), firstScreen='$11A2',
                 scroll=dict(step='$34FB', counter='$36A8', reload=2, fine='$020C', pointer='$0201/$0202',
                             running='$0221', shift='$3519', column='$3641', screenColumn=38,
                             colorTable='$%04X' % CHAR_COLORS, flagTable='$%04X' % CHAR_FLAGS)),
        tables={k: '$%04X' % v for k, v in TABLES.items()},
        levels=levels)
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    rtlib.save_json(out, a.o, drop=('unpacker', 'blockTable', 'flagTable', 'tables', 'clears', 'starTables', 'unless', 'initPatches', 'who', 'tableAddr', 'mapSrc'), indent=1, ensure_ascii=False)   # without the notes (rtlib.strip_notes)
    for d in levels:
        print('level %d: init %s hook %s step %s end %s (%s columns), %d records, %d blocks%s'
              % (d['level'], d['init'], d['irqHook'], d['step'], d['end'], d['columns'],
                 len(d['script']['records']), len(d.get('blocks', [])),
                 ', vertical 23 x 79' if 'vertical' in d else ''))
    print('->', a.o)


if __name__ == '__main__':
    main()
