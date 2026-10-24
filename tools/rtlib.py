#!/usr/bin/env python3
"""rtlib — the R-Type tape: the Rainbow Arts turbo, block by block.

★ Read from the loader itself (`BOOT`, the only KERNAL file on side 1,
relocated by its BASIC stub to `$6200`-`$63FF`; `sources/docs/disasm_notes.md`
§0). A bit is one pulse measured against CIA 2 timer B loaded with **$0107
cycles** (`$62DD`, `$6320`): a longer pulse underflows the timer and is a 1.
Bits go most significant first (`ROL $BD`). A block starts with a pilot of
`$02` bytes, found bit by bit, then the countdown `$09`..`$01` (`$62D3`).

★ The sync routine reads **one byte past `$01`** (`$62FC`) and leaves it in A:
for a header it is the type, for a data block it is thrown away.

Two kinds of block follow the sync:
- **header** (`$6282`): a non-zero type byte (1 or 2) and 192 bytes into the
  tape buffer `$033C` — start, end, filename from `$0341`;
- **data** (`$6297`): `end - start` bytes and one XOR checksum byte. The
  loader stores them at **`$C3/$C4`, not at the header's start** — the caller
  chooses where the file goes.

    from rtlib import turbo_blocks, turbo_files
    for f in turbo_files('sources/tape/rtype_side1.tap'): ...
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'svision', 'tools', 'retro', 'c64'))
from c64tape import pulses  # noqa: E402

THRESHOLD = 0x0107        # ★ cycles, CIA 2 timer B ($DD06/$DD07)
PILOT = 0x02


def bits(p):
    """Turbo bits; a KERNAL pulse (much longer) counts as None — it breaks a block."""
    return [None if w > 0x50*8 else (1 if w > THRESHOLD else 0) for w in p]


def turbo_blocks(p):
    """Every synced block: (bit index after the countdown, reader) where
    reader(n) returns the next n bytes."""
    b = bits(p)
    out, i, n = [], 0, len(b)
    while i < n - 8:
        # bit-sync: shift until the register holds the pilot byte
        reg, j = 0, i
        while j < n and b[j] is not None:
            reg = ((reg << 1) | b[j]) & 0xff
            j += 1
            if reg == PILOT:
                break
        else:
            i = j + 1
            continue
        if reg != PILOT:
            i = j + 1; continue
        # byte-sync: skip pilot bytes, then expect $09..$01
        def byte(k):
            if k + 8 > n or None in b[k:k+8]: return None, k
            v = 0
            for x in b[k:k+8]: v = (v << 1) | x
            return v, k + 8
        v, k = byte(j)
        while v == PILOT:
            v, k = byte(k)
        ok, want = True, 9
        while want:
            if v != want: ok = False; break
            want -= 1
            if want: v, k = byte(k)
        if not ok:
            i = j; continue
        out.append(k)
        # go on right after the countdown: a pilot of `$02` bytes has no long
        # run of zeros to wait for, and the caller knows the block length
        i = k
    return b, out


def read_bytes(b, k, count):
    out = []
    for _ in range(count):
        v = 0
        for x in b[k:k+8]:
            if x is None: return bytes(out), k
            v = (v << 1) | x
        out.append(v); k += 8
    return bytes(out), k


def turbo_files(path):
    """Header + data pairs. Each file: type, start, end, name, data, checksum ok."""
    b, starts = turbo_blocks(pulses(path))
    files, hdr = [], None
    for k in starts:
        if hdr is None:
            # header: skip zero bytes, then the type byte, then 192 bytes
            t, k2 = read_bytes(b, k, 1)
            while t and t[0] == 0:
                t, k2 = read_bytes(b, k2, 1)
            if not t or t[0] not in (1, 2):
                continue
            body, _ = read_bytes(b, k2, 192)
            start = body[0] | body[1] << 8
            end = body[2] | body[3] << 8
            name = bytes(body[5:21]).rstrip(b' \x00').decode('latin-1')
            hdr = dict(type=t[0], start=start, end=end, name=name, header=body, bit=k)
        else:
            data, k2 = read_bytes(b, k + 8, hdr['end'] - hdr['start'])  # past the byte the sync ate
            ck, _ = read_bytes(b, k2, 1)
            x = 0
            for v in data: x ^= v
            hdr.update(data=data, ok=bool(ck) and ck[0] == x and len(data) == hdr['end'] - hdr['start'])
            files.append(hdr); hdr = None
    return files


def write_tap(path, p):
    """A `.tap` version 1 from pulse widths in cycles (the inverse of
    `c64tape.pulses`): a byte is cycles/8, an overflow is a zero and 24 bits."""
    out = bytearray()
    for w in p:
        if 0 < w // 8 < 256:
            out.append(w // 8)
        else:
            out.append(0); out += int(w).to_bytes(3, 'little')
    with open(path, 'wb') as f:
        f.write(b'C64-TAPE-RAW' + bytes([1, 0, 0, 0]) + len(out).to_bytes(4, 'little') + out)


def level_tape(side_b, level, out, lead=2000):
    """Side B cut so that it starts in the pilot of level `level`'s `M` header:
    ★ the turbo loads whatever file comes next (`$6236`, any name), so a tape
    that begins at level N's files makes the game load level N as if it
    were the first. The game's own level number (`$0200`) is not on the
    tape — whoever uses this pokes it (`rtboot.boot(level=N)`)."""
    p = pulses(side_b)
    files = turbo_files(side_b)
    hdr = files[(level - 1)*3]
    assert hdr['name'] == 'M%d' % level, hdr['name']
    start = max(0, hdr['bit'] - lead)       # inside the pilot of the header block
    write_tap(out, p[start:])
    return out


# ---------------------------------------------------------------- the image
# ★ Where the loader puts the files and what the program copies before a
# level is in (`sources/docs/disasm_notes.md` §0, §7): side A is `G` (the
# core) at `$0812` and `M` at `$6800`; `levelStart` (`$0815` -> `$1794`)
# then moves what it needs out of that `M` — the sprites of the ship and
# its weapons to `$D000` (under the I/O), the panel to the screen, the
# shared glyphs `$C0`-`$FF` to `$C600` and the panel's character set to
# `$C800` — before the level's `M` (`$6370`), `G` (`$86AC`) and `S`
# (`$E000`) overwrite it.
CORE_G, CORE_M = 0x0812, 0x6800
LEVEL_M, LEVEL_G, LEVEL_S = 0x6370, 0x86AC, 0xE000
SIDE_A = os.path.join(HERE, '..', 'sources', 'tape', 'rtype_side1.tap')
SIDE_B = os.path.join(HERE, '..', 'sources', 'tape', 'rtype_side2.tap')
# (source, destination, length, who) — the copies of $1794
LEVEL_START_COPIES = [
    (0x8E53, 0xD000, 0x1000, '$1794: sprites of the ship and its weapons, under the I/O'),
    (0x8B73, 0xCF08, 0x00E0, '$17BF: the panel into the screen RAM (rows 19-24 from column 8)'),
    (0x8C53, 0xC600, 0x0200, '$17D3: glyphs $C0-$FF shared by every level'),
    (0x9D53, 0xC800, 0x0400, '$17D3: the character set of the panel'),
]


def core_files():
    """The files of side A by name: BOOT, P, M, G."""
    return {f['name']: f['data'] for f in turbo_files(SIDE_A)}


def level_files(level):
    """`M`, `G`, `S` of level 1-8 from side B."""
    files = turbo_files(SIDE_B)
    out = {}
    for f in files[(level - 1)*3:(level - 1)*3 + 3]:
        assert f['name'] == '%s%d' % (f['name'][0], level) and f['ok'], f['name']
        out[f['name'][0]] = f['data']
    return out


def image(level=None, core=None, side_b=None):
    """64 KB as the loader leaves it: the core, the copies of `$1794`, and
    (with `level`) the three files of that level on top. Everything else
    is zero — what the program writes at run time is not here, and
    `match*` must see it as a named difference."""
    core = core or core_files()
    m = bytearray(65536)
    m[CORE_G:CORE_G + len(core['G'])] = core['G']
    m[CORE_M:CORE_M + len(core['M'])] = core['M']
    for src, dst, n, _ in LEVEL_START_COPIES:
        m[dst:dst + n] = m[src:src + n]
    if level:
        lv = side_b or level_files(level)
        m[LEVEL_M:LEVEL_M + len(lv['M'])] = lv['M']
        m[LEVEL_G:LEVEL_G + len(lv['G'])] = lv['G']
        m[LEVEL_S:LEVEL_S + len(lv['S'])] = lv['S']
    return m


def strip_notes(out, drop=(), source=False):
    """Removes the annotations from a dump before it is written: the
    top-level `source` and `note` (unless `source` is kept — mkscreen.py's
    frames carry the level in it for matchcompose.mjs) and the keys in `drop`
    wherever they hold prose only (a string, a list of strings or a dict of
    them). Addresses the game reads (`addr`, `screen`, …) are not prose-only
    keys in `drop`, so they stay. The game loads the files into localStorage
    and reads none of the notes (operator 2026-10-25)."""
    def prose(v):
        if isinstance(v, str):
            return True
        if isinstance(v, list):
            return bool(v) and all(isinstance(x, str) for x in v)
        if isinstance(v, dict):
            return bool(v) and all(prose(x) for x in v.values())
        return False
    def walk(o, top):
        if isinstance(o, dict):
            for k in list(o):
                if (top and (k == 'note' or (k == 'source' and not source))) or (k in drop and prose(o[k])):
                    del o[k]
                else:
                    walk(o[k], False)
        elif isinstance(o, list):
            for v in o:
                walk(v, False)
    walk(out, True)
    return out


def save_json(out, path, drop=(), source=False, **kw):
    """json.dump of a dump without its annotations (`strip_notes`); the
    caller's `out` is left whole — the tools print their summary from it."""
    import copy, json
    json.dump(strip_notes(copy.deepcopy(out), drop, source), open(path, 'w'), **kw)


def word(m, a):
    return m[a] | m[a + 1] << 8


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('image')
    ap.add_argument('--save', metavar='DIR')
    a = ap.parse_args()
    for n, f in enumerate(turbo_files(a.image)):
        print('%2d type %d "%-16s" $%04X-$%04X %6d B  checksum %s  (bit %d)'
              % (n, f['type'], f['name'], f['start'], f['end'], len(f['data']),
                 'ok' if f['ok'] else 'BAD', f['bit']))
        if a.save:
            os.makedirs(a.save, exist_ok=True)
            open(os.path.join(a.save, '%02d_%04x.bin' % (n, f['start'])), 'wb').write(f['data'])


if __name__ == '__main__':
    main()
