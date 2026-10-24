#!/usr/bin/env python3
"""tracerules — whole games in the original: deaths, READY, the checkpoint,
the end of a level, the next level from tape, GAME OVER.

For `matchrules.mjs` (M5). The harness of `traceenemies.py` (the joystick,
the space bar and every `LDA $DC04` replaced by hooks at `$6000`, a scripted
flight, the spawner in) runs on through everything the main loop `$08C1`
does around a level (`sources/docs/disasm_notes.md` §13):

- a **death** (`$3219`) ends in **READY** (`$0B6C`: the text, 50 frames, then
  fire) and a **restart** from the start of the level (`$0924`) or from its
  one **checkpoint** (`$08FC`, `$0B64` by level);
- the **end of a level** (`$5E17`) ends in the 288-frame sequence of the
  ship flying to the centre (`$09C5`-`$0A4E`), the **next level loaded from
  tape** (`$0A9C`, the tape just goes on) and its init (`$088A`) with READY;
- the **last life** (`$32AB`) ends in `tapeEnd` (`$5E47`): GAME OVER as a
  READY text, then the PLEASE REWIND TAPE screen waiting for F1 (`$5ED3`),
  PRESS PLAY ON TAPE and the loader again (`$0818`) — the recording ends
  there: what the tape gives then is the human's rewind.

Three things are new in the harness:

- `$0C27 LDA $DC00` (fire at READY) is the joystick hook too, so the script
  goes on counting frames in READY and its fire taps let the game continue;
- `$5ED3 LDA $CB` (F1 after GAME OVER) is `LDA #4` — F1 pressed at once;
  ★ the `LDA #5 / BNE` right after it is where `CMP #5 / BEQ` (F3, two
  players) once was: the two-player mode is switched off in this version;
- **`--mortal-after K`** (scenario `c`): a hook at `$5FC0` in place of
  `$319C LDA $1190` keeps the ship immortal for the first K frames of the
  hook's counter (`$6002/$6003`, the joystick reads) and mortal after —
  so that a death comes **past the checkpoint**. The remake applies the same
  rule from `meta.json` (`Ship.mortalAfter`).

Every stop saves the same memory as `traceenemies.py` (eleven files, named
by the index of the stop `s%06d_*`), and the monitor log says what each
stop was and in which frame: `trace exec $0D04` counts the raster-48
handlers as M3/M4 count frames, also across READY and the loads where the
chain is off. `samples.json` is the list. Stops: `$0DBA` every frame up to
`--fine`, every `--coarse`th after (the `ignore` of VICE is set before every
`g`, so an event in between resets the cadence — the frame of a stop comes
from the log, never from the cadence); `$0BFF` every frame of READY;
`$0A38` every frame of the level-end sequence; and the events above.

Scenarios: `r` — mortal from the start (deaths before the checkpoint, the
restart from the start, GAME OVER); `c` — immortal until the checkpoint is
passed (`--mortal-after`, by default from the level's checkpoint column),
mortal after (the restart from the checkpoint, GAME OVER); `s` — immortal
with the items and the end of the level one hit away as `h` of M4 (the end
of the level, the sequence, the next level from tape, its READY and its
first frames; after level 8 the ending `E`).

`--timing` repeats a recording with checkpoints only, as `traceenemies.py
--timing` (`timing.json`: the state of the column shift when a handler
nested into it) — needed by `matchrules.mjs` in the frames of play.

    tools/tracerules.py --level 1 --scenario r          # -> build/rules/l1r/
    tools/tracerules.py --all                           # s for 1-8, r and c for 1-8
    tools/tracerules.py --all --timing
"""
import argparse, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot  # noqa: E402
import rtlib  # noqa: E402
from traceship import (hook_code, script_bytes, poke, HOOK_JOY, HOOK_SPACE, HOOK_RND, TABLE, SEG_IDX, JOY_READ,  # noqa: E402
                       SPACE_READS, ENTROPY_READS, MAIN_LOOP, TOP, COLLISION)
