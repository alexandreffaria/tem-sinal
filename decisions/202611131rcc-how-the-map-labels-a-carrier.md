---
id: "202611131rcc"
title: How should the public map label a carrier at a spot where readings disagree?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T15:27:40Z
created_by: claude-code
tags: [product, safety, map]
depends_on: []
recommendation:
  option: reliable
  why: >-
    Reliable, with the counts made fair (#130, #131) before the map (#17) ships, an order the
    agents will keep. Reliable labels a spot signal only when nearly every reading had service,
    and one stray reading can't relabel a spot that worked 199 times out of 200, which worst
    would. If you'd rather not depend on that fix, worst is the option that can't drift
    towards signal while in-service readings are over-counted. The 90% is a guess to tune
    once there is real data.
options:
  - id: majority
    title: The state most readings saw, a tie going to the worse state
    summary: >-
      Signal, emergency calls only or no signal, whichever has the most readings; a tie goes to
      no signal over emergency calls only over signal.
    pros:
      - Easy to explain ("what most people saw").
      - One stray reading never changes the label of a well-measured spot.
      - Ties, common with few readings, err the safe way.
      - Needs no number to tune.
    cons:
      - >-
        Most means more than either other state, not more than half, so 34 / 33 / 33 is signal
        although 66% of readings had no normal service.
      - Leans towards signal where people stop or move slowly, since the phone then logs in-service readings more often than others (see Context).
  - id: worst
    title: The worst state any reading saw
    summary: >-
      No signal if any reading had no service, else emergency calls only if any reading was
      emergency-only, else signal.
    pros:
      - Never shows signal where a counted reading was without it.
      - Needs no number to tune.
      - The only option not skewed by phones at rest logging in-service readings more often (see Context); safe even before the counts are made fair.
    cons:
      - One stray reading with its cells known (a handover, a step into a gully) downgrades a spot that worked 199 times out of 200.
      - Busy spots collect stray readings, so the more a spot is measured, the worse it looks; the map would likely show little signal where people go often.
      - People who learn the map understates coverage may stop trusting it, also where it is right.
  - id: reliable
    title: The best state at least 90% of readings reached
    summary: >-
      Signal if at least 90% of readings were in service; else emergency calls only if at least
      90% were in service or emergency-only (a phone in service can also make emergency calls);
      else no signal.
    pros:
      - Signal and emergency calls only each hold for at least 9 readings in 10.
      - A few stray readings don't change a well-measured spot.
      - The bar can be raised or lowered once there is real data.
    cons:
      - Still shows signal where up to 10% of readings had no service on this carrier, not even emergency-only (90 / 0 / 10 is signal).
      - The 90% is a guess; nothing measured yet says it is the right bar.
      - Understates spots that mostly work. 85 / 0 / 15 is no signal, though 85% of readings had service, and 80 / 20 / 0 is emergency calls only.
      - Leans towards signal where people stop or move slowly, like majority, though it shows signal only where majority would too and needs a far larger over-count to flip a spot (see Context).
  - id: shares
    title: No single label; show each state's share
    summary: >-
      Each cell shows the three shares (in service, emergency only, no service) as a small bar
      or a blended colour, and a tap shows the counts.
    pros:
      - Hides nothing; "mostly emergency-only, sometimes signal" is visible as it is.
      - No rule or number to choose or defend.
    cons:
      - Harder to read at a glance on a phone, especially for someone who isn't technical.
      - A mixed colour or bar per carrier per cell is hard to draw clearly and to explain in a legend in two languages.
      - Leaves the safety judgement to each reader, who may read a 60% bar as "there is signal".
      - The shares carry the same lean towards in-service readings where people stop or move slowly (see Context).
resolution:
  choice: reliable
  resolved_at: 2026-11-13T17:13:07Z
---

## Context

The public map (#17) shows, for each carrier in each map cell (about 50 m across), whether there
is signal, emergency calls only, or no signal. People will use it to decide whether they can call
for help from a crag or a trail, and whether to bring a satellite messenger.

The app checks about every 5 seconds, so a cell holds from a few readings (a walker crosses it in under a minute) to many, and they can disagree. Pull
request #132 (open) gives the published cell file three counts per carrier that don't overlap (`docs/sample-schema.md`,
**Public cells**):

- `serviceN`: readings in service (registered on a cellular network) whose cells are known;
- `emergencyN`: readings where only emergency calls work;
- `noServiceN`: readings with no service, counted only when the modem also reported its cells
  (an out-of-service reading whose cells are unknown isn't counted).

The strength figures (`best`, `median`) come from in-service readings only. What isn't decided
is which single label the map shows from the three counts. Until now the format said "signal when
`best` is not null", which the review of #128 found errs the dangerous way: one
in-service reading at -120 dBm next to 200 emergency-only ones would show as signal. That review filed
#129, which proposed the majority option below; #132 does its data part (the counts), and the
rule waits for this card.

The two mistakes don't cost the same. Showing signal where calls usually fail can leave someone
unable to call for help when they counted on it. Showing emergency calls only or no signal where
calls usually work costs a satellite messenger carried for nothing, or trust in the map.

Fixed whatever you choose:

- The label is worked out from the published counts by the map page (#17, not built yet), so it
  can be changed later without changing the server or the published files.
- Every option can also show the three counts when a cell is tapped.
- How few readings is too few to label a cell at all is a separate question.

**A reading is not a fixed slice of time.** The app skips a tick that repeats the last sample:
the phone moved at most 10 m and every SIM has the same service state, registered cells and
strength. The 10 m is measured from the last sample logged, so a phone moving faster than about
2 m/s logs every tick, and a slower one (walking uphill, climbing, at rest) logs only when it has
moved 10 m or something changed (GPS jitter of more than 10 m counts as a move, so a phone under
poor sky logs often in any state). In service, the strength likely changes from tick to tick, so
the phone keeps logging. Emergency-only or out of service, it logs as often only when the modem
reports the cell it is camped on as registered, with a strength, or when another SIM in the same
phone is in service; otherwise nothing changes and it logs less. Where that happens on slow
stretches and at stops in the middle of a session (a crag, a summit; a session's first and last
few hundred metres and the stops there are cut out before counting), in-service readings are
over-represented, which pushes the majority, reliable and shares options towards signal,
the dangerous direction; worst seen isn't affected. How large this is hasn't been measured.
Making the counts fair across states is a separate fix (#131).

Two other leans come from readings whose cells are unknown (the modem didn't answer in time; how
often is unmeasured): an emergency-only one counts, but an in-service or out-of-service one
doesn't. That leans away from signal (the safe way) and away from no signal. #130 will count the
in-service ones, removing the first of those, so the counts move a little towards signal.

Examples, for one carrier in one cell (signal / emergency only / no service readings):

| Readings | majority | worst | reliable (90%) | shares |
|---|---|---|---|---|
| 1 / 200 / 0 | emergency only | emergency only | emergency only | 0.5% / 99.5% / 0% |
| 120 / 80 / 0 | signal | emergency only | emergency only | 60% / 40% / 0% |
| 199 / 0 / 1 | signal | no signal | signal | 99.5% / 0% / 0.5% |
| 95 / 0 / 5 | signal | no signal | signal | 95% / 0% / 5% |
| 85 / 0 / 15 | signal | no signal | no signal | 85% / 0% / 15% |
| 34 / 33 / 33 | signal | no signal | no signal | 34% / 33% / 33% |
| 50 / 0 / 50 | no signal (tie) | no signal | no signal | 50% / 0% / 50% |
| 10 / 10 / 0 | emergency only (tie) | emergency only | emergency only | 50% / 50% / 0% |
| 3 / 0 / 0 | signal | signal | signal | 100% / 0% / 0% |

(Shares are rounded to 0.5%; 1 of 201 is 0.5%, 200 of 201 is 99.5%.)

## Option majority: The state most readings saw, a tie going to the worse state

```
label = the state with the most readings
tie   → no signal, then emergency calls only, then signal
```

A trailhead with 199 in-service readings and one stray reading without service shows as signal.
A crag with 120 in-service and 80 emergency-only readings shows as signal too, though two
readings in five could only make emergency calls.

## Option worst: The worst state any reading saw

```
noServiceN > 0  → no signal
emergencyN > 0  → emergency calls only
otherwise       → signal
```

A crag where 120 readings had service and 80 only emergency calls shows as emergency calls only,
so nobody counts on a normal call there. A trailhead with 199 in-service readings and one
without service, from a phone briefly losing the network, shows as no signal.

## Option reliable: The best state at least 90% of readings reached

```
total = serviceN + emergencyN + noServiceN
serviceN ≥ 0.9 × total               → signal
serviceN + emergencyN ≥ 0.9 × total  → emergency calls only
otherwise                            → no signal
```

The trailhead with 199 / 0 / 1 shows as signal; the crag with 120 / 80 / 0 shows as emergency
calls only, since every reading there could at least make an emergency call. A spot with 85
in-service readings and 15 without service shows as no signal, though most readings had service.

A variant you can ask for in a note: when no state reaches 90%, show a fourth label, "patchy",
instead of the lower one, so 85 / 0 / 15 reads "patchy" rather than "no signal". It keeps the
three labels where readings agree and says so where they don't, at the cost of a fourth legend
entry whose safe reading ("don't count on it") has to be spelled out.

## Option shares: No single label; show each state's share

Each carrier's cell is drawn with its three shares, for example a cell that is 60% green
(signal), 40% amber (emergency only), and a tap shows "120 signal, 80 emergency only, 0 no
service". The legend explains the colours instead of three labels.

## Sources

- `docs/sample-schema.md`, **Public cells**: "The three counts don't overlap: each counted
  reading is in exactly one of them"; "how the map labels a carrier from the counts is the
  map's rule".
- `docs/sample-schema.md`: "A tick repeats the last sample logged, and is skipped, when the fix
  moved at most 10 m".
- `app/src/main/java/dev/meuquerido/cellsignalmapper/LoggerState.kt`: "A sample repeats
  [previous] when the phone moved at most [MIN_MOVE_M] and every SIM has the same service state
  and the same registered cells at the same headline strength."
- `app/src/main/java/dev/meuquerido/cellsignalmapper/LoggerState.kt`, `coverage()`: compares
  `cells?.filter { it.registered }` with each cell's `headlineDbm()`, whatever the service state.
- `app/src/main/java/dev/meuquerido/cellsignalmapper/LoggerService.kt`:
  `LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L)`.
- `functions/src/aggregate.ts`, `accumulate`: "Each such reading adds one to the count of its
  service state. Only an `IN_SERVICE` reading adds a strength and a network type".
- [#129](https://github.com/alexandreffaria/CellSignalMapper/issues/129), which proposed the
  majority rule, [#130](https://github.com/alexandreffaria/CellSignalMapper/issues/130), on
  in-service readings whose cells are unknown, and [#131](https://github.com/alexandreffaria/CellSignalMapper/issues/131),
  on making the counts fair across states.
- `functions/src/aggregate.ts`: `CELL_RESOLUTION = 11`, "edge about 29 m", so about 50-58 m
  across.
- [Review of #128](https://github.com/alexandreffaria/CellSignalMapper/pull/128#issuecomment-6857333433): "one in-service
  reading at -120 dBm outweighs 200 emergency-only ones".
