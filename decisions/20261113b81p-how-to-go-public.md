---
id: "20261113b81p"
title: How should CellSignalMapper become public, so CI runs on GitHub's free minutes?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T19:05:42Z
created_by: claude-code
tags: [security, repo, ci]
depends_on: []
recommendation:
  option: fresh
  why: >-
    It publishes nothing secret, even for a moment, and doesn't wait on GitHub Support, while
    keeping every commit; what it costs is the pull requests and review comments, which stay
    readable in the private archive. It depends on one thing first: that GitHub starts jobs on a
    public repo while this account's billing is blocked, which a throwaway public test repo
    shows in minutes. If it doesn't, going public doesn't fix CI, and stay-private (fix billing)
    is the answer. If one public place with every link and review matters more to you than speed
    and certainty, pick rewrite-in-place.
options:
  - id: fresh
    title: A new public repo from a cleaned copy of the history
    summary: >-
      Copy the history into a new repo with git filter-repo (secret files and the debug log
      dropped, the password blanked, every author and committer email changed to your GitHub
      noreply address), move the open issues there, keep this repo private as an archive, and
      make the new one public once it is checked.
    pros:
      - The secrets and your Gmail never reach a public repo, not even through old pull-request refs.
      - No wait on GitHub Support; it can be done in an afternoon.
      - Every commit, with its message and date, is kept (with new hashes).
      - The old Actions run logs (about 230 runs) stay private with the archive.
    cons:
      - Free CI only if GitHub starts jobs on public repos despite the account's billing block, which isn't certain (see Context).
      - Pull requests, their review comments and closed issues stay in the private archive; the new repo starts with no PRs.
      - "Old `#n` references and issue links (in commits, plans, docs, cards and issue bodies) point to the wrong item: moved issues get new numbers, and once the new repo takes the name `CellSignalMapper`, old `.../CellSignalMapper/issues/N` URLs open the new repo's issue N."
      - The open pull requests must be merged or closed first, and their branches redone in the new repo.
      - Two repos to keep straight; clones on other machines must switch to the new one.
  - id: rewrite-in-place
    title: Rewrite this repo's history, have GitHub Support purge the rest, then make it public
    summary: >-
      Rotate the keys (#2), rewrite history and force-push (#4, as already decided in card
      202611134udw), delete the other branches, ask GitHub Support to purge the pull-request
      refs and cached views, and make this repo public once they confirm.
    pros:
      - One repo; every issue, pull request, review comment and `#n` link keeps working.
      - "It builds on the plan already decided for the history (card 202611134udw and issue #4)."
    cons:
      - Free CI only if GitHub starts jobs on public repos despite the account's billing block, which isn't certain (see Context).
      - Waits on GitHub Support, possibly days, and on the key rotation first, which only you can do.
      - If the purge misses anything, the old private key, keystore and password are readable by anyone who finds the old commits; rotation makes them useless, but they stay out there.
      - All old pull requests and run logs become public too (secrets are masked in the logs).
      - The force push changes every hash (other clones and branches must be redone) and starts a Play deploy run from android-publish.yml.
  - id: fresh-squashed
    title: A new public repo with one commit and no history
    summary: >-
      Like fresh, but the new repo starts from a single commit of today's tree (which is already
      clean), with no history at all.
    pros:
      - "Simplest and safest: nothing from history can leak, and there is nothing to check but today's files."
      - No filter-repo step to get wrong.
    cons:
      - "Loses all history in public: no `git log`, `git blame` or commit messages explaining why code is the way it is (the archive keeps them, privately)."
      - The same costs as fresh for CI, pull requests, issue numbers and links.
  - id: stay-private
    title: Stay private and fix billing
    summary: >-
      Fix the failed payment or spending limit under Settings > Billing and plans, so hosted CI
      runs again on the private repo; until then sessions keep running `scripts/check.sh` on the
      workstation, and the history cleanup goes ahead as already decided.
    pros:
      - No code or history is exposed, and nothing new to get wrong.
      - Fixing billing is needed anyway if GitHub won't start jobs on public repos while it's blocked.
      - "GitHub Free includes a monthly Actions allowance for private repos (the billing doc states it as $12 USD per month); a 2-4 minute build per pull request may fit in it on quiet days."
    cons:
      - Costs money once the free private allowance is used up; busy review days used it up before (card 20261113tc78).
      - No branch protection (not available on a free private repo), so "never push to main" stays a rule, not a setting.
      - A crowdsourced location app is harder to trust when its code can't be read.
