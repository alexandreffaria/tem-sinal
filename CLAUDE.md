# CellSignalMapper

An Android app that crowdsources cell signal across Brazil, so climbers and anyone heading into the
backcountry can see, before they go, where each carrier has signal and where only emergency calls
get through. The app logs samples offline and uploads them later; a public map shows the
aggregated result.

The rules and the checks are in `plans/README.md`; the work is the GitHub issues labelled `board`.
Read it before doing anything; its rules apply to every session. Where the project stands and why: `plans/audit-2026-11-12.md`.
Settled decisions: `docs/decisions.md`.

The repo is [alexandreffaria/tem-sinal](https://github.com/alexandreffaria/tem-sinal). Issue and
pull request numbers from before the move (in commits, docs and cards) refer to the archive,
`alexandreffaria/CellSignalMapper`; `plans/README.md` maps the moved issues' old numbers to new.

## The short version

- Take the next ready `board` issue (see `plans/README.md`); one issue, one pull request.
- Never commit to `main`. Branch from an up-to-date `main`.
- After opening a pull request, start a fresh session (a subagent) to run `/review-pr` on it. It
  files follow-ups as issues and merges once the checks pass and nothing blocking is left. Never merge
  your own pull request. The owner never has to start a review.
- A merge to `main` that changes the app publishes a signed APK release on GitHub Releases.
  Merge one at a time.
- Ask the owner as little as possible. Their decisions go in president decision cards
  (`decisions/`, the `decision-cards` skill), written whenever one comes up, never as chat
  questions or guesses; keep working on what doesn't depend on the answer. Never commit files
  under `decisions/`.
- Code that stays is good code; bad code is deleted. Never add a second way to do something
  without removing the first.

## Rules that protect people

- Location samples are personal data. Never commit or print real samples, coordinates, logs or
  exports; fixtures use made-up places. Only aggregates are ever public.
- Never read or print key files, keystores, passwords or service-account JSON.
- No sample is ever dropped silently: a failed upload keeps the data on the phone.

## Checks

The `CI` workflow runs `scripts/check.sh` on every pull request; a green `CI` run on the latest
commit is the checks passing, and `main` can't take a merge without it. Run `scripts/check.sh` on
this machine before opening the pull request and before each push (it needs Node and npm, and
installs JDK 17 and the Android SDK on first use).