from traceenemies import (make_script, level_entropy_reads, and_hook_code, HOOK_AND, poke_items, ONE_HIT,  # noqa: E402
                          timing_run, TIMING_NOTE, COPY_LOOPS, IRQ48, SPAWNER_CALL, IRQ202, nested_frame)

READY_FIRE = 0x0C27          # ★ LDA $DC00 of the READY loop
F1_WAIT = 0x5ED3             # ★ LDA $CB ; CMP #4 of tapeEnd
HOOK_COLL = 0x5FC0           # the collision hook of `c` (free RAM at the end of the core, zero on the tape)
READY = 0x0B6C
# ★ the stops that are events (one hit each, state saved) — the addresses of §13
EVENTS = {
    0x3219: 'death',         # the explosion is over: a life lost
    READY: 'ready',          # READY entered (A: 0 a life lost, 1 a level starts, $80 GAME OVER)
    0x0C2E: 'fire',          # fire accepted at READY
    0x08FC: 'checkpoint',    # the restart from the checkpoint
    0x0924: 'restart',       # the restart from the start of the level
    0x5E17: 'levelEnd',      # the level is over
    0x09C5: 'sequence',      # the level-end sequence begins (the playfield cleared, 288 frames)
    0x0A9C: 'load',          # the next level's three files from tape
    0x088A: 'levelInit',     # the next level's init (after the load)
    0x5E47: 'gameOver',      # the last life: tapeEnd
    0x5ED3: 'rewind',        # PLEASE REWIND TAPE waits for F1 — the game is over
    0x0818: 'levelStart',    # the loader again (after PRESS PLAY ON TAPE): the recording ends
    0x5FB1: 'ending',        # level 8 done: E loaded, $8000 runs
    MAIN_LOOP: 'mainLoop',   # the main loop entered (after the init, a restart, a level): its raster says whether
                             # the raster-48 handler of the frame ran inside the restart code
}
FRAME_STOPS = {0x0BFF: 'readyFrame', 0x0A38: 'endFrame'}
LOG = re.compile(r'#(\d+) \((Stop on|Trace)\s+exec ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')
REGS = re.compile(r'\.C:([0-9a-f]{4}) .* - A:([0-9A-Fa-f]{2}) X:([0-9A-Fa-f]{2}) Y:([0-9A-Fa-f]{2}) SP:([0-9A-Fa-f]{2})')
SAVES = [('low', 0x0000, 0x07FF), ('mid', 0x0977, 0x0E84), ('v1', 0x1190, 0x2497), ('v2', 0x2805, 0x3AE3),
         ('v3', 0x3B99, 0x4961), ('v4', 0x4C4B, 0x4EB6), ('v5', 0x4F00, 0x5FFF), ('hook', 0x6000, 0x600F),
         ('lv', 0x7A00, 0x99FF), ('bank', 0xC600, 0xD2FF)]
LOAD_CYCLES = 250_000_000    # a level's three files from tape (★ ~100 M cycles; two loads can follow: a level and the glitch of $0310)


def coll_hook_code(k):
    """★ `$319C` becomes `JSR $5FC0`; the hook leaves A = `$1190` (N = its bit
    7, the `BMI` after decides) once the frame counter of the joystick hook
    reached `k`, and A = 0 before — immortal."""
    lo, hi = k & 0xFF, k >> 8
    code = bytes([
        0xAD, 0x03, 0x60,            # 00 LDA $6003
        0xC9, hi,                    # 03 CMP #hi
        0x90, 0x0D,                  # 05 BCC immortal (14)
        0xD0, 0x07,                  # 07 BNE mortal (10)
        0xAD, 0x02, 0x60,            # 09 LDA $6002
        0xC9, lo,                    # 0C CMP #lo
        0x90, 0x04,                  # 0E BCC immortal (14)
        0xAD, 0x90, 0x11,            # 10 mortal: LDA $1190
        0x60,                        # 13 RTS
        0xA9, 0x00,                  # 14 immortal: LDA #0
        0x60,                        # 16 RTS
    ])
    assert len(code) == 0x17 and HOOK_COLL + len(code) <= 0x5FFF
    return code


