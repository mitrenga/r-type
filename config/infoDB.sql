SELECT `ndx`, `name`, `score`, `level`, `created`
FROM `rg_rt_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
