#!/usr/bin/env python3
"""dumpasm — disassembly of the original into sources/asm/.

`svision/tools/retro/dis6502.py` traces from entry points and leaves bytes
it does not reach. The entries here come from two places, both recorded:
- **read from the code** (`ENTRIES`, each with its § in
  `sources/docs/disasm_notes.md`) — the interrupt chain, the loops;
- **sampled from a run** (`sources/asm/coverage_samples.txt`, written by
  `tools/tracecoverage.py`) — every PC seen in the CPU history.

Three listings, three memory images (all from the tape, `../tape/README.md`):

| listing | image | range |
|---|---|---|
| `boot.asm` | `BOOT` + the turbo relocated as at run time | `$02A8`-`$02CF`, `$0801`-`$09D7`, `$6200`-`$63FF` |
| `title.asm` | RAM at `$0812` (core loaded: `G` + `M`) | `$0812`-`$A133` |
| `main.asm` | RAM in level 1 (`build/mem/game_ram.bin`, tracecoverage) | `$0800`-`$FFFF` |
| `level<N>.asm` | the level's `M` and `G` from the tape (`rtlib.image(N)`) | `$6370`-`$9A00` |

★ **The code of a level** (M4): the music player and the boss in `M`
(`$6370`…, the boss routine the core calls through `$7ACD/$7ACE` at
`$57F7`), the hook of the interrupt chain (`$13BA`), the init (`$139A`)
and the level's own animations in `G` (`$86AC`…). The entries come from the
core's tables (`disasm_notes.md` §7, §12); the tables of the enemies, the
waves and the boss are marked as data.

    tools/dumpasm.py
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
DIS = os.path.join(PROJECT, '..', 'svision', 'tools', 'retro', 'dis6502.py')
ASM = os.path.join(PROJECT, 'sources', 'asm')
BUILD = os.path.join(PROJECT, 'build')
sys.path.insert(0, HERE)
import rtlib  # noqa: E402
from rtlib import turbo_files  # noqa: E402
sys.path.insert(0, os.path.join(PROJECT, '..', 'svision', 'tools', 'retro', 'c64'))
from c64tape import pulses, kernal_files  # noqa: E402

SIDE_A = os.path.join(PROJECT, 'sources', 'tape', 'rtype_side1.tap')

# (address, label, §, what) — every entry has its paragraph
ENTRIES_GAME = [
    (0x0812, 'gameEntry', '§1', 'JMP $8000 — the core\'s entry'),
    (0x0815, 'levelStart', '§1', 'after the prompt for side B'),
    (0x08C1, 'mainLoop', '§3', 'the main loop'),
    (0x0BF8, 'readyLoop', '§3', 'READY: waits for fire'),
    (0x0CF4, 'irqEntry', '§2', 'vector $FFFE, KERNAL banked out'),
    (0x0DE6, 'irqPanelTop', '§2', 'the chain: raster $CA'),
    (0x0EC5, 'irqPanel', '§2', 'the chain: raster $D6'),
    (0x0F4D, 'irqBottom', '§2', 'the chain: raster $FF'),
    (0x0D04, 'irqTop', '§2', 'the chain: raster $30'),
    (0x0F6C, 'irqBand1', '§2', 'multiplexer, raster from $023A'),
    (0x0FB7, 'irqBand2', '§2', 'multiplexer, raster from $023B'),
    (0x1066, 'irqBand3', '§2', 'multiplexer, raster from $023D'),
    (0x10B6, 'irqBand4', '§2', 'multiplexer, raster from $023E'),
    (0x114C, 'irqBand5', '§2', 'multiplexer, back to $0DE6'),
    (0x0E0B, 'irqAlt', '§2', 'the second chain ($579C, $57BC)'),
    (0x57AF, 'irqAlt2', '§2', 'the second chain'),
    (0x585D, 'irqAlt3', '§2', 'the second chain'),
    (0x3D74, 'gameStep', '§3', 'the game step from the interrupt'),
    (0x319C, 'collision', '§4', 'collisions (second hand: POKE $319C,$60)'),
    (0x6370, 'levelMusic', '§1', 'start of the level\'s file M — called by READY and the interrupt alike'),
    (0x162F, 'buildMap', '§8', 'the 19 × 512 map at $9A00 from the script and the blocks'),
    (0x11A2, 'firstScreen', '§8', 'the first screen from the map, colours from $8CAC'),
    (0x34FB, 'scrollStep', '§8', 'the scroll step: fine shift, column shift, new column'),
    (0x1224, 'levelInit1', '§7', 'init of level 1 ($139A)'),
    (0x12A7, 'levelInit2', '§7', 'init of level 2'),
    (0x12BB, 'levelInit3', '§7', 'init of level 3: the 23 × 79 map into the 130-wide buffer'),
    (0x134D, 'levelInit4', '§7', 'init of level 4'),
    (0x3702, 'scrollVertical', '§10', 'the scroll step of level 3: two scripts, a 19 × 39 window'),
    (0x3944, 'vWindow', '§10', 'row addresses of the level 3 window'),
    (0x4FA8, 'spawner', '§9', 'launching waves from the table ($7AD2)'),
    (0x56CF, 'endObject', '§9', 'wave entry $80-$FA'),
    (0x0CD5, 'livesPanel', '§7', 'the life icons in the panel'),
    (0x3A29, 'vEnemiesLeft', '§10', 'level 3: enemies with the terrain'),
    (0x3A49, 'vEnemiesRight', '§10', 'level 3: enemies with the terrain'),
    (0x3A9F, 'vEnemiesUp', '§10', 'level 3: enemies with the terrain'),
    (0x5E47, 'tapeEnd', '§7', 'the PLEASE REWIND TAPE screen'),
    (0x26E5, 'twoPlayers', '§3', 'alternating the players'),
    # M3 (§11): the ship, its weapons and the code the immortal run never reached
    (0x2821, 'shipStep', '§11', 'the ship step from the interrupt $0DE6: Force, joystick, collisions with the terrain'),
    (0x2A12, 'forceStep', '§11', 'the Force state machine'),
    (0x31A2, 'shipDeath', '§11', 'the ship\'s death: explosion, $0E69 <- $31FC'),
    (0x31FC, 'deathAnim', '§11', 'the ship\'s explosion animation, then $321A'),
    (0x3B74, 'fireButton', '§11', 'fire: shot, beam, the Force\'s shots'),
    (0x42FA, 'laserBlue', '§11', 'the bouncing laser (crystal of colour 6), $3B99'),
    (0x47A1, 'laserYellow', '§11', 'the ground laser (crystal of colour 7), $3B99'),
    (0x4CAF, 'laserRed', '§11', 'the anti-aircraft laser (crystal of colour 2) — entry $4CB3 from $3B98'),
    (0x4CB3, 'laserRedFire', '§11', 'entry from $3B98 with the CMP flags (the BEQ does not hold)'),
    (0x4EC0, 'bitsFire', '§11', 'the bits\' shots ($3079/$307A) into $40AA'),
    (0x4962, 'yellowDir0', '§11', 'the ground laser: direction 0 ($4C79/$4C7D -> JMP $4960)'),
    (0x49F3, 'yellowDir1', '§11', 'the ground laser: direction 1'),
    (0x4A83, 'yellowDir2', '§11', 'the ground laser: direction 2'),
    (0x4B14, 'yellowDir3', '§11', 'the ground laser: direction 3'),
    (0x1B61, 'pickup', '§11', 'picking up an item: bit $4A, crystal $5B, speed $5C, missiles $5D'),
    (0x17FB, 'enemyLoop', '§11', 'the loop over sprites 3-7 at the end of the raster 48 handler (items, collisions)'),
    (0x2154, 'explode', '§11', 'explosion of a destructible block in characters'),
    (0x1FF1, 'blockReplace', '§11', 'the replacement characters of a destroyed block, per level ($207C)'),
    # M4 (§12): the enemies, the multiplexer's slots, the bosses
    (0x1A74, 'enemyDie', '§12', 'an enemy\'s death: sound, carrier → item ($1B01), formation ($1A9C), score and explosion'),
    (0x1B01, 'carrierItem', '§12', 'a carrier ($78/$79) turns into an item'),
    (0x2498, 'enemyShoot', '§12', 'an enemy\'s shot ($0596 = 2): timer $024A/$024B, aiming by quarters'),
    (0x505E, 'launch', '§12', 'launching an enemy into a slot: the type tables from M, three paths of six bytes each'),
    (0x518D, 'stateMachine', '§12', 'the slots\' state machine: explosion, path X, terrain probe, animation, path Y'),
    (0x5305, 'groundProbe', '§12', 'the terrain probe of a ground enemy (two rows down)'),
    (0x539C, 'animStep', '§12', 'animation: the sprite pointer from the third path\'s table'),
    (0x5403, 'pathY', '§12', 'path Y: commands $D3-$D6'),
    (0x5528, 'groundY', '§12', 'the cell under a ground enemy: solid → the slot step ends'),
    (0x5552, 'bandUp', '§12', 'a slot moving to the group above'),
    (0x5577, 'bandDown', '§12', 'a slot moving to the group below'),
    (0x55AD, 'slotMove', '§12', 'a slot copied into another group; an occupied target turns the Y direction'),
    (0x5902, 'bossFrame', '§12', 'the boss in the raster 48 handler: collision with the ship, shots in the zones'),
    (0x59AD, 'bossHit', '§12', 'a hit on the boss: weak spot, weapon, explosion'),
    (0x5AE3, 'bossCollision', '§12', 'the ship against the boss\'s zones'),
    (0x5BA0, 'bossCollision4', '§12', 'level 4: the three parts of the boss, their hits and the end'),
    (0x5DB1, 'bossDeath', '§12', 'the boss\'s death: sprite explosions, then the end of the level'),
    (0x5E17, 'levelEnd', '§12', 'the end of the level: $0232/$0310, the next level'),
    (0x3A68, 'vEnemiesDown', '§10', 'level 3: enemies with the terrain, downwards (patches $55B0/$56B8)'),
]
# ★ per level: the hook of the chain ($13BA), the init ($139A) — $17FA is RTS (none)
LEVEL_HOOKS = [0x940A, 0x943B, 0x9586, 0x918D, 0x17FA, 0x9286, 0x93B6, 0x17FA]
LEVEL_INITS = [0x1224, 0x12A7, 0x12BB, 0x134D, 0x17FA, 0x17FA, 0x17FA, 0x17FA]
LEVEL_MUSIC = [(0x6370, 'musicPlay', '§7', 'music: step (READY and the interrupt alike)'),
               (0x6373, 'musicInit', '§7', 'music: init'),
               (0x6376, 'soundFx', '§12', 'sound n ($33FB: X = 2, A = the sound)'),
               (0x6379, 'musicStart', '§7', 'music: tune A ($5E55, $57AC)'),
               (0x637C, 'musicStop', '§7', 'music: stop ($0860)')]
ENTRIES_TITLE = [
    (0x8000, 'titleEntry', '§1', 'the title screen'),
    (0x82D2, 'titleIrqSetup', '§1', 'the title\'s raster'),
    (0x82F5, 'titleIrq', '§1', 'F1 through $CB'),
    (0x6800, 'musicPlay', '§1', 'the music player'),
    (0x6809, 'musicInit', '§1', 'music init, A = the tune'),
    (0x680C, 'musicStart', '§1', 'called from $8019'),
]
ENTRIES_BOOT = [
    (0x080E, 'bootEntry', '§0', 'SYS 2062'),
    (0x02A8, 'loadSequence', '§0', 'P, the picture, M, G'),
    (0x6200, 'turboLoad', '§0', 'the Rainbow Arts turbo'),
]


def hints(entries, path, data=()):
    h = dict(note='entry points of R-Type; each one has its paragraph in sources/docs/disasm_notes.md',
             entries=['%04X' % a for a, *_ in entries],
             labels={'%04X' % a: n for a, n, *_ in entries},
             why={'%04X' % a: '%s %s' % (s, w) for a, _, s, w in entries},
             data=[list(d) for d in data])
    json.dump(h, open(path, 'w'), indent=1, ensure_ascii=False)


def dis(image, lo, hi, hintfile, out, title, coverage=None):
    cmd = [sys.executable, DIS, image, '--lo', '%x' % lo, '--hi', '%x' % hi,
           '--machine', 'c64', '--hints', hintfile, '-o', out, '--title', title]
    if coverage:
        cmd += ['--coverage', coverage]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(os.path.basename(out) + ':', (r.stdout + r.stderr).strip())


def main():
    os.makedirs(ASM, exist_ok=True)
    tmp = os.path.join(BUILD, 'asm'); os.makedirs(tmp, exist_ok=True)

    # boot: the BASIC program, the 40 bytes at $02A8 and the turbo at $6200
    boot = next(f for f in kernal_files(pulses(SIDE_A)) if f['name'] == 'BOOT')['data']
    m = bytearray(65536)
    m[0x0801:0x0801 + len(boot)] = boot
    m[0x6200:0x6400] = m[0x0870:0x0A70]
    m[0x02A8:0x02D0] = m[0x0849:0x0871]
    open(os.path.join(tmp, 'boot.bin'), 'wb').write(m)
    hints(ENTRIES_BOOT, os.path.join(ASM, 'hints_boot.json'))
    for lo, hi, name in ((0x02A8, 0x02D0, 'boot_02a8'), (0x0801, 0x09D8, 'boot_0801'), (0x6200, 0x6400, 'boot_6200')):
        dis(os.path.join(tmp, 'boot.bin'), lo, hi, os.path.join(ASM, 'hints_boot.json'),
            os.path.join(tmp, name + '.asm'), 'R-Type BOOT (tape, side A)')
    with open(os.path.join(ASM, 'boot.asm'), 'w') as f:
        for name in ('boot_02a8', 'boot_0801', 'boot_6200'):
            f.write(open(os.path.join(tmp, name + '.asm')).read() + '\n')

    # title: core as loaded at $0812, RAM (G and M from the tape decoder)
    files = turbo_files(SIDE_A)
    m = bytearray(65536)
    for f in files:
        dest = {'P': 0x7000, 'M': 0x6800, 'G': 0x0812}[f['name']]
        m[dest:dest + len(f['data'])] = f['data']
    open(os.path.join(tmp, 'title.bin'), 'wb').write(m)
    hints(ENTRIES_TITLE, os.path.join(ASM, 'hints_title.json'))
    dis(os.path.join(tmp, 'title.bin'), 0x0812, 0xA134, os.path.join(ASM, 'hints_title.json'),
        os.path.join(ASM, 'title.asm'), 'R-Type: the core after loading side A (the title screen)')

    # game: level 1 in play. ★ The image was recorded with collisions off
    # (`tracecoverage.py --immortal`: $319C = RTS); the tape's byte goes back
    # so that the listing shows the collision routine ($319C: LDA $1190).
    game = bytearray(open(os.path.join(BUILD, 'mem', 'game_ram.bin'), 'rb').read())
    tape = rtlib.image()
    game[0x319C] = tape[0x319C]
    open(os.path.join(tmp, 'game.bin'), 'wb').write(game)
    hints(ENTRIES_GAME, os.path.join(ASM, 'hints.json'))
    dis(os.path.join(tmp, 'game.bin'), 0x0800, 0xFFFF, os.path.join(ASM, 'hints.json'),
        os.path.join(ASM, 'main.asm'), 'R-Type: level 1 in play (RAM)',
        coverage=os.path.join(ASM, 'coverage_samples.txt'))

    # the levels: M and G of each from the tape (M4 — the boss, the hooks)
    core = rtlib.core_files()
    waves = json.load(open(os.path.join(PROJECT, 'data', 'waves.json')))
    for n in range(1, 9):
        m = rtlib.image(n, core=core)
        files = rtlib.level_files(n)
        m_end, g_end = 0x6370 + len(files['M']), 0x86AC + len(files['G'])
        wave = rtlib.word(m, 0x7AD2)
        wave_end = int(waves['levels'][n-1]['table']['end'][1:], 16)   # tools/dumpwaves.py: the first entry >= $80
        boss = rtlib.word(m, 0x7ACD)
        entries = list(LEVEL_MUSIC)
        if LEVEL_HOOKS[n-1] != 0x17FA:
            entries.append((LEVEL_HOOKS[n-1], 'levelHook', '§12', 'the hook of the chain ($13BA, called by $0E82 after the ship step)'))
        if LEVEL_INITS[n-1] != 0x17FA and LEVEL_INITS[n-1] >= 0x6370:
            entries.append((LEVEL_INITS[n-1], 'levelInit', '§7', 'the level\'s init ($139A)'))
        if boss:
            entries.append((boss, 'bossStep', '§12', 'the boss step: JSR through $7ACD/$7ACE from $57F7 (the second chain)'))
        if n == 1:
            entries.append((0x9531, 'starsInit', '§7', 'the star animation from the init $1224 ($12A4)'))
        data = [('7AC0', '7AD2', 'bossTable'), ('7AD2', '7AD6', 'wavePointers'),
                ('7AD6', '7DFC', 'enemyTypes'), ('%04X' % wave, '%04X' % wave_end, 'waves'),
                ('86AC', '8CAC', 'charset'), ('8CAC', '8E6C', 'charTables'), ('8E6C', '8F32', 'blockTable')]
        hintfile = os.path.join(ASM, 'hints_level%d.json' % n)
        hints(entries, hintfile, data)
        if n == 4:
            # ★ $9312: JMP through the operand $9321/$9322 patched from $94AE/$94B1 by part (X = 0-2)
            h = json.load(open(hintfile))
            h['vectors'] = {'9321': ['%04X' % (m[0x94AE+i] | m[0x94B1+i] << 8) for i in range(3)]}
            h['entries'] += h['vectors']['9321']
            json.dump(h, open(hintfile, 'w'), indent=1, ensure_ascii=False)
        open(os.path.join(tmp, 'level%d.bin' % n), 'wb').write(m)
        dis(os.path.join(tmp, 'level%d.bin' % n), 0x6370, 0x9A00, hintfile,
            os.path.join(ASM, 'level%d.asm' % n),
            'R-Type: level %d — M ($6370-$%04X) and G ($86AC-$%04X) from the tape' % (n, m_end, g_end))


if __name__ == '__main__':
    main()
