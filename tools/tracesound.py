#!/usr/bin/env python3
"""tracesound — every write into the SID of a whole game in the original, with
its place: a second pass over a recording of `tracerules.py`.

For `matchsound.mjs` (M6). ★ The sound of R-Type is what the player of the
level's `M` (`$6370`-`$6D3F`, `sources/docs/disasm_notes.md` §14) writes into
`$D400`-`$D418`: **nineteen `STA`s in the player and one in tapeEnd**
(`$5E69`, the volume off after GAME OVER's fire) — the whole core, from the
disassembly (`sources/asm/main.asm`, `level1.asm`). This tool runs the very
same game as a recording of `tracerules.py` (the same hooks, the same seeded
script, the same patches — the harness is deterministic, which `--timing`
relies on too) and puts **a checkpoint with `command "g"` on each of the
twenty**: VICE prints the stop with the raster line and the cycle and the
registers (`A`, `X`, `Y` — the value and, for `STA $D4xx,Y`, the register)
and goes on without costing the program a single cycle (the lesson of
Impossible Mission's speech, R-044: a patch would move what it measures).

The stops of the recording are set again as they were (`$0DBA` every frame
up to `fine`, every `coarse`th after, `$0BFF`, `$0A38`, the events), so the
k-th stop of this pass is the k-th stop of the recording (`samples.json`),
and every write is filed under **the stop that follows it**: `writes[k]` are
the writes between stop k−1 and stop k, in the order the chip saw them, each
with the frame (`$0D04` traces), the raster line and the cycle. At every stop
the player's variables `$6370`-`$6475` are saved (`s%06d_snd.bin`), so the
matcher compares the player's memory as well as its writes.

    tools/tracesound.py --level 1 --scenario r      # -> build/rules/l1r/sound.json
    tools/tracesound.py --all                        # every recording in build/rules/
"""
import argparse, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from traceship import TOP, MAIN_LOOP  # noqa: E402
from traceenemies import IRQ48  # noqa: E402
from tracerules import setup, at_main_loop, FRAME_STOPS, EVENTS, LOAD_CYCLES  # noqa: E402

# ★ every `STA $D4xx` of the core: the player's (`$6476`-`$69B2`) and tapeEnd's (`$5E69`)
SID_SITES = (0x647D, 0x6480, 0x6483, 0x648A, 0x65DB, 0x65E6, 0x65EC, 0x65F5,
             0x6955, 0x695B, 0x6961, 0x6967, 0x696D, 0x6981, 0x698A, 0x6993, 0x6999, 0x69A6, 0x69AF,
             0x5E69)
PLAYER_VARS = (0x6370, 0x6475)
# `#3 (Stop on  exec 6955)  204/$0cc,  17/$011`
STOP = re.compile(r'#(\d+) \((Stop on|Trace)\s+exec ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')
# `.C:6955  99 04 D4    STA $D404,Y    - A:41 X:00 Y:07 SP:f3 ..-....C  12345678`
REGS = re.compile(r'^\.C:([0-9a-fA-F]{4})\s+([0-9A-Fa-f ]{8,11})\s+\S.*?-\s+A:([0-9A-Fa-f]{2})\s+X:([0-9A-Fa-f]{2})\s+Y:([0-9A-Fa-f]{2})')


def parse(log):
    """The writes of the log filed under the stop that follows them, the stops
    in order (address and frame, to check against `samples.json`)."""
    lines = log.split('\n')
    writes, stops, current = {}, [], []
    started, k, frame = False, 0, 0
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith('#'):
            continue
        m = STOP.match(s)
        if not m:
            continue
        kind, addr, raster, cycle = m.group(2), int(m.group(3), 16), int(m.group(4)), int(m.group(5))
        if kind == 'Trace':
            if started:
                frame += 1
            continue
        if addr in SID_SITES:
            if not started:
                continue
            regs = None
            for l2 in lines[i+1:i+4]:
                r = REGS.match(l2.strip())
                if r:
                    regs = r
                    break
            if not regs:
                continue
            raw = [int(x, 16) for x in regs.group(2).split()]
            a, x, y = (int(regs.group(j), 16) for j in (3, 4, 5))
            # ★ after the ending's `E` is loaded, other code lies at the player's addresses (`$69AF` is a DEX):
            # a hit there is no write
            if len(raw) < 3 or raw[0] not in (0x8D, 0x99, 0x9D):
                continue
            target = raw[1] | raw[2] << 8
            if raw[0] == 0x99:
                target += y
            elif raw[0] == 0x9D:
                target += x
            if 0xD400 <= target <= 0xD418:
                current.append([target - 0xD400, a, frame, raster, cycle])
            continue
        if not started:
            if addr == MAIN_LOOP:
                started = True
            continue
        writes[k] = current
        stops.append(dict(k=k, at='$%04X' % addr, frame=frame))
        current = []
        k += 1
    writes['tail'] = current
    return writes, stops, frame


