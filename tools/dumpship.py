#!/usr/bin/env python3
"""dumpship — the tables and start values of the ship's code into data/ship.json.

★ Everything is read at its place in the core `G` of the tape
(`rtlib.image()`), and every region says which routine reads it
(`sources/docs/disasm_notes.md` §11). The remake's `app/ship.js` keeps the
game's variables **at the addresses the original keeps them** (a flat
`ram` array), so the regions here are copied in as they are — tables as
well as the values the variables have before the first frame — and
`tools/matchship.mjs` compares the same addresses with the running
original. Operands of self-modifying instructions are variables too and are
listed as such.

    tools/dumpship.py       # -> data/ship.json
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rtlib  # noqa: E402

# (addr, length, name, reader, what)
REGIONS = [
    # --- state the core carries between games (`$27E1` copies $27F1 -> $2805)
    (0x0B5D, 7, 'mainState', '$08C1, $0E75, $32B6', '$0B5D state of the main loop (0 game, 1/2 life lost), $0B5E music, $0B5F re-entry guard of $0DE6, $0B60/$0B61 counters of the level end, $0B62 temp, $0B63 READY countdown'),
    # --- the rules of the game (M5, `disasm_notes.md` §13)
    (0x0B64, 8, 'checkpoints', '$0902, $091F', 'by level: the low byte of the map pointer of the one checkpoint (page $9A); a death past it restarts there with the wave table of $7AD4'),
    (0x0C5B, 122, 'readyTexts', '$0B6C', 'the screen codes (set $C800) of the READY screen: $0C5B/$0C69 two rows of 14 (A = 0, a life lost), $0C77/$0C91 two rows of 26 (A = $80, GAME OVER), $0CAB/$0CBC two rows of 17 and $0CCD/$0CCF, $0CD1/$0CD3 the 1UP/2UP tails (A = 1, the start of a level)'),
    (0x5F0D, 84, 'tapeEndTexts', '$5E95, $5EEE', 'after GAME OVER: 18 at $CC33 (PLEASE REWIND TAPE), 12 at $CC86, $CCD6 (THEN PRESS / F1 TO START), two rows of 12 loaded and never stored ($5EB6-$5EBF: OR / F3 2 PLAYER), 18 at $CCFB (PRESS PLAY ON TAPE)'),
    (0x1190, 2, 'blink', '$116C, $319C', '$1190 0 = invulnerable and blinking, $80 = vulnerable; $1191 frames left ($78)'),
    (0x2805, 28, 'gameState', '$27E1, $26E5, $321A', '$2805-$2818 the two players\' saved ship state, $2819 player, $281A/$281B ?, $281C deaths, $281D/$281E lives, $281F ?, $2820 two players'),
    (0x27F1, 20, 'gameStateInit', '$27E1', 'copied to $2805 at the start of a game'),
    # --- the ship, the Force and the bits
    (0x2F72, 25, 'rowLo', '$2E9C, $2C08, $1953, $25D0', 'screen row addresses $CC00+40*row, low bytes'),
    (0x2F8B, 25, 'rowHi', '$2E9C, $2C08', 'high bytes'),
    (0x2FA4, 30, 'forceTables', '$2F05', 'by Force level $33 (0-4): $2FA4 sprite pointer, $2FA9 last animation pointer, $2FAE animation speed, $2FB3 X offset behind, $2FB8 X offset in front, $2FBD Y offset'),
    (0x2FC2, 25, 'forceVars', '$2F05, $2821, $2A12, $2B5B', '$2FC2-$2FC7 the level\'s six values, $2FC8 width and $2FCD height in characters by level, $2FD2/$2FD3 return direction X/Y, $2FD4 ship X high, $2FD5/$2FD6 colour cycle, $2FD7/$2FD8 drift counters, $2FD9/$2FDA drift'),
    (0x2FDB, 31, 'forceColors', '$2F4C', 'the colour cycle of sprite 0 ($D027)'),
    (0x3079, 4, 'bitsVars', '$2FFA, $1B61', '$3079 upper bit, $307A lower bit, $307B frame counter (6), $307C animation phase (0-7)'),
    (0x307D, 15, 'bitsAddr', '$3037', 'by tilt frame (0-4): $307D/$3087 address of the upper bit in the sprite, $3082/$3087 of the lower one'),
    (0x308C, 32, 'bitsFrames', '$301C', 'by phase (0-7): $308C/$3094 source of the upper bit, $309C/$30A4 of the lower one'),
    (0x30AC, 240, 'bitsShapes', '$305B, $306B', 'eight frames of 30 bytes: the bit drawn into the ship\'s sprite'),
    (0x305C, 2, 'bitsSrc1', '$305B operand', 'self-modified: source of the upper bit'),
    (0x305F, 2, 'bitsDst1', '$305E operand', 'self-modified: destination of the upper bit'),
    (0x306C, 2, 'bitsSrc2', '$306B operand', 'self-modified: source of the lower bit'),
    (0x306F, 2, 'bitsDst2', '$306E operand', 'self-modified: destination of the lower bit'),
    (0x32C8, 5, 'deathAnim', '$31EB, $31FC', '$32C8 frames left, $32C9 countdown, $32CA-$32CC colours of the explosion'),
    # --- panel: score, 1UP, sounds
    (0x3384, 33, 'score', '$32CD, $23B0, $1C26', '$3384 index, $3385-$338A increments per digit, $338B-$3390 digits of player 1, $3391-$3396 of player 2, $3397-$33A4 ?'),
    (0x33F1, 10, 'oneUp', '$33A5', '$33F1 counter (16), $33F2 phase, $33F3-$33F6 the glyphs of 1UP, $33F7-$33FA of 2UP'),
    (0x3413, 45, 'sounds', '$33FB', '$3413 priority counter, $3414-$3429 duration by sound, $342A-$343F priority by sound'),
    # --- shots, lasers, beam, missiles, explosions
    (0x3B99, 2, 'fireRoutine', '$3B98 operand', 'self-modified: the Force\'s fire routine ($17FA none, $42FA blue, $47A1 yellow, $4CB3 red)'),
    (0x3D73, 1, 'fireLast', '$3B74', 'the fire bit of the last frame'),
    (0x3ED5, 27, 'shots', '$3D97, $3BAE', 'four basic shots: $3ED5 state, $3ED9/$3EDD screen address, $3EE1 column, $3EE5 char under, $3EE9 colour under; $3EED ship column, $3EEE/$3EEF ship row address'),
    (0x3CEE, 16, 'forceShotTables', '$3C4F', 'two shots of the detached Force: $3CEE row offset, $3CF2 Y step, $3CF6/$3CFA char by direction'),
    (0x3D57, 29, 'forceShotTables4', '$3CA5', 'four shots of the level-4 Force: $3D57 column, $3D5B row offset, $3D5F Y step, $3D63/$3D67 X step, $3D6B/$3D6F char'),
    (0x40AA, 39, 'forceShots', '$3EF0', 'four shots of the Force: $40AA state, $40AE/$40B2 address, $40B6 column, $40BA/$40BE under, $40C2 X step, $40C6 Y step, $40CA char; $40CE Force column, $40CF/$40D0 Force row address'),
    (0x4284, 26, 'beam', '$416C, $410B', '$4284 frame, $428C level (0-2), $428D column, $428E-$4290 chars, $4291-$4293 under, $4294-$4296 colours under, $4297-$429C the frames, $429D flag'),
    (0x4114, 1, 'beamCharge', '$4113 operand', 'self-modified: the charge at release'),
    (0x4791, 16, 'laserBlue', '$43E1', 'two beams: $4791 state, $4793/$4795 address, $4797 column, $4799 X direction, $479B Y direction, $479D char under, $479F colour under'),
    (0x4C4B, 3, 'laserYellowTemp', '$4C3E operands', 'self-modified: $4C4B the slot, $4C4D the property'),
    (0x4C4F, 100, 'laserYellow', '$4848', 'six beams: $4C4F state, $4C55/$4C5B address, $4C61 column, $4C67 X step, $4C6D Y step, $4C73 direction (1-4), $4C79/$4C7D direction handlers, $4C81 row offsets, $4C85 char under, $4C8B colour under, $4C91/$4C92 glyph animation counters, $4C93-$4CB2 four frames of glyph $DD'),
    (0x4855, 2, 'laserYellowGlyphSrc', '$4854 operand', 'self-modified: the frame copied to $C6E8'),
    (0x495E, 4, 'laserYellowDispatch', '$495D operand, $4960', 'self-modified: X and the handler of JMP ($4960)'),
    (0x4EAC, 20, 'laserRed', '$4D08', '$4EAC state, $4EAD/$4EAE row address, $4EAF column, $4EB0 phase, $4EB1-$4EB3 wave phase per row, $4EB4/$4EB5 temps, $4EB6 end; $4EB7-$4EBF chars'),
    (0x1FD8, 25, 'missiles', '$1E14, $1CBC', 'two: $1FD8 state, $1FDA/$1FDC address, $1FDE column, $1FE0 under, $1FE2 colour under, $1FE4 X direction, $1FE6 Y direction, $1FE8 char, $1FEA delay; $1FEC-$1FEF target; $1FF0 missiles owned'),
    (0x1CAC, 5, 'missileTarget', '$1C47 operands', 'self-modified: distances to the nearest enemy'),
    (0x1B49, 24, 'items', '$1B01', '$1B49 colours and $1B4F sprites of the items a carrier turns into (crystal blue/yellow/red, speed, missiles, bit), $1B55-$1B60 their path'),
    (0x1BFC, 16, 'fireRoutines', '$1BE6', 'by crystal colour: low/high byte of the Force\'s fire routine'),
    (0x1A67, 1, 'temp1A67', '$1A66 operand', 'self-modified'),
    (0x1C43, 1, 'temp1C43', '$1C42 operand', 'self-modified: the slot after a pickup'),
    (0x1DB6, 1, 'temp1DB6', 'operand', 'self-modified'),
    (0x1EC7, 1, 'temp1EC7', 'operand', 'self-modified'),
    (0x226B, 1, 'temp226B', '$226A operand', 'self-modified: explosion column'),
    (0x2274, 1, 'temp2274', '$2273 operand', 'self-modified: explosion char'),
    (0x2289, 1, 'temp2289', '$2288 operand', 'self-modified: explosion phase'),
    (0x2C51, 1, 'temp2C51', '$2C50 operand', 'self-modified: Force scan column'),
    (0x348C, 1, 'temp348C', '$348B operand', 'self-modified'),
    (0x34B7, 1, 'temp34B7', '$34B6 operand', 'self-modified'),
    (0x250C, 1, 'temp250C', '$250B operand', 'self-modified (enemy aim)'),
    (0x250E, 1, 'temp250E', '$250D operand', 'self-modified (enemy aim)'),
    (0x23DA, 85, 'explosionTables', '$23B0', 'by type (0-6): $23DA width, $23E1 height, $23E8 last frame, $23EF/$23F6 pointer to the chars; $23FD-$242E the chars'),
    (0x242F, 105, 'explosions', '$2154, $221C', 'six: $242F state, $2435/$243B address, $2441 column, $2447 width, $244D height, $2453 tick, $2459 frame, $245F last frame, $2465 last column, $246B phase, $2471/$2477 chars, $247D/$2483 buffer of the chars under ($0100 page), $2489/$248F of the colours; $2495-$2497 phase table'),
    (0x26D0, 21, 'enemyBullets', '$2562', '$26D0 temp, $26D1 phase, $26D2-$26D5 chars by quarter, $26D6 colour, $26D7-$26DA colours, $26DB-$26E4 chars/colours of aimed bullets'),
    (0x206C, 16, 'blockReplaceMod', '$2049', 'by level: the modulus of the row for the replacement table'),
    (0x2074, 8, 'blockReplaceColor', '$1FF6', 'by level: colour of a destroyed block\'s replacement, $D3 = none'),
    (0x208C, 200, 'blockReplaceChars', '$2067 via $207C', 'replacement chars of destroyed blocks (levels 2, 5, 6, 7)'),
    (0x34C0, 16, 'destructibleTables', '$3440', 'by level: low/high byte of the table of destructible objects'),
    (0x34D0, 43, 'destructibles', '$3440', 'records (char, column offset, row offset, explosion type), $D3 ends'),
    (0x56BD, 15, 'spriteXHigh', '$3A40', 'per sprite slot: the X high bits a slot takes when its X wraps (level 3, the window moving left)'),
]
REGIONS = [r for r in REGIONS if r[1]]
# ★ constants with their place in the code (the ship)
CONSTANTS = [
    ('shipStart', dict(x=0x3F, y=0x72, speed=1, tilt=4), '$1425: $25, $2B, $24, $021D'),
    ('shipLimits', dict(top=0x32, bottom=0xAF, left=0x23, right=0x138), '$2E7F, $2E62, $2E32, $2E02 ($26 = 6, $25 = $38)'),
    ('forceDetachedY', 0xA0, '$14E8: $2C'),
    ('spritePointers', dict(ship=[0x44, 0x45], force=0x4A, explosion=0x5E), '$147D, $14EF, $31E6'),
    ('tiltFrames', [0x40, 0x42, 0x44, 0x46, 0x48], '$2DBD/$2DE4: $CFF9 by two, $CFFA one more'),
    ('spriteRegs', dict(d015=0xFF, d01c=0xFF, d025=0x0B, d026=0x0F, d027=2, d028=0x0E, d029=0x0E), '$145E-$147A'),
    ('invulnerableFrames', 0x78, '$1180: $1191'),
    ('waitFrames', 20, '$0965: frames of $0232 after a start'),
    ('beamMeter', dict(screen=0xCF58, cells=22, empty=0x1A, full=0x1C, levels=[6, 12, 20]), '$15D0, $40D1, $40EC'),
    ('items', dict(bit=0x4A, crystal=0x5B, speed=0x5C, missiles=0x5D), '$1823-$1831'),
    ('maxSpeed', 5, '$1C12'),
    # --- the rules (M5)
    ('livesStart', 3, '$8062 (the title), $5EE3 (after GAME OVER): $281D/$281E'),
    ('extraLifeScore', 100000, '$32EE: a carry out of the 10 000s digit — every 100 000 points, sound 6'),
    ('readyCountdown', 0x32, '$0B70: frames of the READY screen before fire is read ($0C27)'),
    ('readyColors', dict(text=[0x0A, 0x02], rest=[0x0F, 0x0B], rasters=[0x42, 0x82]), '$0BFF-$0C1A: $D022/$D023 between rasters $42 and $82 (the text rows 7-8), and from $82 on'),
    ('levelEndFrames', dict(inner=0x90, outer=2), '$0A20, $0A25: 288 frames of the ship flying to the centre ($0ADB) after a level'),
    ('levelEndCentre', dict(x=0xA0, y=0x64), '$0AE7, $0B47: where sprite 1 goes'),
    ('twoPlayersOff', dict(title='$82FB', tapeEnd='$5ED9'), 'LDA #5 / BNE where CMP #5 / BEQ (F3) once was: the two-player mode is switched off'),
    ('ending', dict(file='E', load=0x6800, entry=0x8000, exit='$FCE2'), '$0A7B: level $D3 loads E and runs $8000; its credits end in a RESET'),
    ('entropyReads', ['$24B7', '$250F', '$2521', '$2B60', '$2B68', '$2B77', '$2B7F', '$4FED', '$5085', '$5286',
                      '$5290', '$5299', '$54C7', '$54D1', '$54DA', '$5E09'], 'LDA $DC04 in the core — the remake\'s generator stands there'),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', default=os.path.join(PROJECT, 'data', 'ship.json'))
    a = ap.parse_args()
    m = rtlib.image()
    regions = []
    for at, n, name, reader, what in REGIONS:
        regions.append(dict(name=name, addr='$%04X' % at, length=n, reader=reader, what=what, bytes=list(m[at:at+n])))
    out = dict(
        source='R-Type, kazeta Electric Dreams (jádro G strany A); tools/dumpship.py',
        note='tabulky a počáteční hodnoty proměnných kódu lodi na adresách originálu; čte je app/ship.js, '
             'měří tools/matchship.mjs',
        regions=regions,
        constants={name: dict(value=value, where=where) for name, value, where in CONSTANTS})
    json.dump(out, open(a.o, 'w'), indent=1, ensure_ascii=False)
    total = sum(r['length'] for r in regions)
    for r in regions:
        print('%s %-22s %3d B  %s' % (r['addr'], r['name'], r['length'], r['reader']))
    print('%d regions, %d bytes -> %s' % (len(regions), total, a.o))


if __name__ == '__main__':
    main()
