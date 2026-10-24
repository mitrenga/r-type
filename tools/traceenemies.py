#!/usr/bin/env python3
"""traceenemies — the original with its enemies, waves and bosses, frame by frame.

For `matchenemies.mjs` (M4). The same harness as `traceship.py` (the
joystick, the space bar and the 16 `LDA $DC04` of the core replaced by hooks
in free RAM at `$6000`, a scripted flight) — but the **wave spawner `$4FA8`
stays in**, so the enemies launch, fly, shoot, get hit and die, carry items,
and the level ends with its boss. Two things are new:

- ★ the boss code of a level lives in its `M` (the routine `$7ACD/$7ACE`
  the core calls at `$57F7`) and **reads `$DC04` too** (levels 1, 4 and 5 —
  scanned on the tape image, `meta.json` lists them); those reads become
  the same `JSR rnd` as the core's, so the remake's generator stands there.
  Level 1's hook also **`AND`s the timer into the star glyphs** (`$9436`,
  `$944F`) and later rotates those glyphs with the carry deciding its own
  state, so the `AND` gets a hook of its own (`$6084`: the generator ANDed
  into A) — M3 left it to the timer, M4 needs the state;
- the samples carry more memory: the enemy and boss state in `$4F00`-`$5FFF`
  (self-modified operands of the spawner and the boss) and the level's own
  code and variables `$7A00`-`$9A00`, and the sprite registers of sprites 3-7
  as the raster-48 handler leaves them (band 0 of the multiplexer).

Scenarios: `e` — immortal (`$319C` = `RTS`), a calm flight with much fire,
long enough to reach the boss; `f` — mortal, until the first death;
`g` — immortal, no fire at all (the enemies live and the multiplexer
overloads); `h` — immortal with much fire, **the items of M3 poked in**
(crystal, bits, speed, missiles: the lasers and the Force get to hit) and
**the end of the level one hit away** (★ the boss's hits `$7AD0/$7AD1` ← 1,
level 4's parts `$847A` ← 1, level 2's end object `$9444` ← 1 — bytes of
the level's own data, which the remake reads from the same dump), 12 000
frames so that levels 3 and 7 run out. Sampling at `$0DBA` as in M3 (hit
*h* sees *h* − 1 frames).

    tools/traceenemies.py --level 1 --scenario e        # -> build/enemies/l1e/
    tools/traceenemies.py --all
"""
import argparse, json, os, random, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot  # noqa: E402
import rtlib  # noqa: E402
from traceship import (hook_code, script_bytes, poke, items_of, HOOK_JOY, HOOK_SPACE, HOOK_RND, TABLE, TABLE_END,  # noqa: E402
                       SEG_IDX, JOY_READ, SPACE_READS, ENTROPY_READS, MAIN_LOOP, TOP, COLLISION, STOP,
                       UP, DOWN, LEFT, RIGHT, FIRE, SPACE)

# ★ scenario h: the end of the level one hit away — the hits of the boss ($7AD0/$7AD1 of the record the
# core copies at $56CF), of level 4's three parts ($8479 LDA #$7F -> $5DAE..) and of level 2's end object
# ($9443 LDA #8 -> $95DA every frame of the scroll)
ONE_HIT = {1: [(0x7AD0, 1), (0x7AD1, 0)], 4: [(0x7AD0, 1), (0x7AD1, 0), (0x847A, 1)], 5: [(0x7AD0, 1), (0x7AD1, 0)],
           8: [(0x7AD0, 1), (0x7AD1, 0)], 2: [(0x9444, 1)]}

LEVEL_M, LEVEL_G = 0x6370, 0x86AC


HOOK_AND = 0x6084           # STA $6007 ; JSR rnd ; AND $6007 ; RTS — keeps X and Y, N/Z as the AND left them (rnd ends at $6083)
AND_TMP = 0x6007


def and_hook_code():
    lo, hi = lambda a: a & 0xFF, lambda a: a >> 8
    code = bytes([0x8D, lo(AND_TMP), hi(AND_TMP), 0x20, lo(HOOK_RND), hi(HOOK_RND), 0x2D, lo(AND_TMP), hi(AND_TMP), 0x60])
    assert HOOK_RND + 20 <= HOOK_AND and HOOK_AND + len(code) <= TABLE
    return code


