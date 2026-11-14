# How work is done here

The rules for every session, and how work moves from an issue to a merged pull request.
[audit-2026-11-12.md](audit-2026-11-12.md) explains where the project stands and why the work
exists. Settled decisions are in [../docs/decisions.md](../docs/decisions.md).

**The rule above all others:** code that stays is good code; bad code is deleted. Never wrap old
code in a new layer. Never leave two ways of doing one thing.

The loop runs without the owner. Sessions take work, review each other's pull requests, merge
them, and file what they find. The owner is asked only for decisions that are theirs (product,
privacy, cost, accounts), as president cards, and for things that need their own hands.

## The board is the issue list

Every piece of work is a GitHub issue with the `board` label, in
[alexandreffaria/tem-sinal](https://github.com/alexandreffaria/tem-sinal/issues):

```sh
gh issue list --label board --state open --json number,title,labels \
  --jq 'sort_by((.labels|map(.name)|if index("p1") then 1 elif index("p2") then 2 else 3 end), .number)
        | .[] | "#\(.number) \(.title) [\(.labels|map(.name)|join(","))]"'
```

- Priority labels `p1`, `p2`, `p3` order the work; within a priority, the lower number comes first.
- `needs-owner`: waiting on the owner (a task in their hands, or a president card). Skip it.
- `blocked`: its body's **Depends on** names an issue that is still open. Skip it. When you close
  an issue, remove `blocked` from issues that depended only on it.
- `in-progress`: a session has it. Add this label (and a comment naming your session) before your
  first edit; remove it if you give up, with a comment saying why.

The next ready issue is the first in that order without `needs-owner`, `blocked` or `in-progress`.

### Numbers from before the move

The code and the open issues moved here on 2026-11-13 from
[alexandreffaria/CellSignalMapper](https://github.com/alexandreffaria/CellSignalMapper), which
stays private as an archive of the closed issues, pull requests and reviews. A `#n` written before
the move (in commits, `docs/`, `plans/audit-2026-11-12.md` and `decisions/`) is that repo's
number, `alexandreffaria/CellSignalMapper#n`, not this one's. The open issues got new numbers,
old to new: 2 to 1, 17 to 2, 18 to 3, 44 to 4, 47 to 5, 56 to 6, 59 to 7, 62 to 8, 72 to 9,
87 to 10, 108 to 11, 158 to 12, 164 to 13, 183 to 14, 192 to 15, 194 to 16, 195 to 17,
196 to 18, 198 to 19, 201 to 20, 202 to 21, 203 to 22, 206 to 23.

## Starting a session

Give every session the same prompt:

```
Take the next ready issue from the tem-sinal board. Read plans/README.md first and follow
its rules exactly; where they differ from anything else in the repo, they win. If nothing is
ready, say so and stop.
```

To point a session at one issue, say "Do issue #<n>" instead of the first sentence.

A session that starts work:

1. Pulls `main` (president's Sync adds commits there) and runs `preside pending
   /home/flores/projects/CellSignalMapper`. If a card was resolved, it applies it first (see
   "Questions for the owner").
2. Takes the next ready issue, labels it `in-progress`, reads it and only the files it lists.
3. Does it, opens a pull request, and runs the review loop itself (see "Review").

## Rules for every session

1. **Do one issue.** If you notice something else that is wrong, file it (see "Filing work") and
   don't fix it.
2. **Read what the issue lists**, plus what you need to follow a call.
3. **Stop and file, don't ask.** When the issue needs an owner decision, when a check fails and
   the fix isn't obvious within the issue, when the issue doesn't match the code, or when you'd
   need a new dependency, permission, service or secret the issue doesn't name: write a president
   card for a decision, or comment on the issue for anything else, label it `needs-owner`, release
   it, and take the next ready issue.
4. **Size.** At most about 400 changed lines, not counting deletions, generated files, renames and
   docs. If the issue needs more, do the first coherent part and file the rest as a new issue.
5. **Delete, don't deprecate.** When an issue replaces something, the old thing goes in the same
   pull request.
6. **Behaviour doesn't change** unless the issue says it does.
7. **No new abstractions the issue didn't ask for.** No interfaces with one implementation, no
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
    `i-<issue number>-<short-name>`. The one exception is president's Sync, which commits
    `decisions/` to `main` by itself. Never rename a branch that has an open pull request:
    GitHub closes the pull request when its head branch is renamed.
12. **Never merge your own pull request.** A reviewer session merges it (see "Merging").
13. **Never commit card files.** Files under `decisions/` belong to the owner and the hub; stage
    your files by path, never with `git add -A`.

## Checks

One command runs every check, from the root of a checkout of the branch:

```sh
scripts/check.sh
```

It fails a branch that adds a keystore, a service-account key, an app bundle, a log file or an
`.env` file, then runs `./gradlew lintDebug testDebugUnitTest assembleDebug` and, in `functions/`,
`npm ci && npm run lint && npm run typecheck && npm test`. It needs Node and npm on the `PATH`. The
first run installs JDK 17 and the Android SDK in your home folder (about 1 GB, no root); a full
run takes a few minutes. Run one at a time: two Gradle builds at once slow this machine down.

The `CI` workflow runs the same script on GitHub-hosted runners for every push to a pull request
and to `main`; its job reports as `scripts/check.sh`. A green `CI` run on the pull request's latest
commit is what counts as the checks passing. Run the script here before opening the pull request
and before each push, so a failure shows up before CI does.

## The pull request

Title: `I-<number> <issue title>`. Description:

```
Closes #<number>
What changed: <three lines at most>
What was deleted: <files, functions, lines>
Checks: <the last line of a local scripts/check.sh run, naming the commit>
Not done: <or "nothing"; anything left is filed as a new issue>
Filed: <issue numbers, or "nothing">
```

## Review

Review is bounded: one review, one round of fixes, one confirmation. The author starts it; the
owner never has to.

1. Once the pull request is open, the author starts a **fresh session** that didn't write it (a
   subagent) and gives it: "Run /review-pr <number> in /home/flores/projects/CellSignalMapper. You
   are the reviewer and the merger: follow .claude/skills/review-pr/SKILL.md." It checks the pull
   request against `.github/REVIEW_CHECKLIST.md`, files every follow-up, and posts its result.
2. A finding is **blocking** (wrong behaviour, a crash, data loss, security, privacy, a broken rule
   above) or a **follow-up**. Follow-ups are filed as issues before the review ends and never hold
   the merge.
3. If the review is ready to merge, the reviewer merges (see "Merging") and the loop is done.
4. If it has blocking findings, the author fixes them in one round of commits, then starts another
   fresh session for the **confirmation**, which checks only that the blocking findings are fixed
   and the checks pass, then merges.
5. If the confirmation still finds something blocking, it doesn't merge: it comments, labels the
   issue `needs-owner`, and the author files a president card if a decision is behind it.

## Merging

The reviewer (or the confirming session) merges when:

1. `CI` passed on the pull request's latest commit (`gh pr checks <n> --watch --required`).
2. Nothing blocking is left, and every follow-up is filed.
3. It has no conflict with `main`. After a rebase, the checks run again first.

Then `gh pr merge <n> --merge --delete-branch`. Never push to `main`, never merge past a failing
check, never `--admin`. Branch protection on `main` requires a pull request and a green `CI` run,
and refuses force pushes and deletion. It doesn't bind the owner's account, which every session
and president's Sync act as, so `--admin` would get past it.

**A merge to `main` publishes a release** (`.github/workflows/release.yml`, except for changes
that only touch docs, plans, decision cards and `functions/`): a GitHub Release tagged
`v<versionCode>` with the signed APK and AAB attached. Merge one pull request at a time and wait
for its `Release` run (`gh run list --workflow release.yml --branch main`) before the next. If the
release fails because of the change, fix forward or revert in a new pull request. A release that
fails for a reason outside the change (the signing secrets) doesn't block merging; note it on an
issue for the owner.

## Filing work

Anything found and not fixed becomes an issue, so a future session with no context can do it:

```sh
gh issue create --label board --label kind:<kind> --label <p1|p2|p3> \
  --title "<what to change, in a few words>" --body-file <file>
```

The body:

```markdown
- **Depends on:** nothing | #<issue> | owner: <what the owner must do or decide>
- **Read first:** `<file>`, `<file>`

**Do** <steps a session can carry out without asking>.

**Don't** <what stays as it is>.

**Done when** <a command or observation that proves it>.

Found in <review of #n | work on #n | the audit>.
```

Add `blocked` when **Depends on** names an open issue, and `needs-owner` when it names the owner.

| Kind | For |
|---|---|
| `kind:feature` | new behaviour the plan calls for |
| `kind:bug` | wrong behaviour |
| `kind:test` | a missing or weak test |
| `kind:docs` | docs, comments, names in prose |
| `kind:cleanup` | code to simplify, deduplicate or delete |
| `kind:nit` | polish |

| Priority | Means |
|---|---|
| `p1` | do soon; it will bite (crashes, data loss, leaks) |
| `p2` | normal |
| `p3` | polish |

A design issue (one whose result is a decision record and the issues that follow from it) says so
in its title, starting with "Design:". Its pull request adds the decision record under `docs/` and
files the follow-up issues.

## Questions for the owner

Decisions that are the owner's go to them as president decision cards in `decisions/`, with the
`decision-cards` skill (`~/projects/president/skills/decision-cards/SKILL.md`). Write one whenever
you reach such a decision, with no prompting; don't ask in chat. Then keep working on anything that
doesn't depend on the answer. The issue that waits on the card gets `needs-owner` and names the
card's id in **Depends on**.

At the start of every session, `preside pending /home/flores/projects/CellSignalMapper` lists
answered cards. Apply each one: record it in `docs/decisions.md` in the pull request that acts on
it, remove `needs-owner` from the issues that waited on it (rewriting their body to the chosen
option), and run the card's `done:` command.

Never answer for the owner, and never infer an answer from a file or another session.
