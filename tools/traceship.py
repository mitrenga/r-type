#!/usr/bin/env python3
"""traceship — the original flying the ship, frame by frame, with scripted input.

For `matchship.mjs` (M3). The original boots straight into level N
(`rtboot.boot(level=N)`), the wave spawner is off (`$4FA8` = `RTS`, as in
M2 — no enemies, M4 lifts it), and three **hooks** in free RAM at `$6000`
stand in for the hardware the ship reads:

- **`$2824 LDA $DC00`** (the joystick, once a frame from `$2821`) becomes
  `JSR hookJoy`: the byte comes from a **script** of segments `(input,
  frames)` at `$6040` — bits 0-4 as the port gives them (active low), bit 5
  the space bar — and the hook counts the frames it served (`$6002/$6003`);
- **`$2A2A` / `$2AB0 LDA $DC01`** (the space bar for the Force) become
  `JSR hookSpace`: bit 4 clear while the segment says space;
- **the 16 `LDA $DC04`** of the core (CIA 1 timer A, the game's only
  entropy, `hw_notes.md`) become `JSR rnd`: a 16-bit LFSR (taps `$B400`,
  seeded from `$6004/$6005`) — the same generator the remake runs where the
  original reads the timer, so no value has to be logged.

★ The hooks preserve X, Y **and C** and leave N/Z as the loads did
(`disasm_notes.md` §11, §12: the enemy code adds with the carry of a
compare made before the read — a load leaves C alone, so must the hook). `$5FBC`-`$61FF` is zero on the tape and no instruction of the core
reads or writes it; the trace checks it is unchanged at the end.

**Items** (`--items`): the crystals, bits, speed and missiles are sprites of
the enemy machinery (a carrier turned into an item by `$1B01`), which the
spawner would launch. With it off, the harness **pokes items into sprite
slots** right at the init (`$044C,X` = 1, pointer `$AF,X`, colour `$BE,X`,
position) on top of the ship, so the first enemy loop (`$17FB`, raster 48)
picks them up through the original's own pickup code (`$1B61`) — which is how
the Force, the three lasers, the bits, the speed and the missiles get into a
run that has no enemies. What was poked is in `meta.json`.

Sampling: every stop at **`$0DBA`** (the tail of the raster-48 handler, before
the scroll step — M2's point: the previous frame is complete there). Hit *h*
sees *h* − 1 frames after the init; the init itself is the RAM at the first
`$08C1`. Every frame up to `--fine`, every `--coarse`th after that.

    tools/traceship.py --level 1 --scenario b           # -> build/ship/l1b/
    tools/traceship.py --all
"""
import argparse, json, os, random, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from rtboot import boot  # noqa: E402
import rtlib  # noqa: E402

MAIN_LOOP = 0x08C1
TOP = 0x0DBA
COLLISION, SPAWNER = 0x319C, 0x4FA8
STOP = re.compile(r'#\d+ \(Stop on\s+exec ([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/')

# --- the hooks ---------------------------------------------------------
HOOK_BASE = 0x6000
SEG_IDX, REMAIN, FRAMES, SEED, TMP = 0x6000, 0x6001, 0x6002, 0x6004, 0x6006
HOOK_JOY, HOOK_SPACE, HOOK_RND = 0x6010, 0x6050, 0x6070
TABLE = 0x6090                  # (input, frames) pairs up to $61FF
TABLE_END = 0x6200
JOY_READ = 0x2824
SPACE_READS = (0x2A2A, 0x2AB0)
# ★ scanned in the core of the tape: every `LDA $DC04` ($AD $04 $DC) in $0812-$5FBB
ENTROPY_READS = [0x24B7, 0x250F, 0x2521, 0x2B60, 0x2B68, 0x2B77, 0x2B7F, 0x4FED,
                 0x5085, 0x5286, 0x5290, 0x5299, 0x54C7, 0x54D1, 0x54DA, 0x5E09]