def level_entropy_reads(level):
    """★ Every `LDA $DC04` (and every `AND $DC04`, listed apart) in the
    level's `M` and `G` on the tape image."""
    m = rtlib.image(level)
    files = rtlib.level_files(level)
    lda, and_ = [], []
    for lo, hi in ((LEVEL_M, LEVEL_M + len(files['M'])), (LEVEL_G, LEVEL_G + len(files['G']))):
        for a in range(lo, hi - 2):
            if m[a+1] == 0x04 and m[a+2] == 0xDC:
                if m[a] == 0xAD: lda.append(a)
                elif m[a] == 0x2D: and_.append(a)
    return lda, and_


def make_script(seed, frames, scenario, scale=1):
    """Segments (bits, frames) as `traceship.make_script`, with the fire
    held more often: an immortal flight that shoots a lot (`e`), a mortal
    one (`f`), or one that never fires (`g`). The table at `$6090`-`$61FF`
    holds 183 segments; a long flight gets them stretched (`scale`) until
    they fit — deterministic for a seed."""
    rng = random.Random(seed)
    segs = [(0, 12)]
    total = 12
    calm = scenario != 'f'
    while total < frames:
        r = rng.random()
        if scenario == 'g':
            bits = rng.choice([0, 0, UP, DOWN, LEFT, RIGHT, UP, DOWN])
            n = rng.randint(3, 30)
        elif r < 0.35:
            bits = rng.choice([0, 0, UP, DOWN, LEFT, RIGHT, UP, DOWN]) if calm else rng.choice([0, UP, DOWN, LEFT, RIGHT, UP | LEFT, UP | RIGHT, DOWN | LEFT, DOWN | RIGHT])
            n = rng.randint(3, 20)
        elif r < 0.75:
            bits = rng.choice([0, 0, UP, DOWN, LEFT, RIGHT]) | FIRE      # taps and bursts
            n = rng.randint(1, 4)
        elif r < 0.88:
            bits = rng.choice([0, UP, DOWN]) | FIRE                     # hold: the beam charges
            n = rng.randint(30, 160)
        elif r < 0.95:
            bits = SPACE | rng.choice([0, 0, LEFT, RIGHT])
            n = rng.randint(1, 3)
        else:
            bits = 0
            n = rng.randint(8, 40)
        n = min(n*scale, 255)
        segs.append((bits, n))
        total += n
    segs.append((0, 255))
    if 2*(len(segs)+1) > TABLE_END-TABLE:
        return make_script(seed, frames, scenario, scale+1)
    return segs


# --- the timing of the column shift ------------------------------------
# ★ the shift ($3519-$361D: five loops over X = $D9..$FF copying 1, 2, 4, 7 and 5 rows a loop), the weapons
# moved ($361E), the pointer and the new column ($3641: 19 rows, $13/$14 the row's address), the RTI ($36A1);
# the handlers that nest: band 5 ($1166) and the raster-202 handler ($0E0B — both chains); $0D04 marks the frame
IRQ48, SPAWNER_CALL, IRQ202, BOSS_STEP = 0x0D04, 0x1166, 0x0E0B, 0x57F7
SHIFT_START, COPY_END, NEWCOL, NEWCOL_END, REDRAW_START, REDRAW_END = 0x3519, 0x361E, 0x3641, 0x36A1, 0x3848, 0x3935
COPY_LOOPS = [(0x3519, 0x352A, 1), (0x352A, 0x3547, 2), (0x3547, 0x357C, 4), (0x357C, 0x35D5, 7), (0x35D5, 0x361E, 5)]
# ★ the screen stores of each loop's rows (`STA $CB27,X` … `STA $CDF7,X`): a handler that nests between two of
# them sees the column half copied — the ground probe of the state machine reads it so ($5305)
COPY_STORES = [[0x351E], [0x352F, 0x353B], [0x354C, 0x3558, 0x3564, 0x3570], [0x3581, 0x358D, 0x3599, 0x35A5, 0x35B1, 0x35BD, 0x35C9],
               [0x35DA, 0x35E6, 0x35F2, 0x35FE, 0x360A]]
