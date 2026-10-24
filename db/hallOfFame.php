<?php

/**
 * The hall of fame (`app/gameOverModel.js`): the ten best **players**, one
 * row per name with the best score and the level of that game — Manic
 * Miner's `GROUP BY`, so a name is never in the table twice.
 */
class DataCommand {

  public function execute($postData) {
    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    // the level of the best game of the name: the first of the levels ordered by score
    $data = $mysqli->query('SELECT `name`, MAX(`score`) AS `score`, '
      .'CAST(SUBSTRING_INDEX(GROUP_CONCAT(`level` ORDER BY `score` DESC, `ndx` DESC), \',\', 1) AS UNSIGNED) AS `level` '
      .'FROM `rg_rt_hallOfFame` GROUP BY `name` ORDER BY `score` DESC LIMIT 10');
    $mysqli->close();
    return $data;
  } // execute

} // class DataCommand
