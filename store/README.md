# Play Store images

The images for the Google Play listing of Tem Sinal (`dev.meuquerido.temsinal`), in Portuguese
(Brazil), the listing's default language. `scripts/store-assets.sh` renders them all again.

| File | Size | Play Console field |
|---|---|---|
| `icon-512.png` | 512 x 512, 32-bit PNG with alpha | Main store listing > App icon |
| `feature-1024x500.png` | 1024 x 500, 24-bit PNG, no alpha | Main store listing > Feature graphic |
| `phone-1.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 1st: the logging screen while recording |
| `phone-2.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 2nd: the public map zoomed in on a trail |
| `phone-3.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 3rd: a cell's figures for each carrier |
| `phone-4.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 4th: the public map zoomed out |
| `phone-5.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 5th: "Minhas gravações" |
| `phone-6.png` | 1080 x 1920, 24-bit PNG | Phone screenshots, 6th: the warning before the first recording |

Play's limits, checked on 2026-11-16 in [Add preview assets to showcase your
app](https://support.google.com/googleplay/android-developer/answer/9866151): the icon is a 512 x
512 32-bit PNG of at most 1024 KB, which Play shows with rounded corners, so it fills the square;
the feature graphic is a 1024 x 500 JPEG or 24-bit PNG; screenshots are JPEG or 24-bit PNG, 320 to
3840 px on each side, the long side at most twice the short one, two to eight per device type, and
apps with at least four 9:16 screenshots of 1080 x 1920 or more can be featured. There are no
tablet screenshots; the listing works without them.

The captions and the tagline say what the app and the map do today. The map is the public web page
(<https://alexandreffaria.github.io/tem-sinal/>), not part of the app, so its screenshots show it
in a browser with that address and their captions say "no mapa do site".

## Where the pictures come from

No image holds real data. The app screens are rendered on the JVM by
`app/src/test/java/dev/meuquerido/cellsignalmapper/StoreScreensTest.kt` from made-up state: a
position in the forest, invented signal readings and invented recordings. The map screenshots are
the page in `map/public/` served by `map/serve.js` with the cells `store/fixtures.mjs` makes up:
four invented trails in the Serra do Mar forest between Angra dos Reis and Mangaratiba, away from
any road or building, with invented counts for TIM, Claro and Vivo. The background map is
OpenFreeMap (OpenStreetMap data), with its attribution in view. `store/render.mjs` draws the
frames, captions and feature graphic in headless Chrome (`store/chrome.mjs`).

The icon is the app's launcher icon, the map's mark: the favicon's signal bars, white over
`#2c7bb6` and a mountain ridge. Its one source is the adaptive icon's layers,
`app/src/main/res/drawable/ic_launcher_background.xml` and `ic_launcher_foreground.xml`;
`StoreScreensTest` renders the middle 72 dp of them, the part a launcher shows, at 512 px.

## Rendering them again

Run `scripts/store-assets.sh` from the repository root. It needs what `scripts/check.sh` needs,
Google Chrome (`CHROME` names another Chromium binary) and the internet, for the background map
and the Inter font. It overwrites the PNGs in `store/`; look at each before committing.
