<?php

/**
 * The statistics behind the heading of ABOUT (five clicks, `app/aboutModel.js`),
 * the shape of Booty's: players and games by day, week, month, year and in total,
 * counted over the games played (`rg_rt_hallOfFame`, `config/createDB.sql`).
 */
class DataCommand {

  public function execute($postData) {
    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $periods = ['day', 'week', 'month', 'year', 'total'];
    $values = ['players', 'games'];
    $data = [];
    foreach ($periods as $period) {
      $data[$period] = [];
      foreach ($values as $value) {
        $data[$period][$value] = $this->getData($mysqli, (($period == 'total') ? '1' : '`created` >= NOW()-INTERVAL 1 '.strtoupper($period)), (($value == 'games') ? '*' : 'DISTINCT `name`'));
      }
    }
    $mysqli->close();
    return $data;
  } // execute

  public function getData($mysqli, $where, $calcKey) {
    return $mysqli->query('SELECT COUNT('.$calcKey.') as `count` FROM `rg_rt_hallOfFame` WHERE ('.$where.')')->fetch_assoc()['count'];
  } // getData

} // class DataCommand
