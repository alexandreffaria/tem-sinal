# Decisions

Issue numbers here written before the move to tem-sinal are the archive's,
`alexandreffaria/CellSignalMapper#n` (see `plans/README.md`, "Numbers from before the move").

Settled decisions, newest first. Each links the president card it came from (`decisions/`).

## 2026-11-14: The upload function checks App Check but doesn't require it

The app gets an App Check token from the Play Integrity provider and sends it with each batch; the
upload function verifies it and logs whether it was valid, invalid or missing, and takes the batch
either way, as long as the Firebase Auth ID token is valid. Play Integrity only attests an install
from Google Play, and the app ships as an APK from GitHub Releases, so requiring App Check now
would stop every install's uploads (the samples would stay on the phone, but never go up). The
validation and the per-install and per-user hourly limits still bound what any client can send.
Whether to require it once the app is on Play, which would end uploads from the APK, is the
owner's call (issue #58).

Follows from card `20261114d95s` (choice: apk-then-play).

## 2026-11-14: The app ships as an APK on GitHub Releases now, and on Play once its test passes

The app has never been on Play. Each merge to `main` that changes the app publishes a signed APK
on the repo's Releases page, so people can install it now. At the same time the owner opens a
Play developer account and runs the closed test Google requires of new personal accounts (12
testers opted in for 14 days) before a production release. Both builds are signed with the same
key, uploaded to Play as the app signing key, so a phone with the APK updates to the Play build
without uninstalling and losing samples not yet uploaded. Google's developer verification
doesn't affect APKs installed directly until its global rollout in 2027; the Play account
registers the developer for it.

Card: `20261114d95s` (choice: apk-then-play).

## 2026-11-13: The code goes public in a new repo, as Tem Sinal

The code moves to a new public repo, `alexandreffaria/tem-sinal`, built from a cleaned copy of
this history: `git filter-repo` drops the Play service account, the release keystore (raw and
base64), the release bundle and `firebase-debug.log`, blanks the keystore passwords in
`app/build.gradle.kts`, and rewrites every author and committer email to the owner's GitHub
noreply address. The open issues move there; this repo stays private, as an archive with its pull
requests and reviews. The new repo is made public only after a fresh clone of it is searched for
every dropped path, the password text and the old email, with nothing found; then branch
protection goes on, and the checks run on GitHub-hosted runners, which are free for public repos.

Before any of it, a throwaway public repo checks that GitHub starts jobs on a public repo while
this account's billing is blocked; if it doesn't, going public doesn't bring CI back, and the
owner decides again.

The app is renamed Tem Sinal ("is there signal?"): its display name, the Play listing, the docs.
The application id `dev.meuquerido.cellsignalmapper` stays, since Play can't change it.
The app has never been on Play, so its listing takes the name when the owner creates the app in
Play Console (issue #28); no listing has to be renamed.

This replaces the in-place history rewrite (card `202611134udw`, issue #4) and the self-hosted
runners (card `20261113tc78`, issue #95): a public repo must never run pull-request code on the
owner's machine. Key rotation (#2) is still needed, but doesn't block going public, since the keys
never reach the new repo.

Card: `20261113b81p` (choice: fresh; the owner left the new name to the agents).

## 2026-11-13: No altitude on the map

The public map shows signal only, as settled: no altitude from the phones' readings and none from
a terrain model. The app still records each fix's ellipsoidal altitude and vertical accuracy
(`docs/sample-schema.md`, **Fix**); the server publishes neither and converts neither to height
above sea level.

Card: `2026111304re` (choice: none).

## 2026-11-13: Pressing LOG is the choice to share

LOG (STOP while logging) is the only button and also means "share". Samples are sent
automatically when logging stops and when the app starts, retrying until they go, and the "Send
my data" button is removed. The pending count stays on the main screen while something is still
to be sent, and a failed send keeps the samples on the phone. "What is shared?" says that pressing
LOG shares what is recorded. The new work, in the option's words: "an upload when logging stops
and a background retry (for example WorkManager), with sign-in outside the main screen; today only
starting the app retries; it can use today's uploader, and later the upload function of issue 87."
Nobody can hold back a recorded session, for example one started at home by mistake; only the
server's trim protects it. Nobody can record without sharing, as today. Issues #181 (upload on stop and background retry), #182 (the "What is shared?" text), #183 (the
button).

Card: `20261113og4j` (choice: one-button).

## 2026-11-13: The public map stays at resolution 11; the private state moves to resolution 12

Public cells stay H3 resolution 11 (about 50-57 m across) with per-carrier statistics and the
month last seen, as settled; nothing new is published. The server keeps its private statistics
per resolution 12 cell (about 19-22 m across) and publishes their resolution 11 parents, so a
later switch to finer cells loses nothing. The cost: about 2.5 to 3 times more private state along
walked tracks (up to seven times over a densely covered area), a few samples near cell edges
rolling up to a neighbouring resolution 11 cell, and a private state, kept with no end date and
listing which installs were in each cell each month, that places each install to about 20 m
instead of 50 m. Issue #180, before #108.

Card: `20261113mua9` (choice: today).

## 2026-11-13: A stop counts as a destination after five minutes of travel

A stay at the start or end of a session is hidden as a possible home, with the trim around it,
until the phone has had 60 moving fixes (five minutes at one fix every 5 s) that are in no stay and
lie outside the trim of where the session started or ended; a stay after that counts as a
destination, such as a crag, and is kept. `DEPARTURE_FIXES = 60` in `functions/src/aggregate.ts`,
as built. It withstands a wrong glide home shorter than about 400 s from 2 km away (590 s from
1 km), four times the 100 s glide of #122. A crag reached on foot is kept only from about 860 m from
the car at the shortest trim (1360 m at the longest), so a crag 1 km from the car shows up from
about 7% of the sessions that start and end there, and one 1.5 km away from all of them. Nobody has
measured how long such glides last on real phones. With a 3-minute rest every 10 minutes of
walking, current `main` keeps no crag at trims of about 550 to 650 m and above (#179).

Card: `20261113nk9r` (choice: five).

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
signal (signal / emergency only / no service). The map can also show the three counts when a cell is tapped. Issue #17.

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

Replaced by: The code goes public in a new repo, as Tem Sinal (card `20261113b81p`).

The account has no GitHub Actions minutes. `scripts/check.sh` runs every check; the author runs it
before opening a pull request and the merging session runs it again on the latest commit. The
`CI` workflow calls the same script, so moving the checks to the self-hosted runners in Docker on
the owner's workstation, as Geode does, changes only where it runs. Until a runner is
registered for this repo, no workflow runs, the Play deploy included. Issue #89.

Replaced on 2026-11-14, when `tem-sinal` went public: the `CI` run on GitHub-hosted runners is
the checks again, and `scripts/check.sh` is how to run them on this machine.

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

Replaced by: The code goes public in a new repo, as Tem Sinal (card `20261113b81p`).

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