def checkpoint_frames(level):
    """★ When the map pointer passes the level's checkpoint: a column every 16
    frames from column $27 (`$0B64`), plus a margin; level 3's checkpoint is
    page-based (always taken) and level 8's is the start column."""
    chk = rtlib.image()[0x0B64 + level - 1]
    if level == 3 or chk <= 0x27:
        return 1500
    return (chk - 0x27)*16 + 200


def setup(level, scenario, frames, seed, mortal_after):
    """The original booted into the level with the hooks, the script, the
    generator's seed and the patches of the scenario in (not yet at `$08C1`)."""
    e = boot(level=level)
    if scenario == 's':
        e.cmd('> %04x 60' % COLLISION)
    for addr, code in hook_code().items():
        poke(e, addr, code)
    segs = make_script(seed, frames, 'e' if scenario == 's' else 'f')
    poke(e, TABLE, script_bytes(segs))
    rseed = (seed*0x9E37 + 0x1D87) & 0xFFFF or 1
    poke(e, SEG_IDX, bytes([0, segs[0][1], 0, 0, rseed & 0xFF, rseed >> 8]))
    for a in (JOY_READ, READY_FIRE):
        poke(e, a, bytes([0x20, HOOK_JOY & 0xFF, HOOK_JOY >> 8]))
    for a in SPACE_READS:
        poke(e, a, bytes([0x20, HOOK_SPACE & 0xFF, HOOK_SPACE >> 8]))
    level_reads, level_ands = level_entropy_reads(level)
    for a in ENTROPY_READS + level_reads:
        poke(e, a, bytes([0x20, HOOK_RND & 0xFF, HOOK_RND >> 8]))
    poke(e, HOOK_AND, and_hook_code())
    for a in level_ands:
        poke(e, a, bytes([0x20, HOOK_AND & 0xFF, HOOK_AND >> 8]))
    poke(e, F1_WAIT, bytes([0xA9, 0x04, 0xEA]))                 # LDA #4 ; NOP
    if scenario == 'c':
        poke(e, HOOK_COLL, coll_hook_code(mortal_after))
        poke(e, COLLISION, bytes([0x20, HOOK_COLL & 0xFF, HOOK_COLL >> 8]))
    return e, segs, rseed, level_reads, level_ands


def at_main_loop(e, level, scenario):
    """At the first `$08C1`: the pokes of `s` (items, the end one hit away)."""
    e.brk(MAIN_LOOP).go()
    items = poke_items(e, level) if scenario == 's' else []
    return items


def parse_log(log):
    """The stops in order with their frame: (k, addr, raster, cycle, A) —
    k counts the stops after the init's `$08C1`, frame the `$0D04` traces
    before the stop."""
    lines = log.split('\n')
    stops, started, k, frame, init = [], False, -1, 0, None
    for i, line in enumerate(lines):
        m = LOG.match(line.strip()) if line.strip().startswith('#') else None
        if not m:
            continue
        kind, addr, raster, cycle = m.group(2), int(m.group(3), 16), int(m.group(4)), int(m.group(5))
        if kind == 'Trace':
            if started:
                frame += 1
            continue
        if not started:
            if addr == MAIN_LOOP:
                started = True
                init = dict(raster=raster, cycle=cycle)
            continue
        a = None
        for l2 in lines[i+1:i+4]:
            r = REGS.search(l2)
            if r:
                a = int(r.group(2), 16)
                break
        k += 1
        stops.append(dict(k=k, addr=addr, frame=frame, raster=raster, cycle=cycle, a=a))
    return stops, frame, init


