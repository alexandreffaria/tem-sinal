---
id: "20261113mua9"
title: How much detail along trails may the public map show?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T17:29:03Z
created_by: claude-code
tags: [privacy, product, map]
depends_on: []
recommendation:
  option: today
  why: >-
    Keep resolution 11 public for now, with the private state kept at resolution 12 so nothing is
    lost, and come back to this once several people log the same trails. A
    resolution 11 chain already shows where a trail runs, to within about 50 m. With the only
    data so far from one person in one city (card 20261113a7do), a three-install rule would show almost nothing, and resolution
    12 for everyone would sharpen mostly lone contributors' routes. Pick fine if pinpointing trails
    now matters more to you than drawing a lone hiker's route at 20 m instead of 50 m; pick
    crowded if you expect a group to start logging the same crags soon.
options:
  - id: today
    title: Keep resolution 11 cells only
    summary: Resolution 11 cells (about 50-57 m across) with per-carrier statistics and the month last seen, as settled, plus one server change; the server keeps its private statistics per resolution 12 cell and publishes their resolution 11 parents, so a later switch loses nothing.
    pros:
      - Nothing new is published; the privacy review of card 20261113a7do still covers everything public. The one change is server-side, in `accumulate` and `publish`, as a new issue before issue 108 ships.
      - A walked trail already shows as a chain of cells with signal figures, about 50 m wide.
      - The map page (not built yet) can draw mapped trails, such as OpenStreetMap paths, under the cells, giving a line to follow with no data from contributors.
    cons:
      - Signal can't be told apart on trails or crag sectors less than about 50 m apart.
      - A basemap shows only trails someone has mapped, not where people actually go.
      - The private state, kept with no end date and listing which installs were in each cell each month, would then place each install to about 20 m instead of 50 m; only aggregates are public, but a leak or a legal request would show more. The same holds for fine, crowded and lines.
      - "Keeping the private state at resolution 12 costs about 2.5 to 3 times more private state along walked tracks (up to seven times over a densely covered area), and a few samples near cell edges roll up to a neighbouring resolution 11 cell. Without it (say so in a note if you prefer), a later switch could show finer detail only for the last 90 days of raw samples and after."
      - A chain of cells is not a line you can follow on the ground.
  - id: fine
    title: Resolution 12 cells everywhere, under today's rules
    summary: Cells become resolution 12 (about 19-22 m across), with the same rules as today; daily with two or more installs, single-install cells only in the monthly batch.
    pros:
      - Trails 20 to 50 m apart and the sectors of a crag show separately right away, everywhere anyone has logged.
      - No new rule; the same kind of exposure as today, only sharper.
      - Simplest of the finer options; one resolution in the files and on the map.
    cons:
      - A lone hiker's route shows at about 20 m instead of 50 m, blurred to the month.
      - Each cell's figures are less certain, and about seven times as many cells over an area (2.5 to 3 times along a walked track), with correspondingly fewer readings per cell.
      - Draws informal or closed paths, and paths across private land, more sharply.
  - id: crowded
    title: Resolution 12 cells only where at least three installs logged
    summary: Resolution 11 stays everywhere; a resolution 12 cell is also published, in the monthly batch, once at least three different installs have samples in it.
    pros:
      - Trails 20 to 50 m apart, and the sectors of a crag, show separately where several people have been.
      - When a fine cell first appears, no single contributor can subtract their own readings from that fine cell's figures and read off another's, which two installs allow.
    cons:
      - A party of three logging together passes the rule, so its shared route appears at about 20 m; climbers often go in twos and threes. One person with three phones passes it too.
      - Once a fine cell is public, comparing two monthly files shows what changed that month; if one install alone came back, that change is its readings and the fine cells that changed together trace its route. Closing that needs a three-install rule on each month's change too. Resolution 11 cells seen by two or more installs have the same weakness today, with daily files.
      - Subtracting a coarse cell's published fine cells from it gives the counts of its unpublished fine cells, which places one or two installs' readings more sharply than 50 m (roughly, since fine cells don't tile a coarse one exactly).
      - A second set of private cell state per resolution 12 cell, two resolutions in the public files and on the map page; quiet trails stay at resolution 11.
  - id: lines
    title: As crowded, plus trail lines drawn from many tracks
    summary: As crowded, plus lines through runs of adjacent resolution 12 cells where each step between two cells was made by at least three installs, published in the monthly batch.
    pros:
      - A line you can follow, which is what pinpointing trails asks for.
      - A step only one or two installs made never becomes part of a line.
    cons:
      - The most work by far, a new aggregation step that joins tracks that never overlap exactly, and a new private store of per-install cell-to-cell steps kept beyond the 90 days of raw samples.
      - The same month-to-month comparison as crowded applies to the steps, and lines stitched from steps can follow one party's whole route when the same three installs made every step.
      - A line shows the way people actually go, including informal or closed paths and paths across private land, which a land owner or park may object to; where it ends near a road, it points at where people park.
resolution:
  choice: today
  resolved_at: 2026-11-13T18:43:24Z
---

## Context

Your note on card `20261113nk9r` (2026-11-13) says you want precise location, "so we can pinpoint
trails, and maybe even routes with the gps altimeter", while making sure "nothing is tracable to
individuals". The precise location is already collected: each sample has the fix rounded to 5
decimal places (about 1.1 m) and its accuracy (`docs/sample-schema.md`, **Fix**). What is decided
is what the public map shows, and that is settled narrower than trails (card `20261113a7do`,
`docs/decisions.md`):

- H3 resolution 11 cells, edge about 29 m, so about 50-57 m across;
- per carrier, the best and median strength, the network type and the counts of readings in
  service, emergency-only and out of service; and the month last seen;
- raw samples never public, session ends trimmed, a cell seen by two or more installs updated
  daily unless it was first held (so a change shows the day of some visit, not whose), and a cell seen by only one install
  published only in the monthly batch, once its first sample is 30 days old.

So a trail shows only as the chain of resolution 11 cells along it. Whatever is chosen here, the
map page (issue 17, not built yet) can also draw mapped trails from a public basemap such as
OpenStreetMap, which adds no contributor data. This card asks whether to
show trails in more detail. Every option publishes only aggregates, keeps raw samples private,
applies the same trim, and publishes no install id or session. The figures in a public cell are
running totals over all months, so anyone comparing two published files sees what was added in
between; that is true of today's cells and of every option. The detail grows from top to
bottom, and with it how sharply any one person's or party's movements can show, and how sharply
informal paths are drawn.

"Three installs" in crowded and lines counts different installs over all time in that cell or
step, and a fine cell waits the same 30 days as a single-install cell before its batch. Why three:
with two installs, either contributor can subtract their own readings and learn the other's; with
three, no single contributor can isolate another's. Today's daily rule for resolution 11 cells
uses two and has that weakness; it is not reopened here.

If "routes" means climbing routes up a wall, no option reaches them: a phone's fix is metres off,
and a wall's foot and top often share a cell (already noted on card `20261113a7do`). Altitude on
the map is a separate question, card `2026111304re`. The rest of your note (the big button, the
indoor hint, showing the data sent) is in card `20261113og4j` and issues 155 to 158.

## Option today: Keep resolution 11 cells only

A public cell, as today (made-up values):
`{"h3": "8b…", "carriers": {"72406": {"best": -97, "median": -103, "tech": "LTE", "serviceN": 40, "emergencyN": 3, "noServiceN": 0}}, "lastSeen": "2026-10"}`

## Option fine: Resolution 12 cells everywhere, under today's rules

The same object with a resolution 12 `h3` ("8c…"); `CELL_RESOLUTION = 12` in
`functions/src/aggregate.ts`, and nothing else in the code changes while no cells are published yet
(issue 108 is open); after that, older cells can't be re-split unless the private state
was kept at resolution 12 (as option today proposes).

## Option crowded: Resolution 12 cells only where at least three installs logged

Resolution 11 cells as today, plus a separate monthly file of resolution 12 cells ("8c…") with
the same figures; the map page would draw fine cells over coarse ones where they exist.

## Option lines: As crowded, plus trail lines drawn from many tracks

As crowded, and a separate monthly file of lines, each a list of resolution 12 cell ids in order:
`{"line": ["8c…", "8c…", "8c…"]}`, drawn through the cells' centres, with no times and no
install count beyond "three or more".

## Sources

- `docs/decisions.md`, 2026-11-13: "Fixed for every cell: H3 resolution 11, per-carrier statistics
  and the month last seen, randomised trimming of each session's ends, raw samples never public."
- `functions/src/aggregate.ts`: `CELL_RESOLUTION = 11`, "edge about 29 m"; `PublicCell` has
  `h3`, `carriers` and `lastSeen` only; `LONE_CELL_AGE_MS = 30 * 86_400_000`; `publish` merges a
  cell's months (`merge(Object.values(cell.months))`).
- `docs/sample-schema.md`, **Fix**: "rounded to 5 decimals (about 1.1 m)".
- [H3 resolution table](https://h3geo.org/docs/core-library/restable/): average edge 28.66 m at
  resolution 11, 10.83 m at resolution 12; average area about 2150 m² and 307 m² (a seventh of
  the area).
