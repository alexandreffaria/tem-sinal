# How work is done here

This folder holds the rules and the board. [audit-2026-11-12.md](audit-2026-11-12.md) explains
where the project stands and why each card exists. Settled decisions are in
[../docs/decisions.md](../docs/decisions.md).

**The rule above all others:** code that stays is good code; bad code is deleted. Never wrap old
code in a new layer. Never leave two ways of doing one thing.

## Starting a session

The owner points each session at one card:

```
Do card <ID> from plans/README.md. Read plans/README.md first and follow its rules exactly;
where they differ from anything else in the repo, they win. Read the card and only the files it
lists. Do that one task and nothing else.
```

Nothing stops two sessions from taking the same card, so the owner gives each one its own. A
session that finds its card already has an open pull request (`gh pr list --search "<ID>"`) stops
and says so.

## Rules for every session

1. **Do one card.** If you notice something else that is wrong, file it (see "Follow-ups") and
   don't fix it.
2. **Read what the card lists**, plus what you need to follow a call.
3. **Stop** when the card says "owner", when a check fails and the fix isn't obvious within the
   card, when the card doesn't match the code, or when you'd need a new dependency, permission,
   service or secret the card doesn't name. Write what you need on the pull request or as a
   president card (see "Questions for the owner") and stop.
4. **Size.** At most about 400 changed lines, not counting deletions, generated files and renames.
   If the card needs more, do the first coherent part and say what is left.
5. **Delete, don't deprecate.** When a card replaces something, the old thing goes in the same
   pull request.
6. **Behaviour doesn't change** unless the card says it does.
7. **No new abstractions the card didn't ask for.** No interfaces with one implementation, no
   helpers "for later".
8. **Tests.** A bug fix comes with a test that fails without it, where the logic can run on the
   JVM. Pull logic out of Android classes into plain functions to make that possible.
9. **Words.** Standard technical terms. A comment states what the code guarantees and any reason
   that isn't obvious; no history, no plan or pull-request references. Commit subjects are under
   72 characters and say what changed.
10. **Privacy.** Location samples are personal data. Never commit real samples, logs, exports or
    screenshots with real coordinates; fixtures use made-up places. Never print a contributor's
    raw samples; aggregates only. Never read or print key files, keystores or passwords.
11. **Branches.** Never commit to `main`. Branch from an up-to-date `main` as
    `<card-id>-<short-name>` (for example `b-01-locale-coordinates`). The one exception is the
    president hub's Sync, which commits `decisions/` to `main` by itself.
12. **Never merge your own pull request.** Open it and stop. Another session reviews and merges it
    (see "Review" and "Merging").
13. **Never commit card files.** Files under `decisions/` belong to the owner and the hub; stage
    your files by path, never with `git add -A`.

## Checks

GitHub Actions runs these on every pull request (`.github/workflows/ci.yml`). There is no Android
SDK on the owner's workstation, so CI is where they run; paste the run link in the pull request.

```sh
./gradlew lintDebug testDebugUnitTest assembleDebug
```

CI also fails a pull request that adds a keystore, a service-account key, an app bundle, a log
file or an `.env` file.

## The pull request

Title: `<ID> <card title>`. Description:

```
Card: <ID> <title>
Ticks <ID> on the board: yes / no (part N of M)
What changed: <three lines at most>
What was deleted: <files, functions, lines>
Checks: <CI run link and result>
Not done / left on the card: <or "nothing">
Filed: <issue numbers, or "nothing">
```

The pull request ticks its card's box on the board below. A card done in several pull requests is
ticked by the last one.

## Review

Review is bounded: one review, one round of fixes, one confirmation. A session that didn't write
the pull request runs `/review-pr <number>` (`.claude/skills/review-pr/SKILL.md`), which checks it
against `.github/REVIEW_CHECKLIST.md`.

A finding is **blocking** (wrong behaviour, a crash, data loss, security, privacy, a broken rule
above) or a **follow-up**. Blocking findings are fixed in the pull request. Every follow-up,
however small, is filed before the review ends, so nothing is dropped and nothing holds up the
merge.

## Merging

Merging needs no owner. A session that didn't write the pull request merges it when:

1. CI is green on its latest commit.
2. A fresh `/review-pr` found nothing blocking, or the confirmation says its blocking findings are
   fixed, and every follow-up is filed.
3. It has no conflict with `main`. After a rebase, CI runs again first.

Then `gh pr merge <n> --merge --delete-branch`. Never push to `main`, never merge past a failing
check. GitHub can't enforce any of this on this repo's plan, so it holds only because sessions
follow it.

