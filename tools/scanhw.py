#!/usr/bin/env python3
"""scanhw — which instructions of the disassembly touch the hardware.

Unlike `impossiblemission/tools/scanhw.py` (a linear heuristic over the
bytes) this reads **only lines the disassembly classified as instructions**
(`sources/asm/main.asm`, `title.asm`), so data that looks like code gives
no false hits. It lists every absolute access to `$D000`-`$DFFF` and to
`$0314/$0315`, `$FFFE/$FFFF` (interrupt vectors) and `$0001` (banking),
grouped by register, with the instruction addresses.

    tools/scanhw.py                       # main.asm
    tools/scanhw.py sources/asm/title.asm
    tools/scanhw.py --md                  # Markdown table for hw_notes.md
"""
import argparse, collections, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
LINE = re.compile(r'^([0-9A-F]{4}): ((?:[0-9A-F]{2} ){1,3})\s*(?:\S+:)?\s+([A-Z]{3})\b')
# opcodes with an absolute (16-bit) operand, by mode; the rest are not counted
READ = set('LDA LDX LDY CMP CPX CPY BIT AND ORA EOR ADC SBC'.split())
WRITE = set('STA STX STY'.split())
RMW = set('INC DEC ASL LSR ROL ROR'.split())
NAMES = {0xD011: 'SCROLY', 0xD012: 'RASTER', 0xD015: 'SPENA', 0xD016: 'SCROLX', 0xD017: 'YXPAND',
         0xD018: 'VMCSB', 0xD019: 'VICIRQ', 0xD01A: 'IRQMSK', 0xD01B: 'SPBGPR', 0xD01C: 'SPMC',
         0xD01D: 'XXPAND', 0xD01E: 'SPSPCL', 0xD01F: 'SPBGCL', 0xD020: 'EXTCOL', 0xD021: 'BGCOL0',
         0xD022: 'BGCOL1', 0xD023: 'BGCOL2', 0xD024: 'BGCOL3', 0xD025: 'SPMC0', 0xD026: 'SPMC1',
         0xD010: 'MSIGX', 0xD41B: 'RANDOM', 0xD418: 'SIGVOL', 0xDC00: 'CIAPRA', 0xDC01: 'CIAPRB',
         0xDC04: 'TIMALO', 0xDC0D: 'CIAICR', 0xDD00: 'CI2PRA', 0xDD0D: 'CI2ICR',
         0x0314: 'CINV', 0x0315: 'CINV+1', 0xFFFE: 'IRQ vec', 0xFFFF: 'IRQ vec+1', 0x0001: 'R6510'}


def name(a):
    if a in NAMES: return NAMES[a]
    if 0xD000 <= a <= 0xD00F: return 'SP%d%s' % ((a - 0xD000) // 2, 'XY'[(a - 0xD000) % 2])
    if 0xD027 <= a <= 0xD02E: return 'SP%dCOL' % (a - 0xD027)
    if 0xD400 <= a <= 0xD418: return 'SID+%02X' % (a - 0xD400)
    if 0xD800 <= a <= 0xDBFF: return 'COLOR RAM'
    return '$%04X' % a


def scan(path):
    acc = collections.defaultdict(lambda: collections.defaultdict(list))
    for line in open(path):
        m = LINE.match(line)
        if not m:
            continue
        pc, by, mn = int(m.group(1), 16), m.group(2).split(), m.group(3)
        if len(by) == 3:
            a = int(by[1], 16) | int(by[2], 16) << 8
        elif len(by) == 2 and int(by[1], 16) in (0, 1) and mn in READ | WRITE | RMW:
            a = int(by[1], 16)
        else:
            continue
        if not (0xD000 <= a <= 0xDFFF or a in NAMES):
            continue
        if 0xD800 <= a <= 0xDBFF:
            a = 0xD800
        kind = 'w' if mn in WRITE else 'rw' if mn in RMW else 'r' if mn in READ else mn.lower()
        acc[a][kind].append(pc)
    return acc


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('asm', nargs='?', default=os.path.join(PROJECT, 'sources', 'asm', 'main.asm'))
    ap.add_argument('--md', action='store_true')
    a = ap.parse_args()
    acc = scan(a.asm)
    if a.md:
        print('| registr | čtení | zápis | RMW | jiné |\n|---|---|---|---|---|')
    for addr in sorted(acc):
        k = acc[addr]
        cols = [k.get('r', []), k.get('w', []), k.get('rw', [])]
        other = [(kk, v) for kk, v in k.items() if kk not in ('r', 'w', 'rw')]
        fmt = lambda v: ('%d× ' % len(v) + ' '.join('$%04X' % p for p in v[:6]) + (' …' if len(v) > 6 else '')) if v else ''
        if a.md:
            print('| `$%04X` %s | %s | %s | %s | %s |' % (addr, name(addr), fmt(cols[0]), fmt(cols[1]), fmt(cols[2]),
                  ' '.join('%s %s' % (kk, fmt(v)) for kk, v in other)))
        else:
            print('$%04X %-9s r:%-40s w:%-40s rmw:%s %s' % (addr, name(addr), fmt(cols[0]), fmt(cols[1]), fmt(cols[2]),
                  ' '.join('%s %s' % (kk, fmt(v)) for kk, v in other)))


if __name__ == '__main__':
    main()