NEWCOL_LOOP = (0x367F, 0x36A1)
REGS = re.compile(r'\.C:([0-9a-f]{4}) .* - A:([0-9A-Fa-f]{2}) X:([0-9A-Fa-f]{2}) Y:([0-9A-Fa-f]{2}) SP:([0-9A-Fa-f]{2})')


def setup(level, scenario, frames, seed):
    """The original booted into the level with the hooks, the script and the
    generator's seed in — what `record` does before it samples."""
    e = boot(level=level)
    if scenario != 'f':
        e.cmd('> %04x 60' % COLLISION)
    if scenario == 'h':
        for addr, value in ONE_HIT.get(level, []):     # (in `timing()` too: the same run)
            e.cmd('> %04x %02x' % (addr, value))
    for addr, code in hook_code().items():
        poke(e, addr, code)
    segs = make_script(seed, frames, scenario)
    poke(e, TABLE, script_bytes(segs))
    rseed = (seed*0x9E37 + 0x1D87) & 0xFFFF or 1
    poke(e, SEG_IDX, bytes([0, segs[0][1], 0, 0, rseed & 0xFF, rseed >> 8]))
    poke(e, JOY_READ, bytes([0x20, HOOK_JOY & 0xFF, HOOK_JOY >> 8]))
    for a in SPACE_READS:
        poke(e, a, bytes([0x20, HOOK_SPACE & 0xFF, HOOK_SPACE >> 8]))
    level_reads, level_ands = level_entropy_reads(level)
    for a in ENTROPY_READS + level_reads:
        poke(e, a, bytes([0x20, HOOK_RND & 0xFF, HOOK_RND >> 8]))
    poke(e, HOOK_AND, and_hook_code())
    for a in level_ands:
        poke(e, a, bytes([0x20, HOOK_AND & 0xFF, HOOK_AND >> 8]))
    return e, segs, rseed, level_reads, level_ands


def shift_frame(stack, sp):
    """★ The shift's own interrupt frame in the stack: the handler that
    stopped may itself sit on top of band 5's state machine or on another
    handler that nested into the shift, so the frame is looked for from the
    top down — a return address inside the shift (`$3519`-`$36A6`, or the
    bullets' move `$4F6C` it calls) with the IRQ's Y, X, A, P below it.
    @returns (pc, x) or None."""
    for s in range(sp + 5, 0xFE):
        pc = stack[s] | stack[s + 1] << 8
        if SHIFT_START <= pc <= 0x36A6 or 0x4F6C <= pc <= 0x4F7F:
            return pc, stack[(s - 3) & 0xFF]
    return None


# ★ the enemy loop ($17FB-$1B60) and what it calls: the shooting, the pickup, the explosions
LOOP_RANGES = [(0x17FB, 0x1B61), (0x1B61, 0x1C47), (0x2154, 0x2334), (0x2498, 0x2562), (0x3440, 0x34C0), (0x33FB, 0x3413)]


# ★ band 5 ($114C): the spawner, the state machine and what they call — the raster-202 handler nests into
# them when the state machine runs past raster 202; the boss's step ($57F7 … the level's $7ACD) likewise
BAND5_RANGES = [(0x4F00, 0x5600), (0x5112, 0x518D), (0x56BD, 0x56CF)]
BOSS_RANGES = [(0x56CF, 0x5E47), (0x7ACD, 0x86AC), (0x8E6C, 0x9A00)]


def nested_frame(stack, sp, code, ranges):
    """★ As `loop_frame`, for any code: the PC the handler interrupted (sp+5),
    or — through the `JSR` return addresses above it — the call inside
    `ranges` that led to it. @returns (pc, x) or None."""
    s = sp + 5
    pc = stack[s] | stack[s + 1] << 8
    if any(lo <= pc < hi for lo, hi in ranges):
        return pc, stack[sp + 2]
    for _ in range(6):
        s += 2
        if s + 1 > 0xFF:
            return None
        ret = stack[s] | stack[s + 1] << 8
        if ret < 2 or code[ret - 2] != 0x20:
            return None
        if any(lo <= ret - 2 < hi for lo, hi in ranges):
            return ret - 2, stack[sp + 2]
    return None


