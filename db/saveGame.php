<?php

/**
 * A game played: the name, the score and the level reached into
 * `rg_rt_hallOfFame` (`app/gameOverModel.js`, R-049), the high score back.
 */
class DataCommand {

  public function execute($postData) {
    $data = json_decode($postData);
    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $stmt = $mysqli->prepare('INSERT INTO `rg_rt_hallOfFame` (`name`, `score`, `level`, `created`) VALUES (?, ?, ?, NOW())');
    $name = substr((string) ($data->name ?? ''), 0, 64);
    $score = (int) ($data->score ?? 0);
    $level = (int) ($data->level ?? 1);
    $stmt->bind_param('sii', $name, $score, $level);
    $stmt->execute();
    $stmt->close();
    $result = ['hiScore' => 0];
    $top = $mysqli->query('SELECT `score` FROM `rg_rt_hallOfFame` ORDER BY `score` DESC LIMIT 1');
    if ($top && ($row = $top->fetch_object())) {
      $result['hiScore'] = (int) $row->score;
    }
    $mysqli->close();
    return $result;
  } // execute

} // class DataCommand
