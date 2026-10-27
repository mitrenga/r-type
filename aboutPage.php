<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original R-Type on the Commodore 64 and
 * of this remake, with links to Wikipedia, C64-Wiki and Lemon64.
 *
 * ★ **The project is public** (operator 2026-10-24, `ZADANI.md` §0; internal
 * before that): the R-Type brand is alive (Irem Software Engineering), so the
 * page describes the work and says who owns the original. The footer names
 * the licence of the remake code (CC BY-NC-SA 4.0, like Manic Miner) and
 * links the GitHub repository (operator 2026-10-22).
 */
class AboutPage extends AbstractAboutPage {

  /** the page calls the application R-TYPE, as the web does (operator 2026-10-19) */
  public function appName() {
    return 'R-TYPE';
  } // appName

  protected function aboutData() {
    return [
      'description' =>
        'R-Type (Irem, 1987; the Commodore 64 conversion by Rainbow Arts for Electric Dreams, 1988) '.
        'rebuilt for the browser on the svision library — the levels, the ship, the enemies, the bosses '.
        'and the music are played by the routines of the original. An unofficial, non-commercial fan remake.',
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1987, 1988)',
          'html' =>
            '<p>R-Type is the 1987 arcade shooter by Irem: the R-9 fighter against the Bydo Empire, eight '.
            'levels of scrolling terrain, the detachable Force pod that shields the ship and fires through '.
            'it, the charged wave cannon, and bosses that fill the screen — the first of them, Dobkeratops, '.
            'became the face of the game and is the loading picture of the tape.</p>'.
            '<p>The Commodore 64 version came out in 1988 under the Electric Dreams label of Activision, '.
            'licensed from Irem and developed by Rainbow Arts. Its title screen names Manfred Trenz and '.
            'Andreas Escher; the engine is the one Trenz had built for Katakis, the game whose likeness to '.
            'R-Type had brought Rainbow Arts the conversion in the first place. It is a multiload: side A '.
            'carries the loader, the picture and the core, side B the eight levels, each with its own '.
            'graphics, enemies and tune.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake of the Commodore 64 version by Rainbow Arts for Electric Dreams. '.
            'It runs directly in your web browser — there is nothing to install and nothing to download, '.
            'just open the page and play, free of charge. The game supports keyboard, touch controls and '.
            'gamepads.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'R-Type on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/R-Type'],
        ['label' => 'R-Type on C64-Wiki', 'url' => 'https://www.c64-wiki.com/wiki/R-Type'],
        ['label' => 'Game entry on Lemon64', 'url' => 'https://www.lemon64.com/game/r-type'],
        ['label' => 'Manfred Trenz on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Manfred_Trenz'],
      ],
      'footer' =>
        '<p>An unofficial fan remake, made as a study of the Commodore 64. R-Type, its artwork and its '.
        'music belong to their authors and rights holders — &copy; Irem Corp. 1987, the Commodore 64 '.
        'conversion &copy; Electric Dreams / Activision 1988, developed by Rainbow Arts. This remake is '.
        'free of charge and not for sale. '.
        'Remake source code is available on <a href="https://github.com/mitrenga/r-type" target="_blank" rel="noopener">GitHub</a> '.
        'under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