def loop_frame(stack, sp, code):
    """★ The enemy loop's interrupt frame in the stack: band 5 nests into the
    loop when it is long, and the slots it has not reached yet then see the
    state machine's work. The loop runs in the raster-48 handler, which band 5
    interrupts **directly** (nothing nests between them), so its frame is the
    one right under the handler's own pushes (the KERNAL's Y, X, A and the
    IRQ's P at sp+1..sp+4, the PC at sp+5) — a scan deeper into the stack
    would pick up stale return addresses of handlers long finished (an
    explosion loop at `$2200`, found in thousands of frames). When the
    interrupted PC is in a subroutine the loop called through another
    (`$23B0` from the explosion, `$5112` from a carrier's death, the
    pickup's helpers), the return addresses above the frame lead back to
    it: each is accepted only as the return of a `JSR` (`code` has the
    program: opcode $20 two bytes before it), and the loop's step is then
    the `JSR` itself.
    @returns (pc, x) — the X register of the loop — or None."""
    s = sp + 5
    pc = stack[s] | stack[s + 1] << 8
    if any(lo <= pc < hi for lo, hi in LOOP_RANGES):
        return pc, stack[sp + 2]
    for _ in range(6):
        s += 2
        if s + 1 > 0xFF:
            return None
        ret = stack[s] | stack[s + 1] << 8
        if ret < 2 or code[ret - 2] != 0x20:
            return None
        if any(lo <= ret - 2 < hi for lo, hi in LOOP_RANGES):
            return ret - 2, stack[sp + 2]
    return None


def progress_of(pc, x, zp):
    """★ Where the shift stood: `copy: [loop, col, rows]` inside a copy loop
    (loop 0-4, col = X - $D9: the columns of its rows done so far, rows =
    the rows of column `col` already stored — the PC is past their `STA`),
    `copy: 'done'` past it, `pointer` once the map pointer moved (`$3658`),
    `column: rows` the rows of the new column written (`$13/$14`, the row's
    screen address); None when the shift is over or not running."""
    for i, (lo, hi, _) in enumerate(COPY_LOOPS):
        if lo <= pc < hi:
            return dict(copy=[i, max(0, x - 0xD9), sum(1 for sta in COPY_STORES[i] if pc > sta)])
    if COPY_END <= pc < NEWCOL or 0x4F6C <= pc <= 0x4F7F:          # ($4F6C: the bullets moved, called at $3633)
        return dict(copy='done', pointer=False, column=0, busy=pc < 0x3639 or pc >= 0x4F6C)
    if NEWCOL <= pc < NEWCOL_END:
        row = ((zp[0x13] | zp[0x14] << 8) - 0xCC26) // 40
        if pc < NEWCOL_LOOP[0]:
            row = 0
        elif pc <= 0x3687:
            pass                      # this row's stores not done yet
        else:
            row += 1
        return dict(copy='done', pointer=pc > 0x3658, column=max(0, min(19, row)), busy=False)
    if NEWCOL_END <= pc <= 0x36A6:
        return dict(copy='done', pointer=True, column=19, busy=False)
    return None


