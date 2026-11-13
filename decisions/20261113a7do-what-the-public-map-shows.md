---
id: "20261113a7do"
title: How should the public map handle cells that only one person has logged?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T00:28:15Z
created_by: claude-code
tags: [privacy, product, map]
depends_on: []
recommendation:
  option: monthly
  why: >-
    Remote crags are often logged by one climber, so a two-contributor threshold would hide the
    spots the map exists for. Showing single-contributor cells right away tells anyone watching the
    map which day that person was there. Monthly batches keep every crag on the map and blur a lone
    visit to a month. This depends on the guess that crags get few contributors, which isn't
    verified: the only data so far is one person in one city.
options:
  - id: immediate
    title: Show every cell right away
    summary: A cell appears in the next daily update after anyone logs it, whether one install or many contributed.
    pros:
      - A climber who logs a new crag can share it the same day.
      - The simplest aggregation; every cell is treated the same.
      - The freshest map, which matters after a new tower goes up.
    cons:
      - Anyone checking the map daily learns which day a lone contributor was at a spot, and a run of new cells shows their route.
      - A cell from one person with a precise date is the hardest case to call anonymised under LGPD art. 12.
      - The trim is the only protection for a solo contributor's home.
  - id: monthly
    title: Show single-contributor cells in monthly batches
    summary: A cell backed by two or more installs is updated daily; a cell backed by one install, including any later visits by that same install, is published only in the batch on the 1st of the month, once its first sample is at least 30 days old; a held cell that gains a second install still waits for the next batch.
    pros:
      - Every crag still shows up, including ones only one person logs.
      - A lone visit shows only as "some time in that month", even to someone watching every day.
      - Busy areas, with several contributors, stay fresh.
    cons:
      - A new crag logged by one person takes 30 to 60 days to appear.
      - A solo contributor's trail of cells is still visible, only blurred in time, and a cell that appears in a batch shows that one person had been there alone that month.
      - Needs a pseudonymous per-install id on the server to count contributors; it adds little beyond the raw samples the server already holds, but must never reach the public files.
  - id: threshold
    title: Show a cell only once two or more installs logged it
    summary: Cells backed by a single install never appear; a second install makes them public.
    pros:
      - Strongest protection; no public cell shows what one person did.
      - A cell backed by two people is less likely to be one bad reading.
      - The clearest case for counting as anonymised under LGPD art. 12.
    cons:
      - Remote crags, logged by one climber at a time, may never appear, which defeats the emergency-planning goal.
      - The map starts nearly empty while there are few contributors.
      - One person with two phones, or a reinstall, counts as two installs; the same per-install id as monthly is needed.
resolution:
  choice: monthly
  resolved_at: 2026-11-13T00:44:16Z
---

## Context

The public link has to answer "can I call or text from this spot, and on which carrier?" for
someone planning a climb. The raw samples reveal more: each one has exact coordinates, a time and
a cell ID, so a contributor's sessions show where they live, where they go and when.

**Today's baseline is the worst case.** `signal-heatmap`, a public repo, serves every raw point and
commits them in `data.json`, which stays in git history. There are 241 points from one session of about 14 hours,
in one city, inside an area under 1 km across, with millisecond timestamps and cell IDs: the shape
of a home. Publishing raw points isn't an option here: precise
location traces are personal data under LGPD, and Google Play would require the app's disclosure
and its Data safety form to say they are published.

Fixed in every option below, so not decided here:

- Raw samples stay private; only the aggregation job's output is public.
- Cells are H3 resolution 11: edge about 29 m, so about 50-57 m across (derived from the edge). That tells crag sectors and
  approach paths apart. No 2D cell captures differences with height on a wall.
- A cell shows, per carrier, the best and median strength, the network type, whether
  emergency-only service was seen, the sample count, and the month last seen. No exact times.
- Public cells change at most once a day, so a change in a busy cell gives the day of some visit
  but not whose.
- The start and end of every logging session are dropped before aggregation. The length is
  randomised per session (300 to 800 m to start) so a trail's end is a poor pointer to a home, as
  with Strava's "hide start and end" setting. It is a parameter to tune.

This card decides only how cells logged by a single install are handled. Variants (say, showing
them at a coarser resolution, or without strength values) can come from a "neither" answer.

## Option immediate: Show every cell right away

One public cell (made-up values):
`{"h3": "8b…", "carriers": {"TIM": {"best": -97, "median": -103, "tech": "LTE", "n": 12}}, "emergencyOnlySeen": true, "lastSeen": "2026-01"}`

## Option monthly: Single-contributor cells in monthly batches

The same cell, held until it is 30 days old and published on the next 1st of the month.

## Option threshold: Two or more installs

The same cell, left out of the public files until a second install logs it.

## Sources

- [H3 resolution table](https://h3geo.org/docs/core-library/restable/): average edge 28.66 m at resolution 11.
- [LGPD, Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): art. 5 I, personal data is "informação relacionada a pessoa natural identificada ou identificável" (that precise location traces qualify is an interpretation); art. 12, anonymised data is outside the law unless it can be reversed with reasonable effort, and §2 treats data used to profile a person's behaviour as personal.
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) and the [Data safety form](https://support.google.com/googleplay/android-developer/answer/10787469).
- [DC Rainmaker on Strava's privacy features](https://dcrainmaker.com/2021/08/privacy-features-options.html): "hide start and end".
