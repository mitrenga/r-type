#!/usr/bin/env python3
"""mkscreen — one frame of the original as data, and the same frame as VICE drew it.

★ The frame is not a memory dump: the game changes the VIC-II registers
while the beam runs (`sources/docs/disasm_notes.md` §2) — the fine scroll,
the character set, the colours and the multiplexed sprites. So the tool
records frame N **as the chip saw it**:

1. memory at the top of the playfield (`$0D04`, raster 48): bank 3 (RAM
   under the I/O included), colour RAM, the VIC registers;
2. **every store** to `$D000`-`$D02E`, to the screen RAM `$CC00`-`$CFE7`,
   the sprite pointers `$CFF8`-`$CFFF` and the colour RAM `$D800`-`$DBE7`
   during the frame, with its raster line and cycle and the value (from the
   CPU registers of the storing instruction) — ★ the game shifts the screen
   by a column **while the beam runs** (frame 2000 of level 1), so a row is
   what memory held when the chip read it, not what it held at one moment;
3. VICE's own picture of the frame: the emulator **quits at `$0F4D`**, so
   `-exitscreenshot` holds exactly frame N.

The monitor cannot stop "at the first `$0F4D`", so it runs twice: the first
pass counts the stops up to it, the second makes exactly that many and quits
(the emulation is deterministic, `-seed`).

    tools/mkscreen.py --at 300 -o data/screen.json
    tools/mkscreen.py --at 3000 --immortal -o build/screen3000.json
    tools/mkscreen.py --sweep 250:5500:250 --immortal      # -> build/screens/fNNNN.json
    tools/mkscreen.py --level 2 --at 300 --immortal -o build/screens2/f300.json
"""
import argparse, base64, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot, GAME_IRQ  # noqa: E402

TOP, BOTTOM = 0x0D04, 0x0F4D          # ★ raster 48 and 255 (disasm_notes §2)
STOP = re.compile(r'#\d+ \(Stop on\s+(exec|store) ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')
CPU = re.compile(r'^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*(\w{3})[^-]*- A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2})')


def script(a, tmp, gos, quit_):
    e = boot(level=a.level)
    if a.immortal:
        e.cmd('> 319c 60')
    e.brk(GAME_IRQ).ignore(1, a.at).go()
    e.cmd('del 1')
    e.brk(TOP).go()
    e.cmd('del 1')
    e.bsave(os.path.join(tmp, 'top_ram.bin'), 0, 0xFFFF, bank='ram')
    e.bsave(os.path.join(tmp, 'top_io.bin'), 0xD000, 0xDFFF)
    e.cmd('watch store $d000 $d02e')
    e.cmd('watch store $cc00 $cfff')
    e.cmd('watch store $d800 $dbe7')
    e.brk(BOTTOM)
    for _ in range(gos):
        e.go()
    e.bsave(os.path.join(tmp, 'bottom_ram.bin'), 0, 0xFFFF, bank='ram')
    e.bsave(os.path.join(tmp, 'bottom_io.bin'), 0xD000, 0xDFFF)
    if quit_:
        e.cmd('quit')
    return e


def parse(log):
    """Stops after the watches were set: (kind, addr, line, cycle, mnemonic, a, x, y)."""
    out, lines, i = [], log.splitlines(), 0
    start = None
    for n, l in enumerate(lines):
        if re.search(r'Stop on\s+exec 0d04\)', l):
            start = n
    for n in range(start + 1, len(lines)):
        s = STOP.search(lines[n])
        if not s:
            continue
        c = CPU.match(lines[n + 1]) if n + 1 < len(lines) else None
        out.append(dict(kind=s.group(1), addr=int(s.group(2), 16), line=int(s.group(3)),
                        cycle=int(s.group(4)),
                        op=c.group(2) if c else None,
                        a=int(c.group(3), 16) if c else None, x=int(c.group(4), 16) if c else None,
                        y=int(c.group(5), 16) if c else None))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--at', type=int, default=300, help='game interrupts into the level')
    ap.add_argument('--level', type=int, default=1, help='1-8: side B cut at the level (rtboot.boot)')
    ap.add_argument('--immortal', action='store_true', help='$319C <- RTS (see tracecoverage.py)')
    ap.add_argument('--sweep', metavar='FROM:TO:STEP', help='many frames into build/screens/')
    ap.add_argument('-o')
    a = ap.parse_args()
    if a.sweep:
        lo, hi, step = (int(x) for x in a.sweep.split(':'))
        for at in range(lo, hi + 1, step):
            a.at, a.o = at, os.path.join(PROJECT, 'build', 'screens', 'f%d.json' % at)
            record(a)
        return
    if not a.o:
        ap.error('-o or --sweep')
    record(a)


def record(a):
    name = os.path.splitext(os.path.basename(a.o))[0]
    if a.level > 1:
        name = 'l%d_%s' % (a.level, name)
    tmp = os.path.join(PROJECT, 'build', 'screen', name)
    os.makedirs(tmp, exist_ok=True)
    shot = os.path.join(tmp, 'vice.png')

    # pass 1: how many stops up to the end of the picture
    r = script(a, tmp, 6000, False).run(cycles=2_000_000_000,
                                         monlog=os.path.join(tmp, 'pass1.log'))
    stops = parse(r.log)
    n = next(i for i, s in enumerate(stops) if s['kind'] == 'exec' and s['addr'] == BOTTOM) + 1
    # pass 2: exactly that many, then quit with the picture of this frame
    r = script(a, tmp, n, True).run(cycles=2_000_000_000, screenshot=shot,
                                      monlog=os.path.join(tmp, 'pass2.log'))
    stops = parse(r.log)[:n]
    assert stops[-1]['addr'] == BOTTOM, 'pass 2 did not end at $0F4D'

    writes = []
    for s in stops[:-1]:
        value = {'STA': s['a'], 'STX': s['x'], 'STY': s['y']}.get(s['op'])
        if value is None:
            raise SystemExit('unexpected store %s at line %d' % (s['op'], s['line']))
        writes.append(dict(line=s['line'], cycle=s['cycle'], addr='%04X' % s['addr'], value=value))

    top = open(os.path.join(tmp, 'top_ram.bin'), 'rb').read()
    bottom = open(os.path.join(tmp, 'bottom_ram.bin'), 'rb').read()
    io = open(os.path.join(tmp, 'top_io.bin'), 'rb').read()
    iob = open(os.path.join(tmp, 'bottom_io.bin'), 'rb').read()
    b64 = lambda b: base64.b64encode(bytes(b)).decode()
    out = dict(
        source='R-Type, kazeta, úroveň %d, %d přerušení hry%s; tools/mkscreen.py'
               % (a.level, a.at, ', kolize vypnuté' if a.immortal else ''),
        note='bank = RAM $C000-$FFFF na začátku plochy ($0D04, rastr 48); vic = $D000-$D02E '
             'na $0D04; colorRAM tamtéž; writes = každý zápis do '
             '$D000-$D02E, $CC00-$CFFF a $D800-$DBE7 během snímku (rastr, cyklus, hodnota)',
        vicBank=3 - (io[0xD00] & 3), dd00=io[0xD00],
        vic=list(io[0:0x2F]),
        bank=b64(top[0xC000:0x10000]),
        colorRAM=[v & 15 for v in io[0x800:0x800 + 1000]],
        writes=writes,
        screenshot=os.path.relpath(shot, PROJECT))
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    json.dump(out, open(a.o, 'w'), indent=1)
    print('%d writes during the frame, picture %s -> %s' % (len(writes), out['screenshot'], a.o))


if __name__ == '__main__':
    main()