def parse_timing(log, dumps, code, resets=(), extra=None):
    """`timing.json` out of the monitor log of `timing()` and the stack dumps:
    for every frame in which a shift runs, where it stood when band 5 and
    the raster-202 handler came, and the frames and rasters of its ends."""
    lines = log.split('\n')
    events = []
    for k, line in enumerate(lines):
        m = STOP.match(line.strip()) if line.strip().startswith('#') else None
        if not m:
            continue
        regs = None
        for l2 in lines[k+1:k+4]:
            r = REGS.search(l2)
            if r:
                regs = dict(pc=int(r.group(1), 16), x=int(r.group(3), 16), sp=int(r.group(5), 16))
                break
        events.append((int(m.group(1), 16), int(m.group(2)), int(m.group(3)), regs))
    started = False
    frame = 0
    frames = {}
    shift = None
    k = -1
    for addr, ras, cyc, regs in events:
        if addr == MAIN_LOOP:
            started = True; continue
        if not started:
            continue
        k += 1
        if addr in resets:
            # ★ M5: READY ($0B6C) is entered from the main loop with a shift possibly interrupted on the
            # stack — it never resumes; $14FF clears $0225 (the parse would else wait for its end)
            shift = None
            continue
        if addr == IRQ48:
            frame += 1
            d = dumps.get(k)
            if d is not None and d[0x300]:
                # ★ $0DD0: the handler of raster 202 of the frame before still runs — no enemy loop this frame
                frames.setdefault(frame, {})['noLoop'] = True
            if extra is not None and d is not None and regs is not None:
                extra(addr, d, regs, frames.setdefault(frame, {}), ras, cyc)
            continue
        f = frames.setdefault(frame, {})
        if addr in (SHIFT_START, REDRAW_START):
            shift = frame
            f['start'] = dict(raster=ras, cycle=cyc, redraw=(addr == REDRAW_START))
        elif addr in (SPAWNER_CALL, IRQ202, BOSS_STEP):
            d = dumps.get(k)
            if extra is not None and d is not None and regs is not None:
                extra(addr, d, regs, f, ras, cyc)
            if d is not None and regs is not None:
                stack = d[0x100:0x200]
                busy, outer = d[0x225], d[0x300]
                found = shift_frame(stack, regs['sp'])
                prog = progress_of(found[0], found[1], d) if found else None
                in_loop = loop_frame(stack, regs['sp'], code) if addr == SPAWNER_CALL else None
                if in_loop is not None:
                    # ★ band 5 inside the enemy loop: slot $CD is the one being done (below $180F the loop is
                    # looking for the next one, X — $CD is then the slot done last)
                    f['loop'] = dict(raster=ras, cycle=cyc, slot=d[0xCD], pc=in_loop[0], x=in_loop[1])
                if addr == IRQ202:
                    # ★ the raster-202 handler inside band 5 (the state machine past raster 202) or inside the
                    # boss's step: the slot in hand and the PC — the slots after it see the handler's work
                    inb = nested_frame(stack, regs['sp'], code, BAND5_RANGES)
                    if inb is not None:
                        f['irq202InBand5'] = dict(pc=inb[0], x=inb[1], slot=d[0xCD])
                    else:
                        inb = nested_frame(stack, regs['sp'], code, BOSS_RANGES)
                        if inb is not None:
                            f['irq202InBoss'] = dict(pc=inb[0], x=inb[1])
                if shift is not None or found or busy:
                    entry = dict(raster=ras, cycle=cyc, progress=prog)
                    if addr == IRQ202:
                        # ★ $0E41: inside the shift ($0225) no music, bits, score, game step; $0E49: with the
                        # handler of the frame before still running ($0B5F) nothing at all
                        entry['gameStep'] = not busy and not outer
                        if outer:
                            entry['outer'] = True
                    f[{SPAWNER_CALL: 'band5', IRQ202: 'irq202', BOSS_STEP: 'tail'}[addr]] = entry
            elif addr == IRQ202 and shift is not None:
                f.setdefault('irq202', dict(raster=ras, cycle=cyc, progress=None, gameStep=True))
        elif shift is not None and addr in (COPY_END, NEWCOL, NEWCOL_END, REDRAW_END):
            name = {COPY_END: 'copyEnd', NEWCOL: 'entry', NEWCOL_END: 'end', REDRAW_END: 'end'}[addr]
            frames[shift].setdefault('ends', {})[name] = dict(frame=frame, raster=ras, cycle=cyc)
            if addr in (NEWCOL_END, REDRAW_END):
                shift = None
    out = {str(f): v for f, v in frames.items() if v}
    return frame, out


