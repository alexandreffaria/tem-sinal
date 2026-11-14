---
name: review-pr
description: Second review of a CellSignalMapper pull request against .github/REVIEW_CHECKLIST.md before it's merged. Use when asked to review a PR, run the checklist, or "/review-pr <number>".
argument-hint: <pr-number>
---

# Review PR $ARGUMENTS

You are the second reviewer: you didn't write this pull request, and your job is to find what
would crash the app, lose or leak someone's samples, or break the repo's rules, not to restyle it.
Don't push commits to the pull request; report. There is one review per pull request, then one
round of fixes by the author, then one confirmation, and no review after that.

1. Read `.github/REVIEW_CHECKLIST.md`, then `CLAUDE.md`, then `plans/README.md` (its rules win
   over anything else in the repo). Check the pull request against the issue it closes (`gh issue view <n>`).
2. Gather the pull request:
   ```sh
   gh pr view $ARGUMENTS --json number,title,body,baseRefName,headRefName,headRefOid,files,additions,deletions
   gh pr diff $ARGUMENTS
   # the earlier review, for a confirmation
   gh pr view $ARGUMENTS --comments
   gh api --paginate repos/{owner}/{repo}/pulls/$ARGUMENTS/comments \
     --jq '.[] | "\(.path):\(.line // .original_line) \(.body)"'
   ```
3. Read the changed files in full where the diff isn't enough to judge them (a lifecycle, a
   permission check, a file that is replaced). To see the branch: `git fetch origin
   pull/$ARGUMENTS/head:review/pr-$ARGUMENTS`, then `git show review/pr-$ARGUMENTS:<path>`.
4. Go through every checklist item in order. For each, decide **pass**, **fail** or **n/a**, and
   for a fail give the file and line and one sentence on what goes wrong. Grep the diff for
   `format(`, `toDouble()`, `Locale`, `registerReceiver`, `requestLocationUpdates`,
   `allCellInfo`, `Log.` and `delete(`, which are where this app has broken before. Classify each
   finding as **blocking** or **follow-up**.
5. Wait for the `CI` run on the pull request's latest commit:
   ```sh
   gh pr checks $ARGUMENTS --watch --required
   ```
   A failure is blocking. Name the commit the checks ran on in the review.
6. File every follow-up before posting, one issue each, so none is dropped. Pick the kind and
   priority from the tables under "Filing work" in `plans/README.md`, and write the body from the
   template there (Depends on, Read first, Do, Don't, Done when, ending "Found in review of
   #$ARGUMENTS.") so a session with no other context can act on it:
   ```sh
   gh issue create --label board --label kind:<feature|bug|test|docs|cleanup|nit> \
     --label <p1|p2|p3> --title "<what to change, in a few words>" --body-file <file>
   ```
7. Post the result on the pull request, then give the same text in your reply:
   ```sh
   gh pr comment $ARGUMENTS --body-file <file>
   ```
   Format: a first line `Second review: ready to merge` or `Second review: N blocking`, then a
   table `| # | Item | Result | Note |` with a row per item, then a **Blocking** list and a
   **Follow-ups filed** list with each issue number and title. Ready to merge means nothing
   blocking. If this is the confirmation, check only that the blocking findings are fixed and the
   checks pass. Keep notes to one sentence; plain words.
8. If it's ready to merge, merge it yourself, following "Merging" in `plans/README.md`, and remove
   `blocked` from issues whose only open dependency was the one this closed. If it has blocking
   findings, don't merge: the author fixes them and starts a fresh confirmation.
9. Clean up: `git branch -D review/pr-$ARGUMENTS`.