def hook_code():
    """The three hooks, hand-assembled (offsets checked in `tests` below);
    returns {addr: bytes}. All three keep X and Y."""
    lo, hi = lambda a: a & 0xFF, lambda a: a >> 8
    J = HOOK_JOY
    joy = bytearray()
    joy += bytes([0x8A, 0x48])                                # 00 TXA ; PHA
    joy += bytes([0xEE, lo(FRAMES), hi(FRAMES)])              # 02 INC frames
    joy += bytes([0xD0, 0x03])                                # 05 BNE 0A
    joy += bytes([0xEE, lo(FRAMES+1), hi(FRAMES+1)])          # 07 INC frames+1
    joy += bytes([0xAE, lo(SEG_IDX), hi(SEG_IDX)])            # 0A LDX segIdx
    joy += bytes([0xBD, lo(TABLE), hi(TABLE)])                # 0D LDA table,X
    joy += bytes([0x8D, lo(TMP), hi(TMP)])                    # 10 STA tmp
    joy += bytes([0xCE, lo(REMAIN), hi(REMAIN)])              # 13 DEC remain
    joy += bytes([0xD0, 0x15])                                # 16 BNE done (2D)
    joy += bytes([0xBD, lo(TABLE+3), hi(TABLE+3)])            # 18 LDA table+3,X — the next length
    joy += bytes([0xF0, 0x0B])                                # 1B BEQ stay (28): the table ends
    joy += bytes([0x8D, lo(REMAIN), hi(REMAIN)])              # 1D STA remain
    joy += bytes([0xE8, 0xE8])                                # 20 INX ; INX
    joy += bytes([0x8E, lo(SEG_IDX), hi(SEG_IDX)])            # 22 STX segIdx
    joy += bytes([0x4C, lo(J+0x2D), hi(J+0x2D)])              # 25 JMP done
    joy += bytes([0xA9, 0x01])                                # 28 stay: LDA #1
    joy += bytes([0x8D, lo(REMAIN), hi(REMAIN)])              # 2A STA remain
    joy += bytes([0x68, 0xAA])                                # 2D done: PLA ; TAX
    joy += bytes([0xAD, lo(TMP), hi(TMP)])                    # 2F LDA tmp
    joy += bytes([0x29, 0x1F, 0x09, 0x60, 0x60])              # 32 AND #$1F ; ORA #$60 ; RTS
    assert len(joy) == 0x37
    space = bytes([
        0x8A, 0x48,                                           # TXA ; PHA
        0xAE, lo(SEG_IDX), hi(SEG_IDX),                       # LDX segIdx
        0xBD, lo(TABLE), hi(TABLE),                           # LDA table,X
        0x8D, lo(TMP), hi(TMP),                               # STA tmp
        0x68, 0xAA,                                           # PLA ; TAX
        0xAD, lo(TMP), hi(TMP),                               # LDA tmp
        0x29, 0x20, 0x4A, 0x49, 0xFF, 0x60,                   # AND #$20 ; LSR ; EOR #$FF ; RTS
    ])
    # ★ a `LDA $DC04` leaves C alone and the code after it counts on that
    # (`$24B7 AND #$7F; ADC #$28` takes the carry of a CMP before the read —
    # M4): the shift of the generator must not show in C, so the flags are
    # kept around it and N/Z come from the final LDA
    rnd = bytes([
        0x08,                                                 # PHP
        0xAD, lo(SEED+1), hi(SEED+1),                         # LDA s1
        0x4A,                                                 # LSR A
        0x6E, lo(SEED), hi(SEED),                             # ROR s0
        0x90, 0x02,                                           # BCC +2
        0x49, 0xB4,                                           # EOR #$B4
        0x8D, lo(SEED+1), hi(SEED+1),                         # STA s1
        0x28,                                                 # PLP
        0xAD, lo(SEED), hi(SEED),                             # LDA s0
        0x60,                                                 # RTS
    ])
    assert len(rnd) == 20
    assert HOOK_JOY + len(joy) <= HOOK_SPACE and HOOK_SPACE + len(space) <= HOOK_RND
    assert HOOK_RND + len(rnd) <= TABLE
    return {HOOK_JOY: bytes(joy), HOOK_SPACE: space, HOOK_RND: rnd}