def record(level, scenario, frames, fine, coarse, seed, out, mortal_after):
    os.makedirs(out, exist_ok=True)
    e, segs, rseed, level_reads, level_ands = setup(level, scenario, frames, seed, mortal_after)
    items = at_main_loop(e, level, scenario)
    e.bsave(os.path.join(out, 'init_ram.bin'), 0, 0xFFFF, bank='ram')
    e.bsave(os.path.join(out, 'init_io.bin'), 0xD000, 0xDFFF, bank='io')
    e.cmd('del 1')
    e.brk(TOP)                                              # #1: the `ignore` below is its
    for a in list(FRAME_STOPS) + list(EVENTS):
        e.brk(a)                                            # (MAIN_LOOP again: the stops after the init's)
    e.cmd('trace exec $%04x' % IRQ48)
    steps = fine + (frames - fine)//coarse + 2500
    for k in range(steps):
        if k >= fine and coarse > 1:
            e.cmd('ignore 1 $%x' % (coarse - 1))
        e.go()
        p = os.path.join(out, 's%06d_' % k)
        for name, lo, hi in SAVES:
            e.bsave(p + name + '.bin', lo, hi, bank='ram')
        e.bsave(p + 'io.bin', 0xD000, 0xDBFF, bank='io')
    loads = 2
    r = e.run(cycles=400_000_000 + frames*19656*3 + loads*LOAD_CYCLES, timeout=4*3600,
              monlog=os.path.join(out, 'monitor.log'), moncmds=os.path.join(out, 'moncmds.txt'))
    stops, last, init = parse_log(r.log)
    # the stops that have their files; the kinds; the recording ends at the end of the game
    kept, ended = [], None
    for s in stops:
        if not os.path.exists(os.path.join(out, 's%06d_low.bin' % s['k'])):
            break
        s['kind'] = 'top' if s['addr'] == TOP else FRAME_STOPS.get(s['addr']) or EVENTS.get(s['addr'], 'other')
        s['at'] = '$%04X' % s['addr']
        del s['addr']
        kept.append(s)
        if s['kind'] in ('levelStart', 'ending'):
            ended = s['kind']
            break
    events = [s for s in kept if s['kind'] not in ('top', 'readyFrame', 'endFrame')]
    tops = [s for s in kept if s['kind'] == 'top']
    meta = dict(level=level, scenario=scenario, frames=frames, fine=fine, coarse=coarse, seed=seed, rngSeed=rseed,
                mortalAfter=mortal_after if scenario == 'c' else (0 if scenario == 'r' else None),
                immortal=scenario == 's', items=items, oneHit=ONE_HIT.get(level, []) if scenario == 's' else [],
                samples=len(tops), stops=len(kept), lastFrame=kept[-1]['frame'] if kept else 0, ended=ended,
                initRaster=init['raster'] if init else None, initCycle=init['cycle'] if init else None,
                hooks=dict(joy='$%04X' % HOOK_JOY, space='$%04X' % HOOK_SPACE, rnd='$%04X' % HOOK_RND,
                           coll='$%04X' % HOOK_COLL if scenario == 'c' else None, table='$%04X' % TABLE, vars='$%04X' % SEG_IDX,
                           patched=dict(joystick=['$%04X' % JOY_READ, '$%04X' % READY_FIRE], space=['$%04X' % a for a in SPACE_READS],
                                        entropy=['$%04X' % a for a in ENTROPY_READS],
                                        levelEntropy=['$%04X' % a for a in level_reads], levelAnd=['$%04X' % a for a in level_ands],
                                        f1='$%04X' % F1_WAIT)),
                events=[dict(kind=s['kind'], frame=s['frame'], k=s['k'], a=s['a']) for s in events],
                note='init = RAM at the first $08C1 (items poked just before the dump in s); a stop s%06d is the k-th stop '
                     'after it (samples.json: kind, frame = hits of $0D04 since the init — a top stop at $0DBA in frame f '
                     'sees f-1 complete frames as in M3/M4; readyFrame = $0BFF once a frame of READY; endFrame = $0A38 once '
                     'a frame of the level-end sequence; the events of §13); the spawner runs; '
                     + ('$319C = RTS' if scenario == 's' else ('$319C -> hook $5FC0: mortal after %d joystick reads' % mortal_after
                                                                if scenario == 'c' else 'mortal'))
                     + '; $2824/$0C27/$2A2A/$2AB0/$DC04 reads -> hooks at $6000; $5ED3 = LDA #4 (F1)')
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    json.dump(dict(stops=kept), open(os.path.join(out, 'samples.json'), 'w'))
    json.dump(dict(seed=seed, segments=[list(s) for s in segs]), open(os.path.join(out, 'script.json'), 'w'))
    print('level %d%s: %d stops, %d samples, last frame %d, events %s -> %s (VICE rc %d, %d stops in the log)'
          % (level, scenario, len(kept), len(tops), meta['lastFrame'],
             ' '.join('%s@%d' % (ev['kind'], ev['frame']) for ev in meta['events']), out, r.rc, len(stops)))
    return len(tops) > 0


