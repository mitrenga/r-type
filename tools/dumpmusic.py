#!/usr/bin/env python3
"""dumpmusic — the SID player's memory of every level's `M` into data/music.json.

★ The music and the effects of R-Type live in the level file **`M`**
(`$6370`-`$7ABF`, `sources/docs/disasm_notes.md` §14): five entry points
(`$6370` step, `$6373` silence, `$6376` effect, `$6379` tune, `$637C`
tables), the player's variables `$637F`-`$6475`, the player's code
`$6476`-`$6D3F` with its two tables (the note frequencies `$6C72`/`$6CD2`,
the waveforms of the commands `$E9`-`$F3` at `$6D31`), and from **`$6D40`**
the song: a table of 22 relative pointers (`$0896`: `LDX #$40 ; LDY #$6D ;
JSR $637C`) to the order lists, transposes, instrument and table offsets of
the three voices, the tune table, the tracks, the instruments and the
wave/arpeggio programs. **The code is the same in all eight levels; the
song differs from `$6D42`** (measured on the tape images).

The remake's `app/sidPlayer.js` is that code with its variables **at the
addresses the original keeps them** (a flat `ram`, as `app/ship.js` keeps
the ship's), so the bytes go in as the tape holds them — the variables'
start values too (`$63BF`/`$63C1` = `$FF`: no tune and no effect requested,
`$63C6`-`$63C8` the voices' register offsets 0/7/14, `$63F9`/`$63FA` = 2) —
and `tools/matchsound.mjs` compares the same range with the running
original. The level's `M` is loaded whole from the tape at every level
(`$0A9C`), so the player starts every level from these bytes.

    tools/dumpmusic.py       # -> data/music.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

CODE = (0x6370, 0x6D40)        # the entry points, the variables and the code with its tables
VARS = (0x637F, 0x6476)
SONG = (0x6D40, 0x7AC0)        # the song: the pointer table and what it points to (to the boss tables of enemies.json)
REGION = (0x637F, 0x7AC0)      # what goes into ram
TABLE_ARG = 0x6D40             # ★ `$0896`: X/Y of `JSR $637C`
TITLE_SHIFT = 0x490            # ★ the title's player at $6800 (side A core): the level player moved by this
TITLE_TABLE = 0x71D0           # ★ `$8015`: X/Y of `JSR $680C` — the title song's pointer table
CORE_M = 0x6800                # where side A's core M loads
# ★ the player's variables, for the reader (§14)
VARIABLES = {
    '$637F': 'volume nibble ORed into SIGVOL ($0F)',
    '$6380': 'position in the order lists (the sequence step)',
    '$6381': 'temporary of the tune start',
    '$6382': 'loop position of the tune', '$6383': 'end position of the tune',
    '$6384': 'length of an effect in sequence steps', '$6385': 'steps played since the loop test',
    '$6386': 'playing (1) — 0 is silence',
    '$6388-$63B3': '22 absolute pointers built by $637C from the relative table at $6D40',
    '$63B4': 'the pointer table was built ($2C) — tracks carry durations', '$63B5': 'voices left to read a new row',
    '$63B6-$63B8': 'wave program: ticks to wait', '$63B9-$63BB': 'temporaries',
    '$63BC': 'end of a track seen ($FF) — the sequence steps on',
    '$63BF': 'tune requested by $6379 ($FF none)', '$63C0': 'X of $6379 (never read)',
    '$63C1': 'effect requested by $6376 ($FF none)', '$63C2': 'voice of the effect (X of $6376, always 2)',
    '$63C3': 'temporary', '$63C4': 'the voice being stepped', '$63C5': 'the voice whose gate is set',
    '$63C6-$63C8': 'register offsets of the voices (0, 7, 14)',
    '$63C9-$63CB': 'effect countdown by voice (sequence steps left)', '$63CC-$63CE': 'track carries durations',
    '$63CF-$63D1': 'rows left in the current note', '$63D2-$63D7': 'track pointer by voice (lo, hi)',
    '$63D8-$63DA': 'track number by voice ($FE silenced, $FF idle; bit 7 = gate every other row)',
    '$63DB-$63DD': 'alternation of the two voices sharing a row', '$63DE-$63E0': 'transpose by voice',
    '$63E1-$63E3': 'instrument offset by voice', '$63E4-$63E6': 'table offset by voice',
    '$63E7-$63EC': 'frequency of the note by voice (lo, hi)', '$63ED-$63EF': 'note by voice',
    '$63F0-$63F2': 'note byte of the row (bit 7 = no gate)', '$63F3-$63F5': 'wave program: 1 start, 0 running, $E6 stopped',
    '$63F6-$63F8': 'wave program position', '$63F9': 'ticks to the next row', '$63FA': 'speed (ticks a row)',
    '$63FB': 'RESON ($D417) of the instrument', '$63FC': 'filter mode and volume nibble ($D418) of the instrument',
    '$63FD-$6402': 'vibrato/slide offset by voice (lo, hi)', '$6403-$6408': 'wave program pointer by voice',
    '$6409-$640B': 'wave program index by voice', '$640C-$640E': 'note of the wave program by voice',
    '$640F-$6411': 'waveform by voice', '$6412-$6417': 'ATDCY, SUREL by voice', '$6418-$641D': 'pulse width by voice (lo, hi)',
    '$641E-$6423': 'pulse sweep step by voice (lo, hi)', '$6424-$6427': 'the four flag bits of the tune ($649B)',
    '$6428-$642A': 'gate off at the end of the note by voice', '$642B-$642D': 'instrument by voice ($E6 none)',
    '$642E-$6431': 'temporaries of a new row', '$6432-$6437': 'pulse sweep tick and reload by voice',
    '$6438-$643A': 'pitch offset of the instrument by voice', '$643B-$6440': 'slide step by voice (lo, hi)',
    '$6441-$6446': 'slide tick and reload by voice', '$6447-$644C': 'slide frequency by voice (lo, hi)',
    '$644D-$644F': 'slide/portamento on by voice', '$6450-$6452': 'portamento to a note by voice',
    '$6453/$6454': 'portamento step', '$6455-$6457': 'pulse sweep limit by voice',
    '$6458-$645A': 'vibrato delay by voice', '$645B-$6460': 'vibrato up and down counts by voice',
    '$6461-$6463': 'vibrato step by voice', '$6464-$6466': 'vibrato step increment by voice',
    '$6467-$6469': 'vibrato length by voice', '$646A-$646C': 'half of the vibrato length by voice',
    '$646D': 'CUTHI ($D416)', '$6470': 'filter sweep up ticks', '$6473': 'filter sweep down ticks',
}
POINTERS = ['order list voice 1', 'order list voice 2', 'order list voice 3',
            'transposes voice 1', 'transposes voice 2', 'transposes voice 3',
            'instrument offsets voice 1', 'instrument offsets voice 2', 'instrument offsets voice 3',
            'table offsets voice 1', 'table offsets voice 2', 'table offsets voice 3',
            'tune table (start +$00, loop +$20, end +$40, flags +$60, speed +$80, effect length +$A0, +$C0)',
            'track pointers (a word each)', 'instrument pointers (a word each)', 'wave program pointers (a word each)',
            'unused', 'unused', 'unused', 'unused', 'unused', 'track duration flags']
TUNES = {0: 'boss ($57AC, the level hooks)', 1: 'game over ($5E55; two players $0A01)', 2: 'the level-end sequence ($0A2E)',
         3: 'the level ($08A4; back from the boss after a death $32C5)'}


def tune_table(m, table=TABLE_ARG):
    """The tune table of a level as the player reads it (`$649B`)."""
    base = table + rtlib.word(m, table + 2*12)
    out = {}
    for t, what in TUNES.items():
        out[t] = dict(what=what, start=m[base + t], loop=m[base + 0x20 + t], end=m[base + 0x40 + t],
                      flags=m[base + 0x60 + t], speed=m[base + 0x80 + t], effectLength=m[base + 0xA0 + t], c0=m[base + 0xC0 + t])
    return '$%04X' % base, out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'music.json'))
    a = ap.parse_args()
    core = rtlib.core_files()
    m1 = rtlib.image(1, core=core)
    out = dict(
        source='R-Type, Electric Dreams tape (file M of each level); tools/dumpmusic.py',
        note='the SID player\'s memory at the original\'s addresses: variables $637F-$6475, code $6476-$6D3F (the same in every level; '
             'frequency tables $6C72/$6CD2, command waveforms $6D31) and the song from $6D40 (a table of 22 relative pointers, '
             '$637C makes them absolute at $6388); app/sidPlayer.js keeps its variables in it, tools/matchsound.mjs compares it',
        region='$%04X-$%04X' % (REGION[0], REGION[1]-1), code='$%04X-$%04X' % (CODE[0], CODE[1]-1),
        variables=VARIABLES, pointers=POINTERS, tableArg='$%04X' % TABLE_ARG,
        sidSites=['$647D', '$6480', '$6483', '$648A', '$65DB', '$65E6', '$65EC', '$65F5', '$6955', '$695B', '$6961', '$6967',
                  '$696D', '$6981', '$698A', '$6993', '$6999', '$69A6', '$69AF', '$5E69'],
        levels=[])
    # ★ the title screen's player ($8000 of side A's core, disasm_notes.md §1) is the level player relocated by
    # $490 ($6800 = $6370: every absolute word of the code moved, nothing else differs — checked word by word)
    # with its own song: `$8015` LDX #$D0 LDY #$71 JSR $680C (= $637C with the table at $71D0), `LDA #2 JSR $6809`
    # (= $6379: tune 2), stepped by the raster interrupt until F1. The song stays **at its own addresses**: its
    # order lists hold absolute pointers to the tracks ($63A2 of the player), so it cannot be moved; the player's
    # code and tables are level 1's (the same bytes), and SidPlayer gets the table $71D0 (ABOUT, app/gameWorker.js)
    tbase, ttunes = tune_table(rtlib.image(core=core), TITLE_TABLE)
    out['title'] = dict(addr='$%04X-$7FFF' % TITLE_TABLE, player='$6800 = $6370 + $%03X: the level player relocated; its code and tables are level 1\'s' % TITLE_SHIFT,
                        table='$%04X' % TITLE_TABLE, tune=2, tuneTable=tbase, tunes=ttunes,
                        bytes=list(core['M'][TITLE_TABLE-CORE_M:0x8000-CORE_M]))
    print('title: song $%04X-$7FFF at its own addresses, table $%04X, tune 2, tunes %s' % (TITLE_TABLE, TITLE_TABLE, ' '.join('%d:%d..%d/%d sp%d' % (t, v['start'], v['loop'], v['end'], v['speed']) for t, v in ttunes.items())))
    for n in range(1, 9):
        m = rtlib.image(n, core=core)
        files = rtlib.level_files(n)
        same_code = bytes(m[CODE[0]:CODE[1]]) == bytes(m1[CODE[0]:CODE[1]])
        first_diff = next((x for x in range(SONG[0], SONG[1]) if m[x] != m1[x]), None)
        base, tunes = tune_table(m)
        out['levels'].append(dict(
            level=n, addr='$%04X-$%04X' % (REGION[0], REGION[1]-1), fileEnd='$%04X' % (0x6370 + len(files['M'])),
            codeSameAsLevel1=same_code, songDiffersFrom=('$%04X' % first_diff) if first_diff is not None else None,
            tuneTable=base, tunes=tunes, bytes=list(m[REGION[0]:REGION[1]])))
        print('level %d: M to $%04X, code same as level 1: %s, song differs from %s; tunes %s'
              % (n, 0x6370 + len(files['M']), same_code, ('$%04X' % first_diff) if first_diff is not None else '-',
                 ' '.join('%d:%d..%d/%d sp%d' % (t, v['start'], v['loop'], v['end'], v['speed']) for t, v in tunes.items())))
    rtlib.save_json(out, a.o, drop=('region', 'variables', 'tableArg', 'sidSites', 'fileEnd', 'tuneTable', 'songDiffersFrom', 'player'), indent=None, separators=(',', ':'), ensure_ascii=False)   # without the notes (rtlib.strip_notes)
    print('8 levels, $%04X-$%04X each -> %s (%d KB)' % (REGION[0], REGION[1]-1, a.o, os.path.getsize(a.o)//1024))


if __name__ == '__main__':
    main()
