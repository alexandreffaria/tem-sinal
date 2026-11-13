# Decisions

Settled decisions, newest first. Each links the president card it came from (`decisions/`).

## 2026-11-13: The map labels a carrier by the best state 90% of readings reached

For each carrier in each cell, the public map shows signal, emergency calls only or no signal,
worked out on the map page from the published counts (`serviceN`, `emergencyN`, `noServiceN`):

```
total = serviceN + emergencyN + noServiceN
serviceN ≥ 0.9 × total               → signal
serviceN + emergencyN ≥ 0.9 × total  → emergency calls only
otherwise                            → no signal
```

A phone in service can also make emergency calls, so in-service readings count towards emergency
calls only. Signal and emergency calls only each hold for at least 9 readings in 10, and a few
stray readings don't relabel a well-measured spot: 199 / 0 / 1 is signal, 120 / 80 / 0 is
emergency calls only, 1 / 200 / 0 is emergency calls only, 85 / 0 / 15 and 34 / 33 / 33 are no
signal (signal / emergency only / no service). Tapping a cell shows the three counts. Issue #17.

The rule weighs the counts against each other, so it relies on the counts being fair across
states. The fixes that make them so have merged: every tick logs a sample at a fixed rate (#136,
merged as #145), and readings whose cells are unknown are counted in every state (#130 as #139,
#141 as #144), as designed in #131 (merged as #137).

**Why not the others.** *Majority* (the state most readings saw) shows 34 / 33 / 33 as signal
although two readings in three had no normal service. *Worst seen* shows a spot that worked 199
times out of 200 as no signal, so the busiest spots would look worst. *Shares* (three shares per
cell, no label) is hard to read at a glance on a phone and leaves the safety judgement to each
reader.

**Left open.** The 90% is a guess; it is to be tuned once there is real data. Since the map page
works the label out, changing it changes neither the server nor the published files. How few
readings is too few to label a cell is a separate question.

Card: `202611131rcc` (choice: reliable).

## 2026-11-13: One sample per tick, ticks at a fixed rate

The public counts (`serviceN`, `emergencyN`, `noServiceN`) count samples, so they are fair across
service states only if a sample stands for the same time in every state. Two things break that
today:

- **The duplicate skip.** A tick is skipped when the phone moved at most 10 m from the last sample
  and every SIM has the same service state, registered cells and headline strength. In service the
  strength moves by a dBm or two most ticks, so a phone at rest logs every tick. Emergency-only or
  out of service with no registered cell, nothing it compares changes, so it logs only when GPS
  jitter moves the fix 10 m or another SIM's reading changes. Moving faster than about 2 m/s, every
  tick logs in every state. So in-service readings are over-counted at stops in the middle of a
  session and on slow stretches (climbing, steep trails): the places the map is for. Any rule that
  weighs the counts against each other errs towards "signal".
- **Ticks start 5 s after the previous one ended.** A tick waits up to 3 s per SIM for the modem's
  cells, so a tick where the modem is slow lasts up to 8 s and counts as much as one of 5 s.

**Decision.** The app logs a sample on every tick that has a fresh fix and an active subscription,
and each tick starts 5 s after the previous one started. The duplicate skip is deleted. Then, within
a session, every sample stands for 5 s whatever the state, `accumulate` keeps counting samples, and
the counts are time in each state. The fix removes the cause whatever its size, so the size of the
bias was not measured. Issue #136.

**Why not the others.**

- *A repeat count on the sample* (schema v3): the log is append-only, so the app would have to
  rewrite its last line or hold a sample back until the state changes, and a killed process would
  lose the held ticks. It saves volume only at rest when nothing changes.
- *A tolerance on the strength*: thins in-service readings but doesn't make the states equal; any
  state whose comparison changes more often (jitter, neighbour cells) stays over-counted, and the
  strength histogram loses readings.
- *Weighting each sample by the time to the next on the server*: a gap after a sample is either
  skipped repeats or ticks with no fix or no subscription, which look the same; a gap from losing
  the fix in a canyon would be credited to the last state seen.
- *Counting each install's readings per cell and state once per time window or session*: fair only
  if every state logs at least once per window, which needs this app change anyway; once per
  session turns the counts into visits, where one stray reading weighs as much as an hour of
  readings.

**Battery.** Unchanged in practice: every tick already takes a fix and queries the modem; the skip
saved only a file append. Fixed-rate ticks query the modem a little more often when it is slow.

**Volume and cost.** More samples only where the phone rests and nothing changes, at most one per
5 s, which is what a phone at rest in service logs today. Those samples have few or no cells, so
they are small. The upload limit (`HOURLY_LIMIT`, 20,000 per install per hour) is already sized for
a sample every 5 s all day.

**Privacy.** The raw samples gain repeats at places where the phone already logged samples, and the
times of the samples around a stop already show how long it lasted. The published counts are
unchanged in kind: card `20261113a7do` publishes the reading count per carrier and cell, and for a
stay in service that count is already its length in 5 s ticks; now the same holds in every state.
No new field, time or id is published, and the install-count rules are unchanged.

**Left as is.** Ticks without a fresh fix make no sample in any state, so a state that coincides
with poor GPS (deep canyons) is still under-counted; that can't be known without a fix. The
session-end trim (`aggregate.ts`) counts fixes as time at 5 s each, which this decision makes true.
No version 2 build has reached Play (no deploy run has succeeded) and the aggregation doesn't run
yet (#108), so version 2 samples with the skip come only from test installs, and `schemaVersion`
stays 2.

## 2026-11-13: Checks run on this machine, not on GitHub-hosted runners

The account has no GitHub Actions minutes. `scripts/check.sh` runs every check; the author runs it
before opening a pull request and the merging session runs it again on the latest commit. The
`CI` workflow calls the same script, so moving the checks to the self-hosted runners in Docker on
the owner's workstation, as Geode does, changes only where it runs. Until a runner is
registered for this repo, no workflow runs, the Play deploy included. Issue #89.

Card: `20261113tc78`, answered in chat ("we run ci locally or on the workstation docker setup").

## 2026-11-13: Raw samples are kept 90 days

The server deletes a raw sample 90 days after it received it; the public map keeps its running
statistics. That is a month beyond the longest wait before a sample reaches the map (the monthly
batch for single-install cells), long enough to find a bug and rerun the aggregation, and a
Firestore TTL policy can apply it with no deletion job. Issue #64.

Card: `20261113bmjv` (choice: ninety-days).

## 2026-11-13: Single-install cells are published in monthly batches

A cell backed by two or more installs is updated daily. A cell backed by one install, including
that install's later visits, is published only in the batch on the 1st of the month, once its
first sample is at least 30 days old. Every crag still reaches the map, and a lone visit shows only
as "some time that month". Fixed for every cell: H3 resolution 11, per-carrier statistics and the
month last seen, randomised trimming of each session's ends, raw samples never public. Issue #16.

Card: `20261113a7do` (choice: monthly).

## 2026-11-13: Uploads go through a Cloud Function; a scheduled function publishes the map

The app sends batches to an HTTPS Cloud Function that checks App Check, validates each sample
against the schema, throttles per install and writes to Firestore; clients can't write Firestore
directly. A scheduled function aggregates new samples into the public cell files, served as
static files from Firebase. Everything stays in the existing Firebase project, which moves to the
Blaze plan with a budget alert. The functions are TypeScript: Cloud Functions for Firebase run
Node.js or Python, not Go, and TypeScript has `h3-js` and the most complete Firebase support.
Issues #15, #16, #59.

Card: `20261113p3kn` (choice: firebase-functions).

## 2026-11-13: Sample schema v2

One sample per tick that has a location fix and an active subscription, including ticks with no
signal. Each sample has a schema version, a random id, a pseudonymous install id, a session id,
the fix (accuracy, ellipsoidal altitude, wall-clock and since-boot times, mock flag), and a block
per active subscription with the SIM's PLMN, the registered PLMN, the service state, the 5G
override network type and every cell from `requestCellInfoUpdate`, each with its own strengths.
Values Android reports as unavailable are stored as null, never as sentinels. The install id is a
random UUID kept in `noBackupFilesDir`, never rotated and never the Android ID, so a person counts
as one install for the lone-contributor rule and a reinstall breaks the link. Emergency-only is
read from `NetworkRegistrationInfo` because AOSP reports it as out of service. Field by field in
`docs/sample-schema.md`; the types in `Sample.kt`.

Issue #11. How long the server keeps raw samples is card `20261113bmjv`.

## 2026-11-13: Scrub the leaked secrets from git history

After the keys are rotated, rewrite history to remove the keystore files, the service-account key,
the app bundle, the debug log and the hardcoded password, then force-push `main` once. Rewriting
before the review flow starts opening pull requests keeps the old commits from being pinned by
pull-request refs. Issues #3 and #4.

Card: `202611134udw` (choice: rewrite).

## 2026-11-13: Geode's rules and review loop, without its claims tooling

The project follows Geode's way of working: one issue per pull request, never commit to `main`,
never merge your own pull request, a bounded second-session review (started by the author, not
the owner) against a checklist, and every follow-up filed. It leaves out Geode's board script and claims, which solve many sessions at once;
sessions take the next ready issue and label it `in-progress` instead. The work and the
follow-ups are GitHub issues; owner questions are president cards, written as they come up. See
`plans/README.md`.

Card: `202611134p01` (choice: lite).