resolution:
  choice: fresh
  note: let's also rebrand it's a good opportunity, you can choose a name i dont really care not in the mood to thing and i don't really care, anything is better than cellsignalmapper lol
  resolved_at: 2026-11-13T19:29:48Z
applied_at: 2026-11-13T20:36:58Z
---

## Context

On 2026-11-13 you asked: "make sure theres no personal information in the repo and let's make it
public so we can get free ci minutes on gh". This card decides **how** the repo becomes public
(or whether it stays private). A read-only audit was done on 2026-11-13; no secret values are
shown here.

**Will public actually give free CI?** Standard GitHub-hosted runners are free for public repos.
Since 2026-11-13 GitHub refuses every job on this account with "The job was not started
because recent account payments have failed or your spending limit needs to be increased" (the
failed job's annotation; card `20261113tc78`). The cause isn't known: a failed payment, or the
private allowance used up with a $0 spending limit. GitHub's docs don't say whether either stops
jobs on public repos. The one report found with the same message (community discussion 165506)
says public repos kept working: "I just set up a public repository and found that GitHub actions
can be used again." That is one report, and the same poster had also raised the spending limit
to $1, so before any public option is carried out, an agent
creates a throwaway public repo with a one-step workflow and sees whether the job starts. Today
the checks run only through `scripts/check.sh` on the workstation.

**What is fine to publish as it is.** Today's files, the issues, pull requests and comments,
`decisions/`, `plans/` and `docs/` hold no secrets, coordinates, IMEIs, phone numbers or
tokens. `app/google-services.json` and its API key are in the tree on purpose: they ship inside
the app anyway. Before going public it is still worth checking that key's API restrictions in
Google Cloud Console and the Firestore rules, since more people will look. The workflows are safe
for a public repo: no `pull_request_target`, no self-hosted runners, and `ci.yml` uses no
secrets.

