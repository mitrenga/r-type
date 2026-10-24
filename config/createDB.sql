SET @dbname = 'r-type';

SET @query = CONCAT('CREATE DATABASE IF NOT EXISTS `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @query = CONCAT('USE `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- the games played, as Booty's rg_bt_hallOfFame, with the level reached (R-049)
CREATE TABLE IF NOT EXISTS rg_rt_hallOfFame (
  `ndx` BIGINT(20) NOT NULL AUTO_INCREMENT,
  `name` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `score` BIGINT(20) NOT NULL,
  `level` TINYINT NOT NULL DEFAULT 1,
  `created` TIMESTAMP NOT NULL,
  PRIMARY KEY (`ndx`),
  INDEX `score` (`score`),
  INDEX `name` (`name`),
  INDEX `created` (`created`),
  INDEX `created_name` (`created`, `name`)
);