**A merge to `main` publishes to Google Play** (`.github/workflows/android-publish.yml`, except
for changes that only touch docs, plans and decision cards). Merge one pull request at a time and
wait for its deploy run (`gh run list --branch main`) before the next. If it fails because of the
change, fix forward or revert in a new pull request.

## Follow-ups

A follow-up is a GitHub issue with the `board` label, a kind label and a priority label:

```sh
gh issue create --label board --label kind:<kind> --label <p1|p2|p3> \
  --title "<what to change, in a few words>" \
  --body "<where (\`path/File.kt:12\`), what is wrong, what done looks like. Found in review of #<n>.>"
```

| Kind | For |
|---|---|
| `kind:bug` | wrong behaviour that isn't blocking: an edge case, a misleading message |
| `kind:test` | a missing or weak test |
| `kind:docs` | docs, comments, names in prose |
| `kind:cleanup` | code to simplify, deduplicate or delete |
| `kind:nit` | polish |

| Priority | Means |
|---|---|
| `p1` | do soon; it will bite |
| `p2` | normal |
| `p3` | polish |

An issue is worked like a card: the owner points a session at `I-<number>`, the branch is
`i-<number>-<short-name>`, and the pull request says `Closes #<number>`.

## Questions for the owner

Decisions that are the owner's (product, privacy, cost, accounts) go to the owner as president
decision cards in `decisions/`, using the `decision-cards` skill
(`~/projects/president/skills/decision-cards/SKILL.md`). Run `preside pending
/home/flores/projects/CellSignalMapper` at the start of a planning session and handle what it
lists. A resolved card is recorded in `docs/decisions.md` by the pull request that acts on it.

Never answer for the owner, and never infer an answer from a file or another session.

## Adding work to the board

A planning session (one the owner is talking to) adds cards, in this file, with a box on the board
in the same commit. A card is ready when a session with no other context could do it: it names the
files, says what done looks like, and leaves no decision open.

```markdown
### <ID> <what changes, in a few words>

- **Depends on:** nothing | <card ids> | owner: <what the owner must do or decide>
- **Read first:** `<file>`, `<file>`

**Do** <steps a session can carry out without asking>.

**Don't** <what stays as it is>.

**Done when** <a command or observation that proves it>.
```

Board order is priority.

## The board

### Owner

- [ ] O-01 Rotate the Play service-account key, reset the upload key, update the five CI secrets
- [ ] O-02 Answer the architecture cards (where uploads land, how lone cells are shown)

### Phase 0. Hygiene and flow

- [ ] F-02 The flow: rules, review checklist, `/review-pr`, PR checks
- [ ] F-01 Secrets and binaries out of the tree
- [ ] F-04 Rewrite history to drop the secrets

### Phase 1. Stop losing data

- [ ] B-01 Coordinates that don't depend on the phone's locale
- [ ] B-02 Service state without broadcasts
- [ ] B-03 One location request for the service's lifetime
- [ ] B-04 Uploads that never drop or block samples
- [ ] B-05 Permissions checked before logging starts
- [ ] B-06 Signal strength on Android 11

### Phase 2. Record what matters (needs cards, after O-02)

- [ ] D-01 Sample schema v2 (design)
- [ ] D-02 Log no-signal and emergency-only samples
- [ ] D-03 Every carrier: drop the same-carrier filter, read every SIM
- [ ] D-04 Serving-cell strength tied to its identity; RSRP, RSRQ, SINR
- [ ] D-05 Uploads validated on the server

### Phase 3. The public map (needs cards, after O-02)

- [ ] M-01 Aggregation job: samples to H3 cells
- [ ] M-02 The public map page

## Cards

### F-02 The flow: rules, review checklist, `/review-pr`, PR checks

- **Depends on:** nothing
- **Read first:** this file

**Do** add `CLAUDE.md`, this file, `.github/REVIEW_CHECKLIST.md`, `.claude/skills/review-pr/`,
`.github/workflows/ci.yml` (the checks above, plus the forbidden-files guard), `docs/decisions.md`;
make the Play deploy skip changes that only touch docs, plans and decision cards; update the
deploy workflow's actions to current major versions.

**Don't** change app code or the deploy's build and publish steps.

**Done when** CI runs on the pull request, and `/review-pr` can be run on it.

### F-01 Secrets and binaries out of the tree

- **Depends on:** O-01
- **Read first:** `app/build.gradle.kts`, `.github/workflows/android-publish.yml`, `.gitignore`