def timing(level, scenario, frames, seed, out):
    """★ The same run once more with checkpoints only (VICE is deterministic —
    checked byte for byte) to learn **where the column shift stood when the
    handlers nested into it**: the shift of ~16 000 cycles (`$3519`: five
    loops copying 1, 2, 4, 7 and 5 rows column by column, then the weapons
    moved, the map pointer, the new column row by row, `$36A1` RTI) outlasts
    its frame, and band 5 (the spawner and the state machine, `$1166`) and
    the raster-202 handler (`$0E0B`: the ship step; the game step only when
    the shift is over) run inside it — in the frame of the shift and the
    next one; with the boss its step (`$57F7`, from the tail of its rows).
    At every stop the zero page, the stack, `$0225` and `$0B5F` are saved:
    at those stops the shift's return address and X in the stack (found
    under whatever else nested, `shift_frame`) say which loop, which
    column or which row of the new column was being done (`progress_of`),
    `$0225` whether the handler saw the shift running and `$0B5F` whether
    the raster-202 handler of the frame before was still running (then the
    new one does nothing). ★ Level 3's window redraw (`$3848`-`$3935`, with
    the music player at its end) is traced the same way: when it reaches
    past raster 48 of the next frame, that frame's handler skips the step
    and the enemy loop (`$3702`, `$0DCB`). The remake replays that (`Ship.columnTiming`): the state
    machine's ground probe and the game step then read the same half-shifted
    screen the original read. Level 3's window redraw (`$3848`-`$3935`) is
    traced the same way (`end`)."""
    e, segs, rseed, _, _ = setup(level, scenario, frames, seed)
    e.brk(MAIN_LOOP).go()
    if scenario == 'h':
        # ★ the same run as `record`: the items in the slots change the Force, the lasers and so the timing
        poke_items(e, level)
    e.cmd('del 1')
    frame, cols = timing_run(e, level, frames, out)
    json.dump(dict(level=level, scenario=scenario, frames=frame,
                   note=TIMING_NOTE, loops=[dict(rows=n) for _, _, n in COPY_LOOPS], shifts=cols),
              open(os.path.join(out, 'timing.json'), 'w'), indent=1)
    shifts = sum(1 for v in cols.values() if 'start' in v)
    late = sum(1 for v in cols.values() if v.get('band5', {}).get('progress') and 'start' not in v
               and not v['band5']['progress'].get('pointer'))
    print('level %d%s timing: %d frames, %d shifts, %d with the pointer still old at band 5 of the next frame'
          % (level, scenario, frame, shifts, late))
    # ★ VICE has died before the end once (level 8g at frame 638 of 9000, under load): a run shorter than
    # the recording is no measurement
    meta = os.path.join(out, 'meta.json')
    if os.path.exists(meta):
        recorded = json.load(open(meta))['recorded']
        if frame < recorded[-1] - 2:
            print('  !! the timing run stopped at frame %d of %d — run it again' % (frame, recorded[-1]))
            return False
    return True


TIMING_NOTE = ('frame = hit of $0D04 (raster 48) since the init, the same count as the samples\' $0DBA; '
               'an entry per frame in which a column shift runs: its start, where it stood at band 5 ($1166), '
               'at the boss step ($57F7) and at the raster-202 handler ($0E0B) — copy [loop 0-4, columns done of that loop\'s rows] '
               'or done, pointer moved, rows of the new column written, busy = $0225 still set — whether '
               'the game step ran, and (at the frame of the start) the frame/raster of the copy\'s end, '
               'the new column\'s entry and the RTI; loop = band 5 inside the enemy loop (PC, X, $CD); '
               'irq202InBand5 / irq202InBoss = the raster-202 handler inside the state machine or the boss step; '
               'noLoop = the raster-202 handler of the frame before still ran at raster 48 ($0B5F): no enemy loop')


