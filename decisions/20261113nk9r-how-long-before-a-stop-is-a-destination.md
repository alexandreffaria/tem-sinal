---
id: "20261113nk9r"
title: How much travel must a session show before a stop counts as a destination rather than a possible home?
status: open
kind: choice
priority: normal
created: 2026-11-13T14:27:13Z
created_by: claude-code
tags: [privacy, map, trim]
depends_on: []
recommendation:
  option: five
  why: >-
    Five minutes is three times the 100 s glide that broke the current rule, so a slower or longer
    glide is still covered. Its cost falls on crags within about 1.4 km of where people start
    logging on foot; crags further out on a walk without long rests, and sessions that start with a drive, are almost unaffected. Pick
    two minutes if you expect most crags on the map to be short walks from the road and accept a
    thinner margin. Nobody has measured how long such glides last on real phones.
options:
  - id: two
    title: Two minutes of travel (24 fixes)
    summary: A stop is hidden as a possible home only until the phone has had 24 moving fixes (two minutes at one every 5 s) outside the trim of where the session started or ended.
    pros:
      - Smallest extra loss. A crag reached on foot is kept from about 340 m further out than today.
      - Still covers the 100 s glide behind issue 122, with about 20 % to spare.
    cons:
      - Weakest protection. Wrong fixes that glide or wander for two minutes before the phone's first good fixes at home can leave home on the map.
      - Nobody has measured how long such glides last, so the margin may be thinner than it looks.
  - id: five
    title: Five minutes of travel (60 fixes), as built
    summary: "The same with 60 moving fixes (five minutes); pull request #123 uses this."
    pros:
      - Three times the 100 s glide, so a glide two or three times longer is still covered.
      - Nothing more to change; the code and its tests are written for it.
    cons:
      - A crag reached on foot is kept only from about 540 m further out than today (from 860 m instead of 320 m from the car with the shortest trim, from 1360 m instead of 820 m with the longest).
  - id: ten
    title: Ten minutes of travel (120 fixes)
    summary: The same with 120 moving fixes (ten minutes).
    pros:
      - Six times the 100 s glide; wrong fixes would have to look like ten minutes of travel to leave home on the map.
    cons:
      - A crag reached on foot is kept only from about 900 m further out than today (1220 m to 1720 m from the car, by trim).
      - A crag 1.5 km or less from the car disappears from most sessions that start and end there.
feedback:
  - at: 2026-11-13T16:55:02Z
    type: note
    note: the problem I have with this is that I do want precise location, so we can pinpoint trails, and maybe even routes with the gps altimeter, and I totally get the privacy problems, we should do all we can to make sure nothing is tracable to individuals. The way I naturally thought about it is having the only big button, that you click when you DO want to send the information, if someone turns it on indoors, we can tell them, hey we suggest you use this in the trail for privacy and signal reasons, but make it clear to them that their ping is annonymized and will not be able to be used to identify who the user is, maybe show the actual json package info that we are actually grabbing. the point of the app is a community service, not a product.
---

## Context

Each session loses 300 to 800 m (a random length drawn for each end) around where it starts and
ends, so the public map never shows where someone lives or parks (card `20261113a7do`). Indoors,
a phone's first location fixes are often wrong, and Android's location smoothing can glide from
the wrong place to the right one in steps that look like ordinary travel. The current rule in
`functions/src/aggregate.ts` (`trimSession`) cuts around the first fixes and around fixes that
follow an impossible jump. A made-up glide (10 minutes 1 km off, 100 s gliding home at 36 km/h,
10 minutes at home) still left 169 to 238 samples within the trim of home, the nearest 0 m from
it (issue #122).

Pull request #123 (issue #122) replaces that rule. It finds every **stay** (three minutes or
more of fixes within 50 m, or ten minutes within 200 m for a phone indoors whose fixes stray up
to 100 m) and hides the trim length plus the stay's spread plus 25 m (or 100 m for the ten-minute kind) around every stay that
starts before the phone has **travelled**: had a set number of fixes that are in no stay and lie outside the trim
of where the session started. Home is then hidden whatever wrong fixes come first, unless those
wrong fixes themselves add up to that much travel. A stay after that point counts as a
destination, such as a crag, and is kept.