# ★ the init of a level or a restart, which the chain's handlers nest into (`disasm_notes.md` §13): the set copied
# ($11FA-$1223, X counts the byte), the 19 rows of the screen ($11CD-$11F8: X = rows left, Y = the column, the
# screen byte stored at $11D1, the colour at $11DC), and the short routines before them
INIT_RANGES = [(0x08F5, 0x0937), (0x088A, 0x08C1), (0x08B2, 0x08C1), (0x14FF, 0x15DB), (0x15DB, 0x162F), (0x1224, 0x139A),
               (0x1425, 0x14FF), (0x11A2, 0x1224), (0x162F, 0x1794), (0x0A4E, 0x0AC9),
               (0x0B6C, 0x0BF8), (0x1192, 0x11A2), (0x5E47, 0x5E5D)]   # READY's entry and its clear $1192 (phase `ready`)
READY_RANGES = [(0x0B6C, 0x0BF8), (0x1192, 0x11A2), (0x5E47, 0x5E5D)]
FIRST_SCREEN, SET_COPY = (0x11CD, 0x11F9), (0x11FC, 0x1224)
POINT = {IRQ48: 'irq48', SPAWNER_CALL: 'band5', IRQ202: 'irq202'}


def init_progress(addr, d, regs, f, raster, cycle):
    """★ A handler that came while the init of a level or a restart was
    running: where `$11A2` stood — `set: n` bytes of the set copied,
    `cells: n` cells of the first screen written (the screen byte of the
    n-th cell stored, its colour too when `colour`), or `before` (the init
    before the first screen) / `after` (the first screen done, the main
    loop not yet entered)."""
    if addr not in POINT:
        return
    stack, sp = d[0x100:0x200], regs['sp']
    pc = stack[sp + 5] | stack[sp + 6] << 8
    y, x = stack[sp + 1], stack[sp + 2]
    found = nested_frame(stack, sp, CODE, INIT_RANGES)
    if found is None:
        return
    entry = dict(raster=raster, cycle=cycle, pc=pc, x=x, y=y, sp=sp)
    if SET_COPY[0] <= pc < SET_COPY[1]:
        entry['set'] = x
    elif FIRST_SCREEN[0] <= pc < FIRST_SCREEN[1]:
        # ★ X = rows left ($13 down; one less from $11F7), Y = the column — except between TAY ($11D6) and
        # LDY # ($11DA), where Y holds the character and the column sits in the operand $11DB
        rows = 0x13 - x - (1 if pc >= 0x11F7 else 0)
        col = d[0x301] if pc in (0x11D7, 0x11DA) else y
        if pc >= 0x11E3:
            col = 40
        if pc == 0x11CD:          # LDY #0 not yet done: Y is the row before's 40
            col = 0
        cell = rows*40 + col
        entry['cells'] = cell + (1 if 0x11D3 <= pc < 0x11E3 else 0)
        entry['colour'] = pc >= 0x11DE or pc < 0x11D3
    elif any(lo <= pc < hi for lo, hi in READY_RANGES[0:1] + READY_RANGES[2:]) or (0x1192 <= pc < 0x11A2 and not (0x11A2 <= found[0] < 0x1224)):
        entry['phase'] = 'ready'      # READY's entry or its clear $1192 (the sample sees it half done); level 3's init clears too ($11AA) — that is `before`
    elif 0x1192 <= pc < 0x11A2:
        entry['phase'] = 'before'
    elif found[0] < 0x11A2 and not (0x11A2 <= found[0] < 0x1224):
        entry['phase'] = 'before' if found[0] >= 0x1425 or 0x14FF <= found[0] < 0x162F or 0x1224 <= found[0] < 0x139A or 0x162F <= found[0] < 0x1794 else 'main'
    else:
        entry['phase'] = 'after'
    f.setdefault('init', {})[POINT[addr]] = entry


