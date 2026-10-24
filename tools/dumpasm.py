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
    (0x0812, 'gameEntry', '§1', 'JMP $8000 — vstup jádra'),
    (0x0815, 'levelStart', '§1', 'po výzvě ke straně B'),
    (0x08C1, 'mainLoop', '§3', 'hlavní smyčka'),
    (0x0BF8, 'readyLoop', '§3', 'READY: čeká na fire'),
    (0x0CF4, 'irqEntry', '§2', 'vektor $FFFE, KERNAL odpojený'),
    (0x0DE6, 'irqPanelTop', '§2', 'řetěz: rastr $CA'),
    (0x0EC5, 'irqPanel', '§2', 'řetěz: rastr $D6'),
    (0x0F4D, 'irqBottom', '§2', 'řetěz: rastr $FF'),
    (0x0D04, 'irqTop', '§2', 'řetěz: rastr $30'),
    (0x0F6C, 'irqBand1', '§2', 'multiplex, rastr z $023A'),
    (0x0FB7, 'irqBand2', '§2', 'multiplex, rastr z $023B'),
    (0x1066, 'irqBand3', '§2', 'multiplex, rastr z $023D'),
    (0x10B6, 'irqBand4', '§2', 'multiplex, rastr z $023E'),
    (0x114C, 'irqBand5', '§2', 'multiplex, zpět na $0DE6'),
    (0x0E0B, 'irqAlt', '§2', 'druhý řetěz ($579C, $57BC)'),
    (0x57AF, 'irqAlt2', '§2', 'druhý řetěz'),
    (0x585D, 'irqAlt3', '§2', 'druhý řetěz'),
    (0x3D74, 'gameStep', '§3', 'krok hry z přerušení'),
    (0x319C, 'collision', '§4', 'kolize (druhá ruka: POKE $319C,$60)'),
    (0x6370, 'levelMusic', '§1', 'začátek souboru M úrovně — volá READY i přerušení'),
    (0x162F, 'buildMap', '§8', 'mapa 19 × 512 na $9A00 ze skriptu a bloků'),
    (0x11A2, 'firstScreen', '§8', 'první obrazovka z mapy, barvy z $8CAC'),
    (0x34FB, 'scrollStep', '§8', 'krok scrollu: jemný posun, posun o sloupec, nový sloupec'),
    (0x1224, 'levelInit1', '§7', 'init úrovně 1 ($139A)'),
    (0x12A7, 'levelInit2', '§7', 'init úrovně 2'),
    (0x12BB, 'levelInit3', '§7', 'init úrovně 3: mapa 23 × 79 do bufferu 130'),
    (0x134D, 'levelInit4', '§7', 'init úrovně 4'),
    (0x3702, 'scrollVertical', '§10', 'krok scrollu úrovně 3: dva skripty, okno 19 × 39'),
    (0x3944, 'vWindow', '§10', 'adresy řádků okna úrovně 3'),
    (0x4FA8, 'spawner', '§9', 'spouštění vln z tabulky ($7AD2)'),
    (0x56CF, 'endObject', '§9', 'položka vlny $80-$FA'),
    (0x0CD5, 'livesPanel', '§7', 'ikony životů v panelu'),
    (0x3A29, 'vEnemiesLeft', '§10', 'úroveň 3: nepřátelé s terénem'),
    (0x3A49, 'vEnemiesRight', '§10', 'úroveň 3: nepřátelé s terénem'),
    (0x3A9F, 'vEnemiesUp', '§10', 'úroveň 3: nepřátelé s terénem'),
    (0x5E47, 'tapeEnd', '§7', 'obrazovka PLEASE REWIND TAPE'),
    (0x26E5, 'twoPlayers', '§3', 'střídání hráčů'),
    # M3 (§11): the ship, its weapons and the code the immortal run never reached
    (0x2821, 'shipStep', '§11', 'krok lodi z přerušení $0DE6: Force, joystick, kolize s terénem'),
    (0x2A12, 'forceStep', '§11', 'stavový automat Force'),
    (0x31A2, 'shipDeath', '§11', 'smrt lodi: výbuch, $0E69 <- $31FC'),
    (0x31FC, 'deathAnim', '§11', 'animace výbuchu lodi, pak $321A'),
    (0x3B74, 'fireButton', '§11', 'fire: střela, paprsek, střely Force'),
    (0x42FA, 'laserBlue', '§11', 'odrazový laser (krystal barvy 6), $3B99'),
    (0x47A1, 'laserYellow', '§11', 'pozemní laser (krystal barvy 7), $3B99'),
    (0x4CAF, 'laserRed', '§11', 'protiletadlový laser (krystal barvy 2) — vstup $4CB3 z $3B98'),
    (0x4CB3, 'laserRedFire', '§11', 'vstup z $3B98 s příznaky CMP (BEQ neplatí)'),
    (0x4EC0, 'bitsFire', '§11', 'střely bitů ($3079/$307A) do $40AA'),
    (0x4962, 'yellowDir0', '§11', 'pozemní laser: směr 0 ($4C79/$4C7D -> JMP $4960)'),
    (0x49F3, 'yellowDir1', '§11', 'pozemní laser: směr 1'),
    (0x4A83, 'yellowDir2', '§11', 'pozemní laser: směr 2'),
    (0x4B14, 'yellowDir3', '§11', 'pozemní laser: směr 3'),
    (0x1B61, 'pickup', '§11', 'sebrání položky: bit $4A, krystal $5B, rychlost $5C, rakety $5D'),
    (0x17FB, 'enemyLoop', '§11', 'smyčka sprajtů 3-7 z konce obsluhy rastru 48 (položky, kolize)'),
    (0x2154, 'explode', '§11', 'výbuch ničitelného bloku ve znacích'),
    (0x1FF1, 'blockReplace', '§11', 'náhradní znaky zničeného bloku po úrovních ($207C)'),
    # M4 (§12): the enemies, the multiplexer's slots, the bosses
    (0x1A74, 'enemyDie', '§12', 'smrt nepřítele: zvuk, nosič → položka ($1B01), formace ($1A9C), skóre a výbuch'),
    (0x1B01, 'carrierItem', '§12', 'nosič ($78/$79) se mění v položku'),
    (0x2498, 'enemyShoot', '§12', 'střela nepřítele ($0596 = 2): časovač $024A/$024B, míření po čtvrtinách'),
    (0x505E, 'launch', '§12', 'spuštění nepřítele do slotu: tabulky typu z M, tři cesty po šesti bajtech'),
    (0x518D, 'stateMachine', '§12', 'stavový automat slotů: výbuch, cesta X, sonda terénu, animace, cesta Y'),
    (0x5305, 'groundProbe', '§12', 'sonda terénu pozemního nepřítele (dva řádky níž)'),
    (0x539C, 'animStep', '§12', 'animace: ukazatel sprajtu z tabulky třetí cesty'),
    (0x5403, 'pathY', '§12', 'cesta Y: příkazy $D3-$D6'),
    (0x5528, 'groundY', '§12', 'buňka pod pozemním nepřítelem: pevná → krok slotu končí'),
    (0x5552, 'bandUp', '§12', 'přechod slotu do skupiny výš'),
    (0x5577, 'bandDown', '§12', 'přechod slotu do skupiny níž'),
    (0x55AD, 'slotMove', '§12', 'slot zkopírován do jiné skupiny; obsazený cíl otáčí směr Y'),
    (0x5902, 'bossFrame', '§12', 'boss v obsluze rastru 48: kolize s lodí, střely v zónách'),
    (0x59AD, 'bossHit', '§12', 'zásah bosse: slabé místo, zbraň, výbuch'),
    (0x5AE3, 'bossCollision', '§12', 'loď proti zónám bosse'),
    (0x5BA0, 'bossCollision4', '§12', 'úroveň 4: tři části bosse, jejich zásahy a konec'),
    (0x5DB1, 'bossDeath', '§12', 'smrt bosse: výbuchy sprajtů, pak konec úrovně'),
    (0x5E17, 'levelEnd', '§12', 'konec úrovně: $0232/$0310, další úroveň'),
    (0x3A68, 'vEnemiesDown', '§10', 'úroveň 3: nepřátelé s terénem dolů (záplaty $55B0/$56B8)'),
]
# ★ per level: the hook of the chain ($13BA), the init ($139A) — $17FA is RTS (none)
LEVEL_HOOKS = [0x940A, 0x943B, 0x9586, 0x918D, 0x17FA, 0x9286, 0x93B6, 0x17FA]
LEVEL_INITS = [0x1224, 0x12A7, 0x12BB, 0x134D, 0x17FA, 0x17FA, 0x17FA, 0x17FA]
LEVEL_MUSIC = [(0x6370, 'musicPlay', '§7', 'hudba: krok (READY i přerušení)'),
               (0x6373, 'musicInit', '§7', 'hudba: init'),
               (0x6376, 'soundFx', '§12', 'zvuk n ($33FB: X = 2, A = zvuk)'),
               (0x6379, 'musicStart', '§7', 'hudba: skladba A ($5E55, $57AC)'),
               (0x637C, 'musicStop', '§7', 'hudba: stop ($0860)')]
