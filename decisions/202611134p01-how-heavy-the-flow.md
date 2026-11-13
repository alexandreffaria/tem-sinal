---
id: "202611134p01"
title: How much of Geode's development flow should CellSignalMapper copy?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T00:14:06Z
created_by: claude-code
tags: [process, flow]
depends_on: []
recommendation:
  option: lite
  why: >-
    The project is about 810 lines with one owner and, for now, one or two sessions at a time.
    The parts of Geode's flow that catch bugs are the second-session review against a checklist
    and filing every follow-up; the claims machinery solves many-sessions-at-once, which this
    project doesn't have yet. Moving up to "full" later is cheap, because cards and issues keep the
    same shape.
options:
  - id: full
    title: Port Geode's flow as it is, claims script included
    summary: Copy plans/refactor/README.md's rules, the board script with GitHub-ref claims and decisions, pr-guard CI and the review-pr skill.
    pros:
      - Many sessions can work in parallel without stepping on each other.
      - Same commands and habits in both projects.
      - CI enforces branch naming and claims.
    cons:
      - About 1,350 lines of tooling to adapt and maintain (refactor-board.py alone is 1,250, plus the claims and pr-guard workflows), more than the app itself.
      - Owner questions are recorded with the script's decide command, which overlaps with president cards.
      - Most of the work in phase 0 becomes porting tooling instead of fixing the app.
  - id: lite
    title: Geode's rules and review loop, without the claims tooling
    summary: Same rules (one card per PR, never merge your own, bounded review, follow-ups always filed), a markdown board in plans/README.md, follow-ups as GitHub issues, owner questions as president cards.
    pros:
      - The review loop, which is where bugs get caught, is identical to Geode's.
      - Four docs to write (CLAUDE.md, plans/README.md, REVIEW_CHECKLIST.md, review-pr skill) plus one PR workflow running lint, unit tests and a debug build.
      - Owner decisions go to president instead of a second system.
    cons:
      - Nothing stops two sessions from taking the same card; you have to point each session at one.
      - Branch and title rules are checked by the reviewer, not by CI.
  - id: minimal
    title: Just the review step
    summary: A REVIEW_CHECKLIST.md and the review-pr skill; no board, no cards; you tell each session what to do.
    pros:
      - Almost nothing to set up.
      - No bookkeeping for sessions to get wrong.
    cons:
      - The audit's task list lives only in the audit doc, so it rots.
      - Follow-ups found in review have no agreed home, so they're easy to drop.
      - A session with no context can't pick up work on its own.
resolution:
  choice: lite
  resolved_at: 2026-11-13T00:20:48Z
applied_at: 2026-11-13T02:32:31Z
---

## Context

You asked to bring Geode's development flow, and its review loop in particular, to
CellSignalMapper. Geode's version (`~/projects/geode/plans/refactor/README.md`) has two parts:

1. **Rules and the review loop:** one task card per session and PR, never commit to `main`,
   never merge your own PR, at most about 400 changed lines, and `/review-pr` by a session that
   didn't write the code, checked against `.github/REVIEW_CHECKLIST.md`. You get one review, one
   round of fixes and one confirmation. Blocking findings get fixed and follow-ups get filed as
   issues.
2. **Coordination tooling:** `scripts/refactor-board.py` with claims stored as git refs on
   GitHub, `decide` for owner answers, stale-claim takeover, and CI workflows that check claims
   and branch names. It exists because many Geode sessions run at once.

CellSignalMapper is about 810 lines of app Kotlin (850 counting the template tests) with no tests. The audit
(`plans/audit-2026-11-12.md`) proposes about 20 cards. One constraint either way: GitHub
won't turn on branch protection for this private repo on a free plan, so "never push to main"
holds only because the sessions follow it. A push to `main` also publishes to Play.

## Option full: Port Geode's flow as it is

Copy and adapt `refactor-board.py`, `refactor-claims.yml`, `pr-guard.yml` and the README rules.
Every session starts with `scripts/board.py claim --next --who "…"`.

## Option lite: Rules and review loop, no claims tooling

`plans/README.md` holds the rules, the checks
(`./gradlew lintDebug testDebugUnitTest assembleDebug`), the PR template and the board as a
checklist. You start a session with "Do card B-01 from plans/README.md." The reviewer runs
`/review-pr <n>`, files follow-ups with `gh issue create --label board`, and merges when it's
clean. Questions for you become president cards.

## Option minimal: Just the review step

Only `.github/REVIEW_CHECKLIST.md` and `.claude/skills/review-pr/SKILL.md`. You tell each
session what to do in chat.

## Sources

- `~/projects/geode/plans/refactor/README.md`, "Claims" and "Merging".
- `~/projects/geode/.github/REVIEW_CHECKLIST.md` and `.claude/skills/review-pr/SKILL.md`: the review loop.
- `wc -l` in Geode: `scripts/refactor-board.py` 1,250, `refactor-claims.yml` 40, `pr-guard.yml` 65.
- GitHub API on this repo: "Upgrade to GitHub Pro or make this repository public to enable this feature."