def timing_run(e, level, frames, out, extra_cycles=0, resets=(), extra=None):
    """The timing pass itself, on an emulator `e` standing at the first
    `$08C1` with its pokes done (checkpoint 1 deleted): the stops, the dumps,
    the run and the parse. `resets` are addresses that end any shift for the
    parse (M5: READY abandons an interrupted shift on the stack).
    @returns (frames, shifts) as `parse_timing` gives them."""
    for a in (IRQ48, SPAWNER_CALL, IRQ202, BOSS_STEP, SHIFT_START, COPY_END, NEWCOL, NEWCOL_END, REDRAW_START, REDRAW_END) + tuple(resets):
        e.brk(a)
    tmp = os.path.join(out, 'timing_dumps')
    os.makedirs(tmp, exist_ok=True)
    total = frames*3 + frames//3 + 10
    e.cmd('bank ram')
    for k in range(total):
        e.go()
        e.cmd('bsave "%s" 0 0000 02ff' % os.path.join(tmp, 'd%06d.bin' % k))      # zero page, stack, $0225
        e.cmd('bsave "%s" 0 0b5f 0b5f' % os.path.join(tmp, 'b%06d.bin' % k))      # $0B5F: a raster-202 handler still running
        e.cmd('bsave "%s" 0 11db 11db' % os.path.join(tmp, 'c%06d.bin' % k))      # $11DB: the column of the first screen (M5)
    # (some 30 000 stops with two saves each: well over an hour when eight run at once)
    r = e.run(cycles=400_000_000 + frames*19656*3 + extra_cycles, timeout=4*3600,
              monlog=os.path.join(out, 'timing_monitor.log'), moncmds=os.path.join(out, 'timing_moncmds.txt'))
    # the dumps by the index of the stop since the init
    dumps = {}
    k = -1
    started = False
    for a, _, _ in STOP.findall(r.log):
        a = int(a, 16)
        if a == MAIN_LOOP:
            started = True; continue
        if not started:
            continue
        k += 1
        if a in (SPAWNER_CALL, IRQ202, BOSS_STEP, IRQ48) or a in resets:
            try:
                dumps[k] = (open(os.path.join(tmp, 'd%06d.bin' % k), 'rb').read() + open(os.path.join(tmp, 'b%06d.bin' % k), 'rb').read()
                            + open(os.path.join(tmp, 'c%06d.bin' % k), 'rb').read())
            except OSError:
                pass
    frame, cols = parse_timing(r.log, dumps, rtlib.image(level), resets, extra)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    return frame, cols


def poke_items(e, level):
    """Scenario h: the items into sprite slots on the ship, as `traceship.py
    --scenario b` (meta: `items`), and the end of the level one hit away —
    at the first `$08C1`, in `record` and in `timing` alike."""
    items = items_of('b', level)
    for it in items:
        sl = it['slot']
        it['x'], it['y'] = 0x3F, 0x72+10
        e.cmd('> %04x 01' % (0x044C+sl))
        e.cmd('> %02x %02x' % (0xAF+sl, it['pointer']))
        e.cmd('> %02x %02x' % (0xBE+sl, it['color']))
        e.cmd('> %02x %02x' % (0x82+sl, it['x']))
        e.cmd('> %02x 00' % (0x91+sl))
        e.cmd('> %02x %02x' % (0xA0+sl, it['y']))
    for addr, value in ONE_HIT.get(level, []):
        e.cmd('> %04x %02x' % (addr, value))
    return items


