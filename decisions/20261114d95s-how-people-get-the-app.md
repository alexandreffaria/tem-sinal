---
id: "20261114d95s"
title: How should people get the app onto their phones?
status: resolved
kind: choice
priority: normal
created: 2026-11-14T04:12:49Z
created_by: claude-code
tags: [distribution, play, release]
depends_on: []
recommendation:
  option: apk-then-play
  why: >-
    Friends can start logging this week while the 14-day Play test runs. If you can't find 12
    testers, pick apk.
options:
  - id: play
    title: Google Play only
    summary: >-
      Open a Play developer account (US$25 once, ID check); nobody else can install until a
      closed test with 12 testers has run 14 days and Google approves.
    pros:
      - Auto-updates and the easiest install
      - Already covers Google's 2027 sideloading rule
    cons:
      - Nobody outside the test gets it for 3+ weeks
      - Play review on each release (usually under 7 days)
  - id: apk
    title: An APK on GitHub Releases only
    summary: >-
      Each merge to main builds a signed APK on the repo's Releases page; people download and
      install it.
    pros:
      - Ships the day it's merged
      - No fee, review or ID check today
    cons:
      - No auto-update; people reinstall each release
      - "From 2027, installs need a 24-hour unlock unless you register (US$25, ID check)"
  - id: apk-then-play
    title: APK now, Play once the test passes
    summary: >-
      Ship the APK on GitHub Releases now, and start the Play account and its 12-tester test
      at the same time, uploading the APK's own signing key to Play so phones can switch without reinstalling.
    pros:
      - Usable now, on Play in about 3 weeks
      - Real samples come in while Play waits
    cons:
      - Two release paths to keep working for a while
      - Still needs 12 testers opted in for 14 days
resolution:
  choice: apk-then-play
  resolved_at: 2026-11-14T04:15:52Z
applied_at: 2026-11-14T04:18:34Z
---

## Context

The app has never been on Play, so nobody can install it today. Google's developer
verification, live in Brazil since 30 September 2026, covers only participating app stores;
direct APK downloads are unaffected until the global rollout in 2027.
