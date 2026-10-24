<?php

/**
 * What the application fetches once at its start (`appData.db`, like Booty):
 * the data of the original from `data/*.json`, section by section, each the
 * output of a tool in tools/ (`data/README.md`):
 *
 * - `levels`   – the eight levels: blocks, map scripts, tables (dumplevels.py)
 * - `charsets` – the character sets of the playfield and the panel (dumpcharset.py)
 * - `sprites`  – the sprite blocks of the ship and of every level (dumpsprites.py)
 * - `waves`    – the enemy waves and type tables (dumpwaves.py)
 * - `texts`    – the panel, the texts, the colour tables (dumptexts.py)
 * - `global`   – the core's tables and constants (dumpglobal.py)
 * - `ship`     – the tables and start values of the ship's code (dumpship.py)
 * - `enemies`  – the memory of the enemy and boss code: core, M and G of every level (dumpenemies.py)
 * - `music`    – the SID player's variables and the song of every level's M (dumpmusic.py, M6)
 * - `picture`  – the loading picture of side A, file P (dumppicture.py)
 * - `title`    – the logo of the title screen: its character set and screen codes (dumptitle.py)
 *
 * A missing file arrives as null and the application has to live with it.
 * `hiScore` is the best score of the local database (`config/createDB.sql`,
 * `db/saveGame.php`), or 0 without one.
 */
class DataCommand {

  var $sections = ['levels', 'charsets', 'sprites', 'waves', 'texts', 'global', 'ship', 'enemies', 'music', 'picture', 'title'];

  public function execute($postData) {
    $result = [];
    foreach ($this->sections as $section) {
      $result[$section] = null;
      $file = 'data/'.$section.'.json';
      if (is_file($file)) {
        try {
          $result[$section] = json_decode(file_get_contents($file), false, 512, JSON_THROW_ON_ERROR);
        }
        catch (\JsonException $exception) {
          $result['error'] = ['message' => $section.': '.$exception->getMessage()];
        }
      }
    }
    $result['hiScore'] = 0;
    if (!empty($GLOBALS['dbName'])) {
      try {
        $mysqli = @new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
        if (!$mysqli->connect_errno) {
          $top = $mysqli->query('SELECT `score` FROM `rg_rt_hallOfFame` ORDER BY `score` DESC LIMIT 1');
          if ($top && ($row = $top->fetch_object())) {
            $result['hiScore'] = (int) $row->score;
          }
          $mysqli->close();
        }
      }
      catch (\Throwable $exception) {
      }
    }
    return $result;
  } // execute

} // class DataCommand
