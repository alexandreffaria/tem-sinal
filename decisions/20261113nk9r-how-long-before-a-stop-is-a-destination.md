---
id: "20261113nk9r"
title: How much travel must a session show before a stop counts as a destination rather than a possible home?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T14:27:13Z
created_by: claude-code
tags: [privacy, map, trim]
depends_on: []
recommendation:
  option: five
  why: >-
    The big button and the indoor hint make a session that starts at home rarer, but they don't
    change what the trim must withstand when one does: someone who presses LOG indoors at home
    still gets the same wrong first fixes, and the hint is advice. This number is that
    protection, so it shouldn't shrink because the case got rarer. The hint also moves starts onto
    the trail, nearer the crag, so the crag-distance cost below is paid more often; this
    recommendation accepts that. Five minutes withstands a wrong glide
    home shorter than about 400 s from 2 km away (590 s from 1 km), four times the 100 s glide behind issue
    122, and costs only crags within about 1.4 km of where people start on
    foot (up to about 2 km with long rests); the trail beyond each end's cut is kept under every
    option. Pick two minutes if most crags you care about are short walks from the road and you
    accept a thinner margin. Gated would be the pick only if wrong fixes were measured to report a
    poor accuracy (the gate could also be added to five later, if so); even then, a session that ends indoors keeps only the 12-fix margin. Nobody has measured how
    long such glides last on real phones.
options:
  - id: gated
    title: One minute of travel (12 fixes), with the app recording only from a good fix
    summary: The app records nothing until it has a fix with an accuracy of 20 m or better, and a stop is hidden as a possible home only until the phone has had 12 moving fixes (one minute) outside the trim of where the session started or ended.
    pros:
      - The most kept near the car. A crag reached on foot is kept from 580 m at the shortest trim (1080 m at the longest), 60 m closer than two minutes.
      - Wrong indoor first fixes, the cause of issue 122, are expected to report a poor accuracy (unmeasured), and the app would not record those at all.
      - Goes one step past the hint in your note; someone who starts indoors records nothing until the phone has a good fix.
    cons:
      - Weakest server-side margin. If wrong fixes report a good accuracy, a glide home of 80 s from 2 km away, or 120 s from 1 km, leaves home on the map; a 100 s glide like issue 122's is withstood from 1 km but not from 2 km. Nobody has measured how accuracy behaves during such a glide.
      - The app drops the ticks before the first good fix, which changes the settled rule of one sample per tick with a fresh fix (2026-11-13); signal indoors before the first good fix is then never recorded.
      - Under forest canopy or in a deep valley a phone may take minutes, or never, to report 20 m or better; until it does, nothing is recorded there either (unmeasured).
      - The gate covers only the start; the end of a session, with STOP pressed indoors after the fixes have drifted, is protected by the 12 fixes alone.
      - Two changes to make and test, in the app and on the server, and the hint of issue 156 (which now says not to delay logging, and uses about 30 m) would change to match.
  - id: two
    title: Two minutes of travel (24 fixes)
    summary: A stop is hidden as a possible home only until the phone has had 24 moving fixes (two minutes at one every 5 s) outside the trim of where the session started or ended.
    pros:
      - Small extra loss. A crag reached on foot is kept from 640 m at the shortest trim (1140 m at the longest), 220 m closer than five minutes.
      - Withstands a wrong glide home shorter than about 160 s from 2 km away (230 s from 1 km), so the 100 s glide of issue 122 with room to spare.
      - The app-side measures make a home start rarer, so a thinner margin is risked less often.
    cons:
      - A wrong glide home of 160 s from 2 km away, or 230 s from 1 km, leaves home on the map.
      - Nobody has measured how long such glides last, so the margin may be thinner than it looks.
  - id: five
    title: Five minutes of travel (60 fixes), as built
    summary: The same with 60 moving fixes (five minutes); this is the code today.
    pros:
      - Withstands a wrong glide home shorter than about 400 s from 2 km away (590 s from 1 km), four times the 100 s glide of issue 122.
      - Nothing more to change; the code and its tests are written for it.
    cons:
      - A crag reached on foot is kept only from 860 m at the shortest trim (1360 m at the longest).
      - A crag 1 km from the car shows up from only about 7 % of the sessions that start and end there.
  - id: ten
    title: Ten minutes of travel (120 fixes)
    summary: The same with 120 moving fixes (ten minutes).
    pros:
      - Withstands a wrong glide home shorter than about 800 s from 2 km away (1200 s from 1 km), eight times the 100 s glide of issue 122.
      - The strongest protection for someone who presses LOG at home despite the hint.
    cons:
      - A crag reached on foot is kept only from 1220 m at the shortest trim (1720 m at the longest).
      - A crag 1.5 km or less from the car disappears from most sessions that start and end there.