**What is not, all in history only (none in today's files):**

- `app/play-account.json`: the Play service account **with its private key** (added in
  `0637414`, deleted in `a7bdfb5`).
- The release keystore, raw and base64 (`app/release-key.jks` and `app/release-key.jks.b64`,
  later at the repo root, deleted in `a7bdfb5`).
- The keystore's `storePassword`/`keyPassword` written in `app/build.gradle.kts`, in about 11
  versions of that file.
- Your Gmail address: the author email of every commit (about 245 on `main`) and the committer
  email of those not merged on GitHub's site, plus once in `firebase-debug.log`.
- Not secret but heavy: `app/release/app-release.aab`, also dropped by the cleanup.

The five Actions secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`,
`SERVICE_ACCOUNT_JSON`) were last set on 2025-05-24, so **nothing has been rotated yet**. Issue
#2 (you rotate the keys) and #4 (rewrite history, already decided in card `202611134udw`) are
open. The Play app is suspended (#2).

**Why the history can't simply be cleaned in place and flipped.** GitHub keeps a
`refs/pull/<n>/head` ref for each of the 85 pull requests; nobody can delete or rewrite them.
After a force-pushed rewrite, the old commits stay reachable through those refs, and they would be
public the moment the repo is, unless GitHub Support purges them. The other branches on GitHub
also descend from the secret commits. And GitHub won't move an issue from a private repo to a
public one, so a new repo has to stay private until the issues are moved.

**In every option that goes public:**

- **Key rotation (#2) is still needed.** The keys sat in a repo for nearly 18 months, and
  copies live in old clones and backups; rotation is what makes them harmless. Under fresh and
  fresh-squashed it doesn't block going public, because the keys are never published; under
  rewrite-in-place it must come first.
- #95 (CI on self-hosted workstation runners, from card `20261113tc78`) is dropped: a public
  repo must never run pull-request code on your machine, and hosted runners are free there.
- Future commits use your GitHub noreply address
  (`14827831+alexandreffaria@users.noreply.github.com`, to be set as `user.email` in every clone), and
  the GitHub setting "Block command line pushes that expose my email" is turned on.
- Branch protection becomes available, so "never push to `main`" can be enforced.
- Under fresh and fresh-squashed, this card replaces card `202611134udw`'s rewrite: #4 is
  closed as superseded, and the private archive keeps its old history (the keys in it are
  harmless once rotated).
- `android-publish.yml` runs on every push to `main`; in a new repo it fails until the rotated
  secrets are added (the app is suspended anyway).

**Separate, and already public.** The companion repo `alexandreffaria/signal-heatmap` is
public today and serves raw samples in `data.json`, also on GitHub Pages: 241 points at about
1 m precision with millisecond times, one person's trace. That is issue #18; you were told
about it separately. It is not part of this choice and needs action whatever you pick here.

**What happens after you answer.** Agents run the public-repo CI test first (for a public
option), file issues for the steps of the chosen option and run them, and **never change
visibility until the result is verified**: a fresh clone of everything GitHub would publish,
searched for every secret path, the password text and the Gmail (in author and committer
fields too), with nothing found. You get your own steps (rotation, billing, and the Support
request for rewrite-in-place) as owner issues.

## Option fresh: A new public repo from a cleaned copy of the history

1. Merge or close the open pull requests (#49 and #185 today).
2. In a fresh clone of `main`, outside the project:

   ```sh
   # passwords.txt (outside the repo): one line, <literal as written in build.gradle.kts>==>REMOVED
   # mailmap.txt: maps the Gmail address to
   #   Alex Faria <14827831+alexandreffaria@users.noreply.github.com>
   git filter-repo --invert-paths \
     --path app/play-account.json --path app/release-key.jks --path app/release-key.jks.b64 \
     --path release-key.jks --path release-key.jks.b64 \
     --path app/release/app-release.aab --path firebase-debug.log \
     --replace-text ../passwords.txt --mailmap ../mailmap.txt
   ```

3. Check: the password text, the Gmail and every dropped path must appear nowhere in
   `git log --all --format=fuller -p` and `git log --all --name-only` (fuller shows the
   committer too).
4. Create a new **private** repo, push `main`, recreate the 22 labels, and move the open issues
   with `gh issue transfer` (comments and assignees move with them; labels only if they exist
   in the new repo, hence labels first).
5. Rename this repo to an archive name and keep it private; give the new repo the name
   `CellSignalMapper`, update the remotes and `CLAUDE.md`/`plans/` links.
6. Check a fresh clone of the new repo again, then make it public and turn on branch protection.
7. Once you have rotated the keys (#2), put the new secrets in the new repo.

## Option rewrite-in-place: Rewrite this repo's history, have GitHub Support purge the rest, then make it public

1. You rotate the keys and update the five secrets (#2).
2. With no pull request open, an agent runs the `git filter-repo` command from card
   `202611134udw` (issue #4), plus the mailmap above, force-pushes `main` (expecting the deploy
   run it starts), and deletes every other branch on GitHub.
3. You ask GitHub Support to purge the 85 pull-request refs and cached views of the old commits.
4. When Support confirms, an agent checks that a known old secret-bearing commit is gone
   everywhere GitHub serves it (`git fetch` by hash, `gh api repos/<repo>/commits/<sha>` and
   the commit's web page), then you make the repo public.

## Option fresh-squashed: A new public repo with one commit and no history

Steps 1 and 4 to 7 of fresh, but step 2 is a single commit of today's tree, authored with the
noreply address:

```sh
mkdir ../CellSignalMapper-public
git fetch && git archive origin/main | tar -x -C ../CellSignalMapper-public && cd ../CellSignalMapper-public
git init -b main
git config user.name "Alex Faria"
git config user.email 14827831+alexandreffaria@users.noreply.github.com
git add -A && git commit -m "CellSignalMapper, public from here on"
```

## Option stay-private: Stay private and fix billing

You fix the payment or the spending limit under Settings > Billing and plans; a session reruns
the waiting pull requests' CI. Until then `scripts/check.sh` stays the check that counts, and
#4 goes ahead as decided. If you'd rather not pay at all, card `20261113tc78`'s answer
(self-hosted runners, #95) stays the plan.

## Sources

- GitHub docs, ["Transferring an issue to another repository"](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository):
  "A private repository issue cannot be transferred to a public repository." and "Labels and
  milestones are also retained if they're present in the target repository".
- GitHub docs, ["Removing sensitive data from a repository"](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository):
  rotate first; GitHub Support must purge cached views and pull-request refs.
- GitHub docs, ["About billing for GitHub Actions"](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions):
  standard GitHub-hosted runners are free for public repositories; GitHub Free includes a
  monthly allowance for private repositories, and without a payment method "usage is blocked
  once you use up your quota".
- GitHub Community discussion [165506](https://github.com/orgs/community/discussions/165506):
  the same message on a private repo; "I just set up a public repository and found that GitHub
  actions can be used again." Discussion [166876](https://github.com/orgs/community/discussions/166876):
  the same message, cleared by a spending limit above $0 or by Support.
- GitHub docs, ["Security hardening for GitHub Actions"](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions):
  self-hosted runners should almost never be used for public repositories.
- The 2026-11-13 audit of this repo (git history, GitHub API, `.github/workflows/`); issues #2,
  #4, #18, #89 and #95; cards `202611134udw` and `20261113tc78`.
