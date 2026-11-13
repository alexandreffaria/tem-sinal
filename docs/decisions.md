# Decisions

Settled decisions, newest first. Each links the president card it came from (`decisions/`).

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