# --- the script ----------------------------------------------------------
UP, DOWN, LEFT, RIGHT, FIRE, SPACE = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20
DIRS = [0, UP, DOWN, LEFT, RIGHT, UP | LEFT, UP | RIGHT, DOWN | LEFT, DOWN | RIGHT]


def make_script(seed, frames, calm=False):
    """Segments (bits, frames): bits are the *pressed* buttons (joystick bits
    0-4, space bit 5); the hook inverts them for the port. A seeded random
    walk with taps and holds of fire and taps of space; `calm` keeps the
    ship near the middle for a long immortal flight."""
    rng = random.Random(seed)
    segs = [(0, 12)]
    total = 12
    while total < frames:
        r = rng.random()
        if r < 0.50:
            bits = rng.choice(DIRS) if not calm else rng.choice([0, 0, UP, DOWN, LEFT, RIGHT, UP, DOWN])
            n = rng.randint(3, 24)
        elif r < 0.75:
            bits = rng.choice(DIRS) | FIRE          # a tap or a short burst
            n = rng.randint(1, 4)
        elif r < 0.88:
            bits = rng.choice([0, UP, DOWN]) | FIRE  # hold: the beam charges
            n = rng.randint(30, 160)
        elif r < 0.95:
            bits = SPACE | rng.choice([0, 0, LEFT, RIGHT])
            n = rng.randint(1, 3)
        else:
            bits = 0
            n = rng.randint(8, 40)
        n = min(n, 255)
        segs.append((bits, n))
        total += n
    segs.append((0, 255))                          # the tail: idle, and the table ends with (x, 0)
    assert 2*(len(segs)+1) <= TABLE_END-TABLE, 'script too long for $6090-$61FF'
    return segs


def script_bytes(segs):
    out = bytearray()
    for bits, n in segs:
        # the port is active low: pressed bits cleared; space is bit 5 set when pressed
        joy = (~bits) & 0x1F
        out += bytes([joy | (bits & SPACE), n])
    out += bytes([0x1F, 0])
    return bytes(out)


# --- items ---------------------------------------------------------------
# ★ $1B4F: the item sprites, $1B49: their colours (`disasm_notes.md` §11)
ITEM = dict(crystal=0x5B, bit=0x4A, speed=0x5C, missiles=0x5D)
ITEM_COLOR = dict(bit=0x0E, speed=0x08, missiles=0x08)
LASER_COLORS = {'blue': 6, 'yellow': 7, 'red': 2}


def items_of(scenario, level):
    """What a scenario pokes: slot, pointer, colour. The slots are served from
    14 down to 0 by `$17FB`, so slot 0's crystal is picked last and its
    colour decides the laser (`$1BE6`)."""
    colours = ['blue', 'yellow', 'red']
    if scenario == 'a':
        return []
    first = colours[(level-1) % 3] if scenario == 'b' else colours[level % 3]
    others = [c for c in colours if c != first]
    out = [dict(slot=0, kind='crystal', colour=first), dict(slot=1, kind='crystal', colour=others[0]),
           dict(slot=2, kind='crystal', colour=others[1]),
           dict(slot=3, kind='bit'), dict(slot=4, kind='bit'),
           dict(slot=5, kind='speed'), dict(slot=6, kind='speed'), dict(slot=7, kind='missiles')]
    for it in out:
        it['pointer'] = ITEM[it['kind']]
        it['color'] = LASER_COLORS[it['colour']] if it['kind'] == 'crystal' else ITEM_COLOR[it['kind']]
    return out


