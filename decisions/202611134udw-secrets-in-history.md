---
id: "202611134udw"
title: After rotating the leaked keys, should we also scrub them from git history?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T00:14:06Z
created_by: claude-code
tags: [security, repo]
depends_on: []
recommendation:
  option: rewrite
  why: >-
    It depends on whether this repo might ever be public (a crowdsourced location app is easier to
    trust when people can read it). If it might, rewrite now, before the first pull request of the
    new review flow (the repo has had none so far): each PR opened before the rewrite keeps old commits reachable on GitHub until Support
    purges them. If you're unsure, later costs little more than doing it now; if it will surely stay private,
    rotate-only is enough.
options:
  - id: rotate-only
    title: Rotate, delete from the tree, leave history alone
    summary: New service-account key and upload key; a normal PR removes the files and the hardcoded password; old commits keep the dead secrets.
    pros:
      - No force push; every clone and open branch keeps working.
      - Once rotated, the old secrets are useless.
    cons:
      - The old keystore password and service-account key stay readable in history; that's harmless only if both were really rotated.
      - The repo can never safely go public without doing the rewrite anyway.
      - Secret scanners keep flagging the history.
  - id: later
    title: Rotate now, rewrite only if the repo goes public
    summary: Rotate and delete from the tree today (like rotate-only), and do the rewrite as the first step of making the repo public, if that ever happens.
    pros:
      - No force push now, and none ever if the repo stays private.
      - Keeps the option open without deciding about going public today.
    cons:
      - Every PR opened in the meantime keeps the old commits reachable on GitHub, so the later rewrite also needs a GitHub Support purge of those refs.
      - The rewrite is the same work later, with more branches and clones to redo.
  - id: rewrite
    title: Rotate, then rewrite history to remove the files
    summary: Same rotation, plus git filter-repo to drop the keystore and its base64 copy (at both paths each lived at), play-account.json, the .aab and the debug log from every commit, and to blank the hardcoded password in build.gradle.kts, then one force push to main.
    pros:
      - The branch history no longer has the secrets, so the repo can be made public later.
      - Removes the .aab and other binaries, so the repo gets smaller.
    cons:
      - Every commit hash changes; other clones (other machines, CI caches) need a fresh clone.
      - The force push to main triggers android-publish.yml and a Play upload, so the rotated secrets must be in place first, and that run should be expected (or the workflow disabled for it).
      - Old commits stay reachable on GitHub (PR refs, cached views) until you ask GitHub Support to purge them.
      - Copies outside the branch keep the secrets (old clones, local backups, and logs or artifacts of earlier Actions runs), so rotation is still required.
resolution:
  choice: rewrite
  resolved_at: 2026-11-13T00:21:56Z
---

## Context

The audit (`plans/audit-2026-11-12.md`, S1-S3) found these committed in git:

- `app/play-account.json`: a Google service account **with its private key**, which can
  publish to your Play listing.
- The release keystore and a base64 copy of it, first as `app/release-key.jks` and
  `app/release-key.jks.b64`, later moved to `release-key.jks` and `release-key.jks.b64`; `app/build.gradle.kts:26` has its password in plain text.
- `app/release/app-release.aab` and `firebase-debug.log`.

They were added across several commits, from `1d7c4da` (the .aab) to `8a20c4e` (the debug log).
The service account, the first keystore paths and the password came in `0637414`; the keystore
files moved in `58c164f`. (`keyAlias` is also in Gradle; it isn't secret and stays.) (`app/google-services.json`, `firebase.json` and `firestore.indexes.json` are also in
history; they hold no secrets and stay; the Firebase API key in
`google-services.json` is meant to ship inside the app.) The repo is private and has 32
commits.

You have to **rotate the keys either way**, and only you can do it: create a new key for the
service account in Google Cloud Console and delete the old one, reset the upload key in Play
Console (if Play App Signing is on, this keystore is only the upload key), then update all five
CI secrets the publish workflow reads: `SERVICE_ACCOUNT_JSON`, `KEYSTORE_BASE64`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. This card only decides what happens to history
afterwards.

A related constraint: GitHub won't turn on branch protection for this repo while it's private on
a free plan. Making it public would turn it on, but only once history is clean.

## Option rotate-only

One PR deletes the files, adds them to `.gitignore`, and reads signing settings only from CI
secrets or a local `~/.gradle/gradle.properties`.

## Option later

The rotate-only PR today. If you ever decide to publish the repo, the first step is the
rewrite below plus a GitHub Support request to purge PR refs and cached views.

## Option rewrite

The same PR, then once it's merged and the keys are rotated:

```sh
# in a fresh clone; filter-repo removes the origin remote on purpose.
# passwords.txt, outside the repo, holds one line: <old>==>REMOVED, where <old> is the password
# exactly as written in build.gradle.kts, including the Kotlin ${'$'} escape, not the real password
git filter-repo --invert-paths --path app/release-key.jks --path app/release-key.jks.b64 \
  --path release-key.jks --path release-key.jks.b64 --path app/play-account.json \
  --path app/release/app-release.aab --path firebase-debug.log \
  --replace-text ../passwords.txt
# check before pushing: both must print nothing
git log --all -p | grep -F -f <(sed 's/==>.*//' ../passwords.txt)
git log --all --name-only --format= | grep -E 'release-key|play-account|\.aab$|firebase-debug'
git remote add origin https://github.com/alexandreffaria/CellSignalMapper.git
git push --force origin main
```

## Sources

- GitHub docs, ["Removing sensitive data from a repository"](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository): rotate first, because a rewrite
  doesn't reach existing clones and forks, and GitHub Support must purge cached views and PR refs.
- `.github/workflows/android-publish.yml`: runs `publishReleaseBundle` on every push to `main`, with the five secrets above.
- GitHub API on this repo, branch protection: "Upgrade to GitHub Pro or make this repository public to enable this feature."