def record(level, scenario, frames, fine, coarse, seed, out, immortal):
    os.makedirs(out, exist_ok=True)
    e, segs, rseed, level_reads, level_ands = setup(level, scenario, frames, seed)
    e.brk(MAIN_LOOP).go()
    items = []
    if scenario == 'h':
        items = poke_items(e, level)
    e.bsave(os.path.join(out, 'init_ram.bin'), 0, 0xFFFF, bank='ram')
    e.bsave(os.path.join(out, 'init_io.bin'), 0xD000, 0xDFFF, bank='io')
    e.cmd('del 1')
    e.brk(TOP)
    samples = []
    f = 0
    while f < frames:
        step = 1 if f < fine else coarse
        if step > 1:
            e.ignore(1, step-1)
        e.go()
        f += step
        samples.append(f)
        p = os.path.join(out, 'f%05d_' % f)
        e.bsave(p+'low.bin', 0x0000, 0x07FF, bank='ram')
        e.bsave(p+'mid.bin', 0x0977, 0x0E84, bank='ram')
        e.bsave(p+'v1.bin', 0x1190, 0x2497, bank='ram')
        e.bsave(p+'v2.bin', 0x2805, 0x3AE3, bank='ram')
        e.bsave(p+'v3.bin', 0x3B99, 0x4961, bank='ram')
        e.bsave(p+'v4.bin', 0x4C4B, 0x4EB6, bank='ram')
        e.bsave(p+'v5.bin', 0x4F00, 0x5FFF, bank='ram')
        e.bsave(p+'hook.bin', 0x6000, 0x600F, bank='ram')
        e.bsave(p+'lv.bin', 0x7A00, 0x99FF, bank='ram')
        e.bsave(p+'bank.bin', 0xC600, 0xD2FF, bank='ram')
        e.bsave(p+'io.bin', 0xD000, 0xDBFF, bank='io')
    e.bsave(os.path.join(out, 'end_free.bin'), 0x5FBC, 0x5FFF, bank='ram')
    r = e.run(cycles=400_000_000 + frames*19656*3,
              monlog=os.path.join(out, 'monitor.log'), moncmds=os.path.join(out, 'moncmds.txt'))
    stops = STOP.findall(r.log)
    init = next((s for s in stops if s[0] == '%04x' % MAIN_LOOP), None)
    tops = [s for s in stops if s[0] == '%04x' % TOP]
    got = [f for f in samples if os.path.exists(os.path.join(out, 'f%05d_low.bin' % f))]
    meta = dict(level=level, scenario=scenario, frames=frames, fine=fine, coarse=coarse, seed=seed,
                rngSeed=rseed, samples=len(tops), recorded=got, sampleAt='$%04X' % TOP,
                immortal=immortal, noWaves=False, items=items, oneHit=ONE_HIT.get(level, []) if scenario == 'h' else [],
                hooks=dict(joy='$%04X' % HOOK_JOY, space='$%04X' % HOOK_SPACE, rnd='$%04X' % HOOK_RND,
                           table='$%04X' % TABLE, vars='$%04X' % SEG_IDX,
                           patched=dict(joystick=['$%04X' % JOY_READ], space=['$%04X' % a for a in SPACE_READS],
                                        entropy=['$%04X' % a for a in ENTROPY_READS],
                                        levelEntropy=['$%04X' % a for a in level_reads],
                                        levelAnd=['$%04X' % a for a in level_ands])),
                initRaster=int(init[1]) if init else None, initCycle=int(init[2]) if init else None,
                note='init = RAM at the first $08C1; a sample at $0DBA named fNNNNN is hit NNNNN of the '
                     'checkpoint since the init and sees NNNNN-1 frames; the spawner $4FA8 runs'
                     + ('; $319C = RTS' if immortal else '')
                     + '; $2824/$2A2A/$2AB0/$DC04 reads (core and level) -> hooks at $6000')
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    json.dump(dict(seed=seed, segments=[list(s) for s in segs]), open(os.path.join(out, 'script.json'), 'w'))
    print('level %d%s: init at raster %s, %d of %d samples -> %s' % (level, scenario, meta['initRaster'],
                                                                      len(tops), len(samples), out))
    return len(tops) > 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='e', help='e = immortal, fires; f = mortal; g = immortal, never fires; h = items and the end one hit away')
    ap.add_argument('--all', action='store_true', help='levels 1-8, scenarios e, f and g')
    ap.add_argument('--levels', help='with --all: only these levels, e.g. 1,5,8')
    ap.add_argument('--frames', type=int, default=9000)
    ap.add_argument('--fine', type=int, default=600, help='every frame up to here')
    ap.add_argument('--coarse', type=int, default=3, help='then every Nth frame')
    ap.add_argument('--seed', type=int, help='script seed (default: level*16 + scenario + 8)')
    ap.add_argument('--out', help='directory (default build/enemies/l<level><scenario>)')
    ap.add_argument('--timing', action='store_true', help='only the timing of the column shifts of an existing recording (timing.json)')
    a = ap.parse_args()
    only = [int(x) for x in a.levels.split(',')] if a.levels else range(1, 9)
    runs = [(level, sc) for level in only for sc in 'efg'] if a.all else [(a.level, a.scenario)]
    ok = True
    for level, sc in runs:
        seed = a.seed if a.seed is not None else level*16 + ord(sc)-ord('a') + 8
        out = a.out or os.path.join(PROJECT, 'build', 'enemies', 'l%d%s' % (level, sc))
        frames = a.frames if sc != 'f' else min(a.frames, 3000)
        if sc == 'h' and a.frames == 9000:
            frames = 12000
        if a.timing:
            meta = json.load(open(os.path.join(out, 'meta.json')))
            ok &= timing(level, sc, meta['frames'], meta['seed'], out)
            continue
        ok &= record(level, sc, frames, a.fine, a.coarse, seed, out, immortal=(sc != 'f'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
