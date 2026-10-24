<?php
  $appName = 'R-TYPE';
  $appDescription = 'Remake of R-TYPE (Irem / Electric Dreams 1988, Commodore 64) on the svision library.';
  $appPrefix = 'rt';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  if (file_exists(__DIR__.'/config/config.php')) {
    require_once __DIR__.'/config/config.php';
  }
  require_once 'app/svision/php/main.php';
