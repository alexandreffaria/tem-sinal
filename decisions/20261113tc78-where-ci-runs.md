---
id: "20261113tc78"
title: GitHub won't start CI jobs on this account anymore. Where should CI run?
status: resolved
kind: choice
priority: high
created: 2026-11-13T04:02:48Z
created_by: claude-code
tags: [ci, cost]
depends_on: []
recommendation:
  option: self-hosted
  why: >-
    It should unblock the work today at no cost, and it's how Geode already runs its CI (runners on
    your workstation, chosen because hosted minutes cost too much). It depends on two things: that
    GitHub still starts self-hosted jobs while the account's billing is blocked (not documented;
    the first job will show it, and if it doesn't, fix-billing is the only fast way), and that the
    workstation is on while sessions work, which it is whenever they run. Going public can come
    later, once the keys are rotated and the history rewritten.
options:
  - id: fix-billing
    title: Fix the payment or raise the spending limit; keep GitHub-hosted runners
    summary: Fix the failed payment or raise the Actions spending limit under GitHub Settings > Billing and plans; nothing in the repo changes.
    pros:
      - No change to the workflows; CI runs on clean, throwaway machines.
      - Works when the workstation is off.
      - The deploy job keeps running on GitHub too.
    cons:
      - Costs money once the plan's free Actions minutes for private repos are used up; a busy day of review loops uses a lot of them (each pull request runs a build of about 2-4 minutes, often twice, plus one per merge).
      - The same limit can be hit again on the next busy day; Geode kept its CI off hosted runners because of the cost.
  - id: self-hosted
    title: Run CI on a self-hosted runner on the workstation, like Geode
    summary: Register a runner for this repo on the workstation (next to Geode's homelab runners), point ci.yml's jobs at it through a repository variable that can switch them back to GitHub-hosted runners (Geode's CI_RUNS_ON), and install JDK 17 and the Android SDK for it (or let the job install them).
    pros:
      - No Actions minutes used, so no limit; and no charge today (GitHub announced a per-minute fee for self-hosted runners on private repos for March 2026, then postponed it with no new date).
      - When the workstation is off, one repository variable sends the jobs back to hosted runners (once billing works), with no workflow change.
      - Same setup Geode already runs, so one way of doing things.
    cons:
      - Only runs while the workstation is on (unless switched back to hosted runners, which needs working billing); and it may not help at all if GitHub's billing block also stops self-hosted jobs, which isn't documented.
      - Needs your hands once to register the runner (a token from the repo's Settings > Actions > Runners) and room for the SDK on disk; a session can write the steps and the workflow change.
      - Code from pull requests runs on your machine; fine for a private repo where only you and your sessions open pull requests.
  - id: public
    title: Make the repository public; hosted runners are free for public repositories
    summary: After the keys are rotated (#2) and history is rewritten (#4), make the repo public, which also turns on branch protection.
    pros:
      - No minute charge for standard hosted runners on public repos (concurrency and job-time limits still apply).
      - Branch protection becomes available, so "never push to main" is enforced by GitHub.
      - Open code builds trust for a crowdsourced location app.
    cons:
      - Can't happen today; it needs the key rotation and the history rewrite first, so the work stays blocked until then.
      - Anyone can read the code and open pull requests; workflows must not run untrusted code with secrets.
resolution:
  choice: self-hosted
  resolved_at: 2026-11-13T13:00:34Z
applied_at: 2026-11-13T13:06:33Z
---

## Context

Since 2026-11-13 04:00 UTC, every GitHub Actions job on this account ends within seconds with
"The job was not started because recent account payments have failed or your spending limit needs
to be increased", also on a rerun (run 43362555574, pull request #88). Issue #89 tracks it.

The review loop merges a pull request only with CI green on its latest commit, so nothing can
merge now. Two pull requests are waiting: #88 (Wi-Fi calling must not count as cell service) and
the upload function for #15. The Play deploy job is also on Actions, but it fails anyway while the
app is suspended (#2).

This repo is private. Its CI is one Android build (lint, unit tests, debug build) of about 2-4
minutes per run, run on every pull request and on every merge to main. Geode's CI already runs on
self-hosted runners on the workstation (`~/projects/geode/.github/workflows/ci.yml`: "Jobs run on
the homelab runners, the four on the workstation").

## Option fix-billing

You fix it under Settings > Billing and plans; a session reruns the waiting pull requests' CI.

## Option self-hosted

A session writes `deploy/runner/` docs and changes `runs-on` in `ci.yml` to
`${{ fromJSON(vars.CI_RUNS_ON || '["self-hosted","cellsignalmapper"]') }}`, as Geode does; you
register the runner once with the token from the repo's Settings > Actions > Runners. The first
job it runs shows whether the billing block also stops self-hosted jobs.

## Option public

Issues #2 and #4 first, then Settings > General > Change visibility.

## Sources

- The failed job's message, run 43362555574.
- `~/projects/geode/.github/workflows/ci.yml` lines 23 and 30.
- `~/projects/geode/plans/refactor/phase-h.md`, H-02: hosted minutes for Geode's suite would cost about US$340 a month, so CI stayed on the workstation runners.
- [The Register, 2025-12-17](https://www.theregister.com/2025/12/17/github_charge_dev_own_hardware/): "GitHub walks back plan to charge for self-hosted runners"; [GitHub changelog, 2025-12-16](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/).