def record(level, scenario, out, timeout, reparse=False):
    meta = json.load(open(os.path.join(out, 'meta.json')))
    frames, fine, coarse = meta['frames'], meta['fine'], meta['coarse']
    if reparse:
        class R: pass
        r = R(); r.log = open(os.path.join(out, 'sound.log'), errors='replace').read(); r.rc = 0
        return finish(level, scenario, out, r, meta)
    e, segs, rseed, _, _ = setup(level, scenario, frames, meta['seed'], meta.get('mortalAfter') or 0)
    at_main_loop(e, level, scenario)
    e.cmd('del 1')
    e.brk(TOP)                                              # #1: the `ignore` below is its
    for i, site in enumerate(SID_SITES):                    # #2-#21: printed and passed
        e.brk(site)
        e.on_break(2 + i, 'g')
    for a in list(FRAME_STOPS) + list(EVENTS):
        e.brk(a)
    e.cmd('trace exec $%04x' % IRQ48)
    steps = fine + (frames - fine)//coarse + 2500
    for k in range(steps):
        if k >= fine and coarse > 1:
            e.cmd('ignore 1 $%x' % (coarse - 1))
        e.go()
        e.bsave(os.path.join(out, 's%06d_snd.bin' % k), PLAYER_VARS[0], PLAYER_VARS[1], bank='ram')
    loads = 2
    # (half as much again as the recording had: the pass has to reach the recording's last stop)
    r = e.run(cycles=(400_000_000 + frames*19656*3 + loads*LOAD_CYCLES)*3//2, timeout=timeout,
              monlog=os.path.join(out, 'sound.log'), moncmds=os.path.join(out, 'sound.cmds'))
    return finish(level, scenario, out, r, meta)


def finish(level, scenario, out, r, meta):
    """The log parsed into `sound.json` (also `--reparse`, without the emulator)."""
    writes, stops, last = parse(r.log)
    # the stops of the recording: the pass must have made the same ones
    samples = json.load(open(os.path.join(out, 'samples.json')))['stops']
    same = all(s['at'] == t['at'] and s['frame'] == t['frame'] for s, t in zip(stops, samples))
    complete = len(stops) >= len(samples)
    total = sum(len(v) for v in writes.values())
    regs = sorted({w[0] for v in writes.values() for w in v})
    json.dump(dict(level=level, scenario=scenario, sites=['$%04X' % a for a in SID_SITES], vars='$%04X-$%04X' % PLAYER_VARS,
                   stops=len(stops), sameStops=same, complete=complete, recordingStops=len(samples), lastFrame=last, writeCount=total,
                   registers=['$D4%02X' % x for x in regs],
                   note='writes[k] = the writes into $D400-$D418 between stop k-1 and stop k of samples.json, in order, '
                        '[register, value, frame, raster, cycle]; tail = after the last stop; s%06d_snd.bin = $6370-$6475 at stop k',
                   writes={str(k): v for k, v in writes.items()}),
              open(os.path.join(out, 'sound.json'), 'w'))
    print('level %d%s: %d stops of the recording\'s %d (%s%s), %d writes, registers %s, last frame %d (VICE rc %d) -> %s'
          % (level, scenario, len(stops), len(samples), 'the same' if same else '!! NOT the recording\'s',
             '' if complete else ', !! INCOMPLETE — more cycles', total, ' '.join('%02X' % x for x in regs), last, r.rc, out))
    return same and complete and total > 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='r')
    ap.add_argument('--all', action='store_true', help='every recording in build/rules/')
    ap.add_argument('--only', help='with --all: only these, e.g. l1r,l2s')
    ap.add_argument('--dir', default=os.path.join(PROJECT, 'build', 'rules'))
    ap.add_argument('--timeout', type=int, default=4*3600)
    ap.add_argument('--reparse', action='store_true', help='only parse an existing sound.log again')
    a = ap.parse_args()
    if a.all:
        names = sorted(n for n in os.listdir(a.dir) if re.match(r'^l\d[a-z]$', n) and os.path.exists(os.path.join(a.dir, n, 'meta.json')))
        if a.only:
            names = [n for n in names if n in a.only.split(',')]
    else:
        names = ['l%d%s' % (a.level, a.scenario)]
    ok = True
    for name in names:
        ok &= record(int(name[1]), name[2], os.path.join(a.dir, name), a.timeout, a.reparse)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
