---
id: "2026111304re"
title: Should the public map show altitude, and from where?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T17:32:25Z
created_by: claude-code
tags: [privacy, product, map]
depends_on: []
recommendation:
  option: model
  why: >-
    A public terrain model made for South America (ANADEM) gives ground height everywhere, logged
    or not, with vegetation removed, a free licence and no data from anyone.
    Phone medians would add a figure measured where people stand, but at one value per 50 m cell,
    from phones whose single readings can be metres to tens of metres off. Both need server work:
    the model's tiles built and hosted; for phone, an extra histogram in the existing per-cell
    store and a geoid grid. Pick phone or both if
    you want the map to rest on the community's own measurements, or if ANADEM turns out wrong in
    the places you know.
options:
  - id: none
    title: No altitude on the map
    summary: The map shows signal only, as settled.
    pros:
      - Nothing to build, and nothing new published.
      - Hikers already read altitude from the topographic maps and apps they plan with.
    cons:
      - Someone planning from this map can't see whether a spot with signal is on the ridge or in the valley below without another map.
  - id: model
    title: Ground height from a public terrain model
    summary: The map page shows contours or a hillshade from ANADEM (a 30 m South American terrain model with vegetation removed from Copernicus GLO-30) and, when a cell is tapped, the model's height at the cell's centre; nothing comes from the samples.
    pros:
      - No privacy cost at all; the figure comes from satellite data, not from anyone's phone.
      - Covers every place, logged or not, and is consistent from cell to cell.
      - Vegetation removed, so under forest it gives the ground, not the canopy (average error, as bias, 1.5 m against 9.6 m for raw GLO-30 in its paper; an average, not the error at each point).
      - Free under CC BY 4.0, with attribution on the map page.
    cons:
      - A 30 m grid smooths small features such as a narrow ridge crest or a boulder field, and its OpenTopography record warns that "localized striping or tiling artifacts may occur in limited areas".
      - Largely the same as the topographic maps and apps hikers already plan with.
      - Server-side preprocessing of a continent-scale 30 m raster into map tiles and a height per cell, and hosting them.
  - id: phone
    title: Median phone altitude per cell
    summary: Each public cell with at least 20 altitude readings (a proposed minimum against a few stray readings) also gets their median, converted to height above sea level and rounded to whole metres, published under the same rules as today's statistics.
    pros:
      - Measured by the community where people actually stand, such as on a ridge crest.
      - Uses data the app already records (`fix.altitudeM` and `fix.verticalAccuracyM`); no app change.
      - Outdoors, the height of a place is a fact about the ground, so it adds little about who was there.
    cons:
      - A single phone's altitude can be metres to tens of metres off (each sample records its own `verticalAccuracyM`), and one median per cell about 50 m across hides the relief inside it on steep ground.
      - "New server work: a running altitude histogram per cell and month in the private store (raw samples are deleted after 90 days), and a geoid grid to convert the app's ellipsoidal altitude."
      - Twenty readings is under 2 minutes of one phone at the app's 5 s interval, so a cell one person stopped in usually qualifies, and its altitude is that person's readings alone, whose errors move together, so the median doesn't average them out; an indoor stop mid-session (session ends are already cut) would hint at roughly how high someone logged.
  - id: both
    title: The model everywhere, the phone median where there are enough readings
    summary: As model, and a cell with at least 20 altitude readings also shows the phone median next to the model's height.
    pros:
      - Every place has a figure, and busy places also get one the community measured.
      - The two figures check each other; a big gap flags a model artifact or a bad cell.
    cons:
      - All of phone's server work plus the model layer.
      - Two heights that can disagree by several metres on one screen need explaining.
      - The same small privacy cost as phone.
resolution:
  choice: none
  resolved_at: 2026-11-13T18:44:33Z
applied_at: 2026-11-13T18:59:13Z
---

## Context

Your note on card `20261113nk9r` (2026-11-13) mentions "routes with the gps altimeter". The app
already records each fix's altitude and its vertical accuracy (`docs/sample-schema.md`, **Fix**:
"Altitude is ellipsoidal, not above sea level; Brazil's geoid separation is up to about 30 m, so
the server converts with a geoid model if it ever shows heights"). The settled public output
(card `20261113a7do`, `docs/decisions.md`) has no altitude: per-carrier signal statistics and the
month last seen per resolution 11 cell ("about 50-57 m across", card `20261113a7do`).

Other public models were considered for option model: raw Copernicus GLO-30 is free but is a
surface model, which reads partway into forest canopy; FABDEM removes forests and buildings but
is free only for non-commercial use (CC BY-NC-SA 4.0), and commercial use needs a paid licence
from Fathom; GEDTM30 is global and CC BY 4.0. ANADEM
is the one built and checked for South America.

This card asks only about altitude per place. How finely trails are drawn is card
`20261113mua9`; if it picks trail lines, either source here could give a line's elevation
profile. No option can follow a climbing route up a wall: a wall's foot and top often share a
cell, one figure per cell hides the difference, and a phone's vertical error is often as large as
a pitch.

## Option none: No altitude on the map

A public cell stays as today (made-up values):
`{"h3": "8b…", "carriers": {"72406": {"best": -97, "median": -103, "tech": "LTE", "serviceN": 40, "emergencyN": 3, "noServiceN": 0}}, "lastSeen": "2026-10"}`

## Option model: Ground height from a public terrain model

The signal statistics are unchanged; each cell file gains the model's height at the cell's centre,
and the map page draws contours from ANADEM tiles and shows "about 1180 m" (made-up) when a cell
is tapped, with the attribution in the page's footer.

## Option phone: Median phone altitude per cell

The same cell with `"altitudeM": 1184` (made-up), the median of its samples' altitudes after
the geoid conversion, present only once the cell has 20 altitude readings.

## Option both: The model everywhere, the phone median where there are enough readings

Tapping a cell shows "about 1180 m (map), 1184 m measured by phones" (made-up), or only the
first figure until the cell has 20 readings.

## Sources

- `docs/sample-schema.md`, **Fix**: `altitudeM` "m above the WGS84 ellipsoid", and the line quoted
  above.
- `app/src/main/java/dev/meuquerido/cellsignalmapper/Sample.kt`: `altitudeM` "Metres above the
  WGS84 ellipsoid, not above sea level"; `verticalAccuracyM` "Vertical accuracy in metres at 68 %
  confidence".
- `docs/decisions.md`, 2026-11-13: raw samples are deleted 90 days after the server receives them.
- [ANADEM, Laipelt et al., Remote Sensing 16(13):2321, 2024](https://www.mdpi.com/2072-4292/16/13/2321):
  "reducing average errors (BIAS) from 9.6 m to 1.5 m"; licensed CC BY 4.0 (OpenTopography
  catalogue record, which also warns "Localized striping or tiling artifacts may occur in limited
  areas of the ANADEM").
- [OpenTopography, 2 July 2026](https://opentopography.org/node/3617): announces ANADEM (South
  America) and GEDTM.
- [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM):
  "The Copernicus DEM is a Digital Surface Model (DSM) that represents the surface of the Earth".
- [FABDEM download](https://www.fathom.global/insight/fabdem-download/): "available under a
  commercial license or free for non-commercial use" (CC BY-NC-SA 4.0 for the free licence);
  [GEDTM30](https://codeberg.org/openlandmap/GEDTM30): CC BY 4.0.