CODE = None


def timing(level, scenario, frames, seed, out, mortal_after, length=None):
    """The timing pass of `traceenemies.py` on the same run: READY resets the
    shift (an interrupted shift never resumes), the loads get their cycles."""
    global CODE
    CODE = rtlib.image(level)
    e, segs, rseed, _, _ = setup(level, scenario, frames, seed, mortal_after)
    at_main_loop(e, level, scenario)
    e.cmd('del 1')
    loads = 2
    # ★ the script is made from `frames` (as the recording's), the pass runs as long as the recording did
    frame, cols = timing_run(e, level, length or frames, out, extra_cycles=loads*LOAD_CYCLES, resets=(READY,), extra=init_progress)
    json.dump(dict(level=level, scenario=scenario, frames=frame,
                   note=TIMING_NOTE + '; init = a handler nested into the init of a level or a restart: set n (bytes of the set '
                        'copied by $11FA), cells n (cells of the first screen written by $11CD, colour = its colour too), '
                        'phase before/after/main',
                   loops=[dict(rows=n) for _, _, n in COPY_LOOPS], shifts=cols),
              open(os.path.join(out, 'timing.json'), 'w'), indent=1)
    meta = os.path.join(out, 'meta.json')
    last = json.load(open(meta))['lastFrame'] if os.path.exists(meta) else 0
    print('level %d%s timing: %d frames (%d recorded), %d shifts' % (level, scenario, frame, last, sum(1 for v in cols.values() if 'start' in v)))
    if frame < last - 2:
        print('  !! the timing run stopped at frame %d of %d — run it again' % (frame, last))
        return False
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='r', help='r = mortal; c = mortal after the checkpoint; s = immortal, the end one hit away, the next level')
    ap.add_argument('--all', action='store_true', help='levels 1-8, scenarios r, c and s')
    ap.add_argument('--levels', help='with --all: only these levels, e.g. 1,5,8')
    ap.add_argument('--scenarios', default='rcs', help='with --all: only these scenarios')
    ap.add_argument('--frames', type=int, help='default: r 6000, c checkpoint + 3500, s 9000 (13000 in levels 3, 6, 7)')
    ap.add_argument('--fine', type=int, default=300, help='every frame up to here')
    ap.add_argument('--coarse', type=int, default=5, help='then every Nth frame')
    ap.add_argument('--seed', type=int, help='script seed (default: level*16 + scenario + 16)')
    ap.add_argument('--mortal-after', type=int, help='c: frames of immortality (default from the checkpoint)')
    ap.add_argument('--out', help='directory (default build/rules/l<level><scenario>)')
    ap.add_argument('--timing', action='store_true', help='only the timing of an existing recording (timing.json)')
    a = ap.parse_args()
    only = [int(x) for x in a.levels.split(',')] if a.levels else range(1, 9)
    runs = [(level, sc) for level in only for sc in a.scenarios] if a.all else [(a.level, a.scenario)]
    ok = True
    for level, sc in runs:
        seed = a.seed if a.seed is not None else level*16 + ord(sc)-ord('a') + 16
        out = a.out or os.path.join(PROJECT, 'build', 'rules', 'l%d%s' % (level, sc))
        mortal_after = a.mortal_after if a.mortal_after is not None else checkpoint_frames(level)
        frames = a.frames
        if frames is None:
            frames = {'r': 6000, 'c': mortal_after + 3500, 's': 13000 if level in (3, 6, 7) else 9000}[sc]
        if a.timing:
            meta = json.load(open(os.path.join(out, 'meta.json')))
            # (the recording runs past `frames` — its last frame is what the timing has to reach)
            ok &= timing(level, sc, meta['frames'], meta['seed'], out, meta.get('mortalAfter') or 0, length=max(meta['frames'], meta['lastFrame']))
            continue
        ok &= record(level, sc, frames, a.fine, a.coarse, seed, out, mortal_after)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
