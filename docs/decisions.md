# Decisions

Settled decisions, newest first. Each links the president card it came from (`decisions/`).

## 2026-11-13: Scrub the leaked secrets from git history

After the keys are rotated, rewrite history to remove the keystore files, the service-account key,
the app bundle, the debug log and the hardcoded password, then force-push `main` once. Rewriting
before the review flow starts opening pull requests keeps the old commits from being pinned by
pull-request refs. Cards F-01 and F-04 in `plans/README.md`.

Card: `202611134udw` (choice: rewrite).

## 2026-11-13: Geode's rules and review loop, without its claims tooling

The project follows Geode's way of working: one card per pull request, never commit to `main`,
never merge your own pull request, a bounded second-session review against a checklist, and every
follow-up filed. It leaves out Geode's board script and claims, which solve many sessions at once;
the owner points each session at a card instead. Follow-ups are GitHub issues; owner questions
are president cards. See `plans/README.md`.

Card: `202611134p01` (choice: lite).