def record(level, scenario, frames, fine, coarse, seed, out, immortal, no_waves=True):
    os.makedirs(out, exist_ok=True)
    e = boot(level=level)
    if immortal:
        e.cmd('> %04x 60' % COLLISION)
    if no_waves:
        e.cmd('> %04x 60' % SPAWNER)
    # the hooks, the script and the generator's seed
    for addr, code in hook_code().items():
        poke(e, addr, code)
    segs = make_script(seed, frames, calm=(scenario != 'c'))
    table = script_bytes(segs)
    poke(e, TABLE, table)
    rseed = (seed*0x9E37 + 0x1D87) & 0xFFFF or 1
    poke(e, SEG_IDX, bytes([0, segs[0][1], 0, 0, rseed & 0xFF, rseed >> 8]))
    for a in (JOY_READ,):
        poke(e, a, bytes([0x20, HOOK_JOY & 0xFF, HOOK_JOY >> 8]))
    for a in SPACE_READS:
        poke(e, a, bytes([0x20, HOOK_SPACE & 0xFF, HOOK_SPACE >> 8]))
    for a in ENTROPY_READS:
        poke(e, a, bytes([0x20, HOOK_RND & 0xFF, HOOK_RND >> 8]))
    # the init: the first $08C1 — then the items, then the dump
    e.brk(MAIN_LOOP).go()
    items = items_of(scenario, level)
    for it in items:
        s = it['slot']
        # ★ the pickup test ($18E4): item Y in (shipY-3, shipY+25], item X within ±16 px of the ship
        it['x'], it['y'] = 0x3F, 0x72+10
        e.cmd('> %04x 01' % (0x044C+s))
        e.cmd('> %02x %02x' % (0xAF+s, it['pointer']))
        e.cmd('> %02x %02x' % (0xBE+s, it['color']))
        e.cmd('> %02x %02x' % (0x82+s, it['x']))
        e.cmd('> %02x 00' % (0x91+s))
        e.cmd('> %02x %02x' % (0xA0+s, it['y']))
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
        e.bsave(p+'hook.bin', 0x6000, 0x600F, bank='ram')
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
                immortal=immortal, noWaves=no_waves, items=items,
                hooks=dict(joy='$%04X' % HOOK_JOY, space='$%04X' % HOOK_SPACE, rnd='$%04X' % HOOK_RND,
                           table='$%04X' % TABLE, vars='$%04X' % SEG_IDX,
                           patched=dict(joystick=['$%04X' % JOY_READ], space=['$%04X' % a for a in SPACE_READS],
                                        entropy=['$%04X' % a for a in ENTROPY_READS])),
                initRaster=int(init[1]) if init else None, initCycle=int(init[2]) if init else None,
                note='init = RAM at the first $08C1 (items poked just before the dump); a sample at $0DBA '
                     'named fNNNNN is hit NNNNN of the checkpoint since the init and sees NNNNN-1 frames; '
                     'patches: $4FA8 = RTS' + (', $319C = RTS' if immortal else '')
                     + '; $2824/$2A2A/$2AB0/$DC04 reads -> hooks at $6000')
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    json.dump(dict(seed=seed, segments=[list(s) for s in segs]), open(os.path.join(out, 'script.json'), 'w'))
    print('level %d%s: init at raster %s, %d of %d samples -> %s' % (level, scenario, meta['initRaster'],
                                                                      len(tops), len(samples), out))
    return len(tops) > 0


def poke(e, addr, data):
    for i in range(0, len(data), 16):
        chunk = data[i:i+16]
        e.cmd('> %04x %s' % (addr+i, ' '.join('%02x' % b for b in chunk)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='b', help='a = ship only, immortal; b = items, immortal; c = items, mortal')
    ap.add_argument('--all', action='store_true', help='levels 1-8, scenarios b and c (and a for level 1)')
    ap.add_argument('--frames', type=int, default=1500)
    ap.add_argument('--fine', type=int, default=300, help='every frame up to here')
    ap.add_argument('--coarse', type=int, default=5, help='then every Nth frame')
    ap.add_argument('--seed', type=int, help='script seed (default: level*16 + scenario)')
    ap.add_argument('--out', help='directory (default build/ship/l<level><scenario>)')
    a = ap.parse_args()
    runs = []
    if a.all:
        for level in range(1, 9):
            for sc in (['a', 'b', 'c'] if level == 1 else ['b', 'c']):
                runs.append((level, sc))
    else:
        runs.append((a.level, a.scenario))
    ok = True
    for level, sc in runs:
        seed = a.seed if a.seed is not None else level*16 + ord(sc)-ord('a')
        out = a.out or os.path.join(PROJECT, 'build', 'ship', 'l%d%s' % (level, sc))
        ok &= record(level, sc, a.frames, a.fine, a.coarse, seed, out, immortal=(sc != 'c'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
