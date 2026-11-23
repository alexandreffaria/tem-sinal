# Tem Sinal

An Android app that crowdsources cell signal across Brazil, so anyone heading into the backcountry
can see where each carrier has signal before they go.

Download the latest signed APK from [Releases](https://github.com/alexandreffaria/tem-sinal/releases/latest).

## The map

`map/public/` is the public map, at <https://alexandreffaria.github.io/tem-sinal/>: a static
page that reads the published cell files from the Storage bucket and labels each carrier in each
cell, shading cells with signal by how strong it is (`map/public/label.js`). The Pages workflow publishes it to GitHub Pages on each merge to
`main` that changes `map/public/`. To try it with the
made-up cells in `map/fixtures/tiles/`, run `npm start` in `map/` and open the link it prints;
on `localhost` the page fetches tiles from that server instead of the bucket. `npm test` in
`map/` tests the labelling rule and the shading.

The background map is [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap data): free, with
no API key and no limit on map views, and commercial use allowed, as long as the attribution
MapLibre shows stays.

## Fonts

The app bundles [Space Grotesk](https://github.com/floriankarsten/space-grotesk) SemiBold and
[Inter](https://github.com/rsms/inter) Regular and Medium (`app/src/main/res/font/`), under the
SIL Open Font License 1.1 (`docs/fonts/`). They are the static weights instanced from the variable
fonts in [google/fonts](https://github.com/google/fonts) and subset to Latin.
