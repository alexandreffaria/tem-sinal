# Decisions

Settled decisions, newest first. Each links the president card it came from (`decisions/`).

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
