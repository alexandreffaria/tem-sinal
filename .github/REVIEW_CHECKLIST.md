# PR review checklist

Run against every pull request's diff before it's merged, by a session that didn't write it
(`/review-pr <number>`). Each line is pass, fail or n/a, with the file and line for every fail.

Findings are **blocking** (wrong behaviour, a crash, data loss, security, privacy, a broken rule
from `plans/README.md`) or **follow-up** (filed, not fixed in this pull request). One review, one
round of fixes, one confirmation. The reviewer files every follow-up as a `board` issue before
posting the review, and the review lists the issue numbers. Follow-ups don't hold the merge.

Items marked **CI** are also enforced by `scripts/check.sh`, which the reviewer runs on the pull
request's latest commit.

## Shape

1. The pull request does one issue, its title starts with `I-<number>`, its branch is
   `i-<number>-…`, and its description follows the template in `plans/README.md`.
2. **What did this delete?** Anything it replaces is gone in the same pull request.
3. No new dependency, permission, service or secret unless the issue names it. No abstraction the
   issue didn't ask for.
4. Changed lines are within about 400 (not counting deletions, generated files, renames and
   docs), or the description says what is left.
5. Comments and commit messages use standard terms and hold no history: no plan or pull-request
   references, no review-round notes.
6. No file under `decisions/`.

## Secrets and privacy

7. **CI** No keystore, service-account key, app bundle, log file or `.env` added.
8. No secrets in the diff: passwords, tokens, private keys. CI only catches files by name; read
   for the rest.
9. No real location data: fixtures, tests, screenshots and logs use made-up places. A new log line
   never prints coordinates, cell ids or carrier plus time for a real sample.
10. Anything that becomes public (Firestore rules, the map's files) shows aggregates only, never a
    contributor's raw samples.

## Android

11. Every call that needs a runtime permission is guarded: checked first, or `SecurityException`
    caught, so a denied or revoked permission never crashes the app.
12. Nothing depends on the phone's locale or time zone where it shouldn't: number formatting,
    parsing, dates. pt-BR is the main locale.
13. A sample is never dropped silently: on a failed write or upload the data stays on the phone.
    Files are written and replaced so a crash mid-way can't lose them.
14. No file, network or database work on the main thread.
15. Anything registered (listeners, callbacks, location requests, receivers) is unregistered on the
    matching lifecycle event.
16. API levels: code that needs a newer API than `minSdk` is guarded, and the older path works.

## Tests and CI

17. The change has tests: a bug fix has a JVM test that fails without it, where the logic can run
    on the JVM; a feature has tests for its main path and its edge (empty, zero, limit).
18. **CI** `scripts/check.sh` passes on the latest commit, run by the reviewer.
19. The description says what changed and why, in plain words.