feedback:
  - at: 2026-11-13T16:55:02Z
    type: note
    note: the problem I have with this is that I do want precise location, so we can pinpoint trails, and maybe even routes with the gps altimeter, and I totally get the privacy problems, we should do all we can to make sure nothing is tracable to individuals. The way I naturally thought about it is having the only big button, that you click when you DO want to send the information, if someone turns it on indoors, we can tell them, hey we suggest you use this in the trail for privacy and signal reasons, but make it clear to them that their ping is annonymized and will not be able to be used to identify who the user is, maybe show the actual json package info that we are actually grabbing. the point of the app is a community service, not a product.
seen_at: 2026-11-13T16:55:02Z
resolution:
  choice: five
  resolved_at: 2026-11-13T18:43:05Z
applied_at: 2026-11-13T18:59:10Z
---

## Your note, and what came of it

Rewritten after your note of 2026-11-13. Filed as work, since you asked for them outright:

- **#156**: after LOG, if the phone has no fix or a poor accuracy for most of the first minute,
  a dismissible hint suggests logging on the trail, for privacy and for the signal. Logging goes
  on; nothing is blocked or dropped.
- **#157**: a plain explanation on the main screen, in pt-BR and English, of what a sample holds
  and what is public (only totals per area and carrier; no app id, session, exact time or exact
  point). It calls the public map anonymous but not the raw samples, which carry a random app id
  that links one phone's samples, and so are personal data under LGPD.
- **#158**: a view of the exact JSON the app sends, built by the same code as the upload.
- **#155**: the app's text moves to string resources with pt-BR, which the three above need.

Two parts of the note are new cards rather than work, because they change a settled decision
or can be read more than one way:

- Cards `20261113mua9` (how much detail along trails: finer cells, trail lines) and
  `2026111304re` (altitude on the map), since "pinpoint trails ... routes with the gps
  altimeter" goes beyond the settled resolution 11 cells with signal statistics only.
- Card `20261113og4j`: when samples leave the phone. Today LOG records, "Send my data" sends,
  and the app also sends at every open; "the only big button" can mean LOG is the choice to
  share, or that nothing goes until the person sends it.

Precise location is not what this card limits. The app records each fix to about 1 m, and under
every option the trail beyond each end's cut is kept; the trim removes only the ends of a session
and stops near them (and, on a walk slower than 0.33 m/s, everything around its stays).

**What the trim still has to protect against.** The button and the hint make a start at home
rarer: people press LOG when they mean to, and those who start indoors are told to wait for the
trail. But people will still press LOG at home before leaving, or in the car at a trailhead, and
the hint is advice, not enforcement. When they do, the phone's first fixes are as wrong as before,
so what the server trim must withstand per session is unchanged; only how often it is tested
drops. The one app-side measure that would change it is not recording until the phone has a good
fix (option gated), and that rests on wrong fixes reporting a poor accuracy, which nobody has
measured. It and the hint act only at the start: a session that ends at home, with STOP pressed
indoors, is protected by the server count alone under every option. The hint also moves starts
onto the trail, nearer the crag, so the crag-distance cost below is paid more often than when
people started at the car or at home.

## Context

Each session loses 300 to 800 m (a random length drawn for each end) around where it starts and
ends, so the public map never shows where someone lives or parks (card `20261113a7do`). Indoors,
a phone's first location fixes are often wrong, and Android's location smoothing can glide from
the wrong place to the right one in steps that look like ordinary travel. A made-up glide (10
minutes 1 km off, 100 s gliding home at 36 km/h, 10 minutes at home) left samples within the
trim of home under the earlier rule, the nearest 0 m from it (issue 122).

Pull request 123 (issue 122), now merged, replaced that rule in `functions/src/aggregate.ts`
(`trimSession`). It finds every **stay** (three minutes or more of fixes within 50 m, or ten
minutes within 200 m for a phone indoors whose fixes stray up to 100 m) and hides the trim length
plus the stay's spread plus 25 m (or 100 m for the ten-minute kind) around every stay that starts
before the phone has **travelled**: had a set number of fixes that are in no stay and lie outside
the trim of where the session started. Home is then hidden whatever wrong fixes come first,
unless those wrong fixes themselves add up to that much travel. A stay after that point counts as
a destination, such as a crag, and is kept.

That number (`DEPARTURE_FIXES`, 60 today) is the decision. It sets both how much wrong-fix travel
the rule withstands (not every wrong fix counts: those near the wrong first fixes or within home's
stay don't, so a glide can last longer than the number's time) and how far from the car a crag must be to reach the map when someone starts
or stops logging at the car. Measured with today's code on made-up sessions (a minute still at
the car, a walk at 1.2 m/s, two hours at the crag, the walk back, a minute still at the car), the
crag is kept from this distance from the car. The crag's own ten-minute stay starts up to 200 m
before it, where the approach comes within 200 m, so the travel must be complete 200 m before the
crag. Rests of three minutes or more during the travel count as stays and are hidden too, which
widens the cut at longer trims under every option (distances to the nearest 20 m):

