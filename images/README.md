# images/ — the app icons and the cover

| file | what it is |
|---|---|
| `poster.png` | poster 1448 × 1086 (operator, 2026-10-19): the Open Graph image of `index.php` |
| `cover.png` | cover 800 × 600 for `/about` (`aboutPage.php`), the poster scaled down: `convert images/poster.png -resize 800x600 images/cover.png` |

`app-icon.svg` is **an original design for the remake** (operator, 2026-10-22,
"Cold Steel"): an angular fighter after the R-9 and a plasma shot on midnight
blue, 1024 × 1024 in curves, no raster and no text — the launcher prints the
game's name under the icon. The `background` and `foreground` groups are
separate, so it can be edited. The original's title logo, which the menu has
at the top (`app/titleLogo.js`), stayed in the menu only.

The PNG set and the favicon are made from it by the library's tools (symlinks
alongside):

    ./make-app-icons      # app-icon-{192,256,512,1024,1980}x*.png
    ./make-favicon        # favicon.ico (128/64/48/32/16), a copy belongs in the root too

`svision/php/appPage.php` references the PNGs (`app-icon-*.png`).

The icons are **original artwork** (operator's exception 2026-10-24, not the
original's graphics); the project is public (operator 2026-10-24, `../ZADANI.md` §0).