That number is the decision. It sets both how much wrong-fix travel the rule withstands and how
far from the car a crag must be to reach the map when someone starts or stops logging at the
car. Measured on made-up sessions (a still start, a walk at 1.2 m/s, two hours at the crag, the
walk back), the crag is kept from this distance from the car. The crag's own ten-minute stay
starts up to 200 m before it, where the approach comes within 200 m, so the travel must be
complete 200 m before the crag. Rests of three minutes or more
during the travel count as stays and are hidden too, which widens the cut at longer trims under every option
("Today's rule" is shown for comparison only: it leaves home on the map in the glide case):

| Travel before a stop counts as a destination | Trim 300 m | Trim 800 m |
|---|---|---|
| Today's rule | 320 m | 820 m |
| Two minutes | 660 m | 1160 m |
| Five minutes | 860 m | 1360 m |
| Ten minutes | 1220 m | 1720 m |
| Two minutes, a 3-min rest every 10 min of walking | 660 m | 1720 m |
| Five minutes, a 3-min rest every 10 min of walking | 860 m | 1940 m |
| Ten minutes, a 3-min rest every 10 min of walking | 1280 m | 2360 m |

Under every option, a walk slower than 0.33 m/s (200 m in ten minutes) reads as one stay after
another and never counts as travel, so such a session keeps nothing around its stays.

The travel is counted in fixes, that is in time, not distance: a 1 km wrong glide covers a lot of
distance in little time, so a distance rule would not stop it. The distances above therefore
scale with speed: at 2 m/s, five minutes is 600 m of travel rather than 360 m.

Both ends draw their own trim, so a session that starts and ends at the car keeps the crag only
if both draws are short enough. Share of such sessions that keep a crag at each distance (walking,
no long rests):

| Crag from the car | Today | Two minutes | Five minutes | Ten minutes |
|---|---|---|---|---|
| 700 m | 58 % | 1 % | 0 % | 0 % |
| 1 km | 100 % | 46 % | 8 % | 0 % |
| 1.5 km | 100 % | 100 % | 100 % | 31 % |
| 2 km | 100 % | 100 % | 100 % | 100 % |

Sessions that start at home and drive to the crag lose almost nothing more, since a drive covers
the travel long before it reaches the crag. Every crag is still on the map from any session
that passes by or starts far enough away.

## Option two: Two minutes of travel (24 fixes)

`DEPARTURE_FIXES = 24` in `functions/src/aggregate.ts`. A crag 1 km walk from the car shows up
from about half the sessions that start and end there.

## Option five: Five minutes of travel (60 fixes), as built

`DEPARTURE_FIXES = 60`. A crag 1 km walk from the car shows up from about one in twelve sessions
that start and end there; one 1.5 km away, from all of them.

## Option ten: Ten minutes of travel (120 fixes)

`DEPARTURE_FIXES = 120`. A crag 1.5 km walk from the car shows up from about one in three
sessions that start and end there.

## Sources

- Issue #122 ("Found in review of #121") for the glide, and the reviews on pull request #121 for
  the earlier wrong-fix cases.
- `docs/decisions.md`, 2026-11-13: "randomised trimming of each session's ends", and
  `functions/src/aggregate.ts`: `TRIM_M = { min: 300, max: 800 }`.
- `functions/src/aggregate.ts` in pull request #123: `export const DEPARTURE_FIXES = 60;`,
  `STAYS = [{ fixes: 36, radiusM: 50 }, { fixes: 120, radiusM: 200 }]`, and a stay's cut
  `radiusM: trimM + spreadM + stay.radiusM / 2`.
- The distances are from made-up sessions run through `trimSession` before and after the change.
