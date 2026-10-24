# images/ — ikony aplikace a obálka

| soubor | co to je |
|---|---|
| `poster.png` | plakát 1448 × 1086 (operátor, 2026-10-19): Open Graph obrázek `index.php` |
| `cover.png` | obálka 800 × 600 pro `/about` (`aboutPage.php`), zmenšený plakát: `convert images/poster.png -resize 800x600 images/cover.png` |

`app-icon.svg` je **vlastní návrh pro remake** (operátor, 2026-10-22,
„Cold Steel"): hranatá stíhačka po vzoru R-9 a plazmový výstřel na půlnoční
modři, 1024 × 1024 v křivkách, bez rastru a bez textu — jméno hry vypisuje
spouštěč pod ikonou. Skupiny `background` a `foreground` jsou oddělené,
takže se dá upravovat. Logo titulky originálu, které má nahoře menu
(`app/titleLogo.js`), zůstalo jen v menu.

PNG sadu a favicon z něj udělají nástroje knihovny (symlinky vedle):

    ./make-app-icons      # app-icon-{192,256,512,1024,1980}x*.png
    ./make-favicon        # favicon.ico (128/64/48/32/16), kopie patří i do kořene

`svision/php/appPage.php` na PNG odkazuje (`app-icon-*.png`).

Ikony jsou **vlastní grafika** (výjimka operátora 2026-10-24, ne grafika originálu);
projekt je veřejný (operátor 2026-10-24, `../ZADANI.md` §0).