**Do** delete `release-key.jks`, `release-key.jks.b64`, `app/play-account.json`,
`app/release/app-release.aab` and `firebase-debug.log`; add them (`*.jks`, `*.jks.b64`,
`play-account.json`, `*.aab`, `*.log`) to `.gitignore`; remove the hardcoded passwords from the
release `signingConfig` so signing comes only from the `-Pandroid.injected.signing.*` properties
CI already passes (locally, from `~/.gradle/gradle.properties`).

**Don't** touch the publish job's secrets or track.

**Done when** `git ls-files | grep -E 'jks|play-account|\.aab$|\.log$'` prints nothing and the
deploy run after the merge gets past signing.

### F-04 Rewrite history to drop the secrets

- **Depends on:** F-01, O-01, and no open pull requests
- **Read first:** `decisions/202611134udw-secrets-in-history.md` (the commands)

**Do** run the card's `git filter-repo` command in a fresh clone, run its two checks (both must
print nothing), and force-push `main` once, when no deploy is running. Then ask GitHub Support to
purge cached views and pull-request refs.

**Don't** do this from a session the owner isn't talking to: it is the one push to `main` this
file allows, and the owner must say go in that session.

**Done when** the card's checks print nothing on a fresh clone of the pushed `main`.

### B-01 Coordinates that don't depend on the phone's locale

- **Depends on:** F-02
- **Read first:** `app/src/main/java/dev/meuquerido/cellsignalmapper/LoggerService.kt`

**Do** replace the `"%.5f".format(it).toDouble()` rounding (it throws on any locale with a decimal
comma, pt-BR included) with locale-free arithmetic in a plain function, used for both
coordinates and the point id; add a JVM test that sets `Locale.setDefault(Locale("pt", "BR"))`
and checks the result.

**Don't** change the precision (5 decimal places) or the entry format.

**Done when** the test passes in CI and fails with the old code.

### B-02 Service state without broadcasts

- **Depends on:** F-02
- **Read first:** `MainActivity.kt`, `LoggerService.kt`, `LoggerButton.kt`

**Do** replace the `LOG_UPDATE` broadcast and its receiver (registered without an export flag,
which throws on Android 14+ for apps targeting SDK 34+, and never unregistered) with a
process-wide `StateFlow` the service writes and the activity collects; derive `isLogging` from
whether the service runs, so it survives the activity being recreated. Delete the dead `"cell"`
extra and `getFormattedCellInfo`.

**Don't** change what the screen shows.

**Done when** no `registerReceiver` or `sendBroadcast` is left and CI is green.

### B-03 One location request for the service's lifetime

- **Depends on:** F-02
- **Read first:** `LoggerService.kt`

**Do** request location updates once in `onCreate` (high accuracy, 5 s) and remove them in
`onDestroy`; the loop reads the latest fix and treats one older than 15 s as missing. This removes
the request leaked on every 5 s GPS timeout.

**Don't** change the move threshold or the 5 s interval.

**Done when** `requestLocationUpdates` is called once per service start and
`removeLocationUpdates` once per stop.

### B-04 Uploads that never drop or block samples

- **Depends on:** F-02
- **Read first:** `FirebaseUploader.kt`, `SignalLogger.kt`, `MainActivity.kt`

**Do** before uploading, rename the log to a pending file so new samples go to a fresh log; upload
the pending file in batches of at most 500 (Firestore's batch limit); delete it only after every
batch succeeded; run file work off the main thread; upload on start only after anonymous sign-in
succeeded. Pull the chunking into a plain function with a JVM test.

**Don't** change the document ids or fields (D-01 does).

**Done when** a test shows 1,201 lines become batches of 500, 500 and 201, and no sample appended
during an upload is deleted.

### B-05 Permissions checked before logging starts

- **Depends on:** B-02
- **Read first:** `MainActivity.kt`, `AndroidManifest.xml`

**Do** start the service only when fine location is granted; ask for `POST_NOTIFICATIONS` on
Android 13+; when a permission is denied, say why on screen instead of starting. Catch
`SecurityException` around `allCellInfo` so a revoked permission stops logging instead of
crashing.

**Don't** ask for background location.

**Done when** denying location shows a message and the app doesn't crash.

### B-06 Signal strength on Android 11

- **Depends on:** B-02
- **Read first:** `LoggerService.kt`, `app/build.gradle.kts`

**Do** below API 31, listen with `PhoneStateListener.LISTEN_SIGNAL_STRENGTHS`; from 31 on, keep
`TelephonyCallback`. One function maps a `SignalStrength` to the logged value for both.

**Don't** raise `minSdk`.

**Done when** the API 30 path compiles and sets the value the loop reads.