| Travel before a stop counts as a destination | Trim 300 m | Trim 800 m |
|---|---|---|
| One minute (option gated) | 580 m | 1080 m |
| Two minutes | 640 m | 1140 m |
| Five minutes (today) | 860 m | 1360 m |
| Ten minutes | 1220 m | 1720 m |
| One minute, a 3-min rest every 10 min of walking | 580 m | 1640 m |
| Two minutes, a 3-min rest every 10 min of walking | 640 m | 1720 m |
| Five minutes, a 3-min rest every 10 min of walking | 860 m | 1940 m |
| Ten minutes, a 3-min rest every 10 min of walking | 1280 m | 2340 m |

How long a wrong glide home (the issue 122 case, with the glide lengthened, at the shortest trim)
must last before home reaches the map; at the longest trim the margins are longer still:

| Travel before a stop counts as a destination | Glide from 1 km away | Glide from 2 km away |
|---|---|---|
| One minute (option gated) | 120 s | 80 s |
| Two minutes | about 230 s | 160 s |
| Five minutes (today) | about 590 s | 400 s |
| Ten minutes | about 1200 s | 800 s |

Under every option, a walk slower than 0.33 m/s (200 m in ten minutes) reads as one stay after
another and never counts as travel, so such a session keeps nothing around its stays.

The travel is counted in fixes, that is in time at one fix every 5 s, not distance: a 1 km wrong glide covers a lot of
distance in little time, so a distance rule would not stop it. The distances above therefore
scale with speed: at 2 m/s, five minutes is 600 m of travel rather than 360 m.

A tick reuses the last fix for up to 15 s, so one fix can appear in up to three samples, and the
count today counts each of them (issue 150, open, to be fixed whatever is chosen here). Until it
is fixed, wrong fixes that arrive only every 15 s reach each threshold with a third as many
fixes; once it is fixed, such fixes need three times as long (15 minutes for option five), and so
does a real departure under canopy where the phone gets a fix only every 15 s.

Both ends draw their own trim, so a session that starts and ends at the car keeps the crag only
if both draws are short enough. Share of such sessions that keep a crag at each distance (walking,
no long rests; trims drawn in 50 m steps):

| Crag from the car | One minute | Two minutes | Five minutes | Ten minutes |
|---|---|---|---|---|
| 700 m | 7 % | 3 % | 0 % | 0 % |
| 1 km | 67 % | 53 % | 7 % | 0 % |
| 1.5 km | 100 % | 100 % | 100 % | 30 % |
| 2 km | 100 % | 100 % | 100 % | 100 % |

Sessions that start at home and drive to the crag lose almost nothing more, since a drive covers
the travel long before it reaches the crag. Every crag is still on the map from any session
that passes by or starts far enough away.

## Option gated: One minute of travel (12 fixes), with the app recording only from a good fix

`DEPARTURE_FIXES = 12` in `functions/src/aggregate.ts`, and in `LoggerService.kt` a session
writes no sample until a fix reports `accuracy` of 20 m or better; from then on every tick with a
fresh fix is recorded as today. The hint of #156 would then also say that nothing is recorded
yet. The gate is independent of the count: it could also go with two, five or ten minutes (say
in a note if you want that).

## Option two: Two minutes of travel (24 fixes)

`DEPARTURE_FIXES = 24`. A crag 1 km walk from the car shows up from about half of the
sessions that start and end there.

## Option five: Five minutes of travel (60 fixes), as built

`DEPARTURE_FIXES = 60`. A crag 1 km walk from the car shows up from about 7 % of the sessions
that start and end there; one 1.5 km away, from all of them.

## Option ten: Ten minutes of travel (120 fixes)

`DEPARTURE_FIXES = 120`. A crag 1.5 km walk from the car shows up from about three in ten of the
sessions that start and end there.

## Sources

- Issue 122 ("Found in review of #121") for the glide, issue 150 for repeated fixes, and issue 156
  for the hint ("about 30 m"; "Don't stop, pause or delay logging").
- `docs/decisions.md`, 2026-11-13: "randomised trimming of each session's ends", and "The app logs
  a sample on every tick that has a fresh fix and an active subscription".
- `functions/src/aggregate.ts`: `TRIM_M = { min: 300, max: 800 }`, `DEPARTURE_FIXES = 60`,
  `STAYS = [{ fixes: 36, radiusM: 50 }, { fixes: 120, radiusM: 200 }]`, and a stay's cut
  `radiusM: trimM + spreadM + stay.radiusM / 2`.
- `app/src/main/java/dev/meuquerido/cellsignalmapper/LocationFix.kt`: `MAX_FIX_AGE_MILLIS = 15_000L`.
- The distances, shares and glide lengths are from made-up sessions run through today's
  `trimSession` with `DEPARTURE_FIXES` set to each option's value; the glide is the issue 122
  test case in `functions/src/aggregate.test.ts` with more steps.