ENTRIES_TITLE = [
    (0x8000, 'titleEntry', '§1', 'titulka'),
    (0x82D2, 'titleIrqSetup', '§1', 'rastr titulky'),
    (0x82F5, 'titleIrq', '§1', 'F1 přes $CB'),
    (0x6800, 'musicPlay', '§1', 'přehrávač hudby'),
    (0x6809, 'musicInit', '§1', 'init hudby, A = skladba'),
    (0x680C, 'musicStart', '§1', 'volá $8019'),
]
ENTRIES_BOOT = [
    (0x080E, 'bootEntry', '§0', 'SYS 2062'),
    (0x02A8, 'loadSequence', '§0', 'P, obrázek, M, G'),
    (0x6200, 'turboLoad', '§0', 'turbo Rainbow Arts'),
]


def hints(entries, path, data=()):
    h = dict(note='vstupní body R-Type; u každého je paragraf sources/docs/disasm_notes.md',
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
            os.path.join(tmp, name + '.asm'), 'R-Type BOOT (kazeta, strana A)')
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
        os.path.join(ASM, 'title.asm'), 'R-Type: jádro po nahrání strany A (titulka)')

    # game: level 1 in play. ★ The image was recorded with collisions off
    # (`tracecoverage.py --immortal`: $319C = RTS); the tape's byte goes back
    # so that the listing shows the collision routine ($319C: LDA $1190).
    game = bytearray(open(os.path.join(BUILD, 'mem', 'game_ram.bin'), 'rb').read())
    tape = rtlib.image()
    game[0x319C] = tape[0x319C]
    open(os.path.join(tmp, 'game.bin'), 'wb').write(game)
    hints(ENTRIES_GAME, os.path.join(ASM, 'hints.json'))
    dis(os.path.join(tmp, 'game.bin'), 0x0800, 0xFFFF, os.path.join(ASM, 'hints.json'),
        os.path.join(ASM, 'main.asm'), 'R-Type: úroveň 1 za běhu (RAM)',
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
            entries.append((LEVEL_HOOKS[n-1], 'levelHook', '§12', 'háček řetězu ($13BA, volá $0E82 po kroku lodi)'))
        if LEVEL_INITS[n-1] != 0x17FA and LEVEL_INITS[n-1] >= 0x6370:
            entries.append((LEVEL_INITS[n-1], 'levelInit', '§7', 'init úrovně ($139A)'))
        if boss:
            entries.append((boss, 'bossStep', '§12', 'krok bosse: JSR přes $7ACD/$7ACE z $57F7 (druhý řetěz)'))
        if n == 1:
            entries.append((0x9531, 'starsInit', '§7', 'animace hvězd z initu $1224 ($12A4)'))
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
            'R-Type: úroveň %d — M ($6370-$%04X) a G ($86AC-$%04X) z kazety' % (n, m_end, g_end))


if __name__ == '__main__':
    main()
