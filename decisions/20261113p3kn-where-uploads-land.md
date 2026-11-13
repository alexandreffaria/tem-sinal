---
id: "20261113p3kn"
title: Where should uploaded signal samples land, now that we're redoing the architecture?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T00:28:15Z
created_by: claude-code
tags: [architecture, backend]
depends_on: []
recommendation:
  option: firebase-functions
  why: >-
    It keeps the Firebase project and SDK the app already has, gets real server-side validation
    and throttling, and keeps the scheduled aggregation and the public map in the same project, so
    nothing depends on GitHub's schedule limits or on whether the repo is public. The public half
    (hex files plus a MapLibre page) is the same in every option, so switching later means changing
    the app's upload module and one job, not the map. This depends on you being fine putting a
    billing account (with a budget alert) on the Firebase project. If not, pick firebase-rules; if
    you'd rather write SQL than functions, pick supabase.
options:
  - id: firebase-rules
    title: Firestore with strict rules; a GitHub Actions job publishes the map
    summary: The app writes samples straight to Firestore (anonymous auth, App Check, create-only rules); an hourly Actions job aggregates new samples into hexes and publishes static files to GitHub Pages.
    pros:
      - No billing account; Firestore's free quota (20k writes a day) covers about 28 contributor-hours of logging a day at the app's 5 s interval.
      - Nothing to run or patch.
      - The Firebase project and SDK are already in the app.
    cons:
      - Rules can check types, ranges, field sets and string lengths, but they can't rate-limit; App Check raises the bar but isn't a guarantee.
      - Scheduled workflows in a public repo are disabled after 60 days without repository activity, and Pages from a private repo needs a paid GitHub plan.
      - The job needs Google credentials (Workload Identity Federation from Actions, not a stored key), and it must read only new samples, since reads are billed per document.
  - id: firebase-functions
    title: Firestore behind a Cloud Function; a scheduled function publishes the map
    summary: The app sends batches to an HTTPS Cloud Function that verifies the App Check token, validates, throttles per install and writes to Firestore; a scheduled function aggregates into hexes and writes static files to Firebase Hosting or Cloud Storage.
    pros:
      - Real code validates every sample and throttles per install, before anything is stored.
      - Uploads, aggregation and the public map live in the one Firebase project the app already uses; no GitHub schedule or Pages limits.
      - The Blaze plan's free allowances (2M function calls a month, the Firestore free quota, 3 Cloud Scheduler jobs per billing account) cover this scale.
    cons:
      - Needs the Blaze (pay-as-you-go) plan, so a billing account on the project; set a budget alert.
      - Functions for Firebase are Node.js (JS/TS) or Python, with Dart experimental; Go is only possible as a plain Cloud Run function.
      - Hosting's free egress is 360 MB a day; past that, map traffic is billed, unlike R2 or Pages.
  - id: supabase
    title: Supabase (Postgres with PostGIS), Edge Functions for uploads and publishing
    summary: The app posts batches to a Supabase Edge Function that validates, computes H3 cells with h3-js and inserts into Postgres; PostGIS aggregates in SQL on a pg_cron schedule, which then calls an Edge Function that writes the hex files to Supabase Storage behind its CDN.
    pros:
      - SQL and PostGIS for everything (ad-hoc questions, re-aggregation, exports), the Postgres you already know from Geode, with nothing to run.
      - Row-level security and an Edge Function give real validation.
      - Easy to move to your own Postgres later; it's plain Postgres.
    cons:
      - Free projects pause after a week without activity, which a quiet map will hit; avoiding that means the Pro plan, US$25 a month.
      - The free database is 500 MB, so raw samples need pruning once aggregated; and h3-pg isn't on Supabase's extension list, so hex indexing happens in an Edge Function rather than SQL.
      - The app drops Firebase and gets its own upload client and retry logic.
  - id: workers
    title: A Cloudflare Worker takes uploads, D1 stores them, a cron publishes the map
    summary: The app posts batches to a Worker that validates them and checks Play Integrity; raw samples go to D1 (SQLite); a cron trigger writes hex files to R2; Pages hosts the map.
    pros:
      - Real code validates every sample before anything is stored, with approximate per-location rate limits.
      - R2 has no egress fees, and Pages is free, so the public map costs nothing even under heavy traffic.
      - Uploads, storage, aggregation and the map live on one platform, with one deploy.
    cons:
      - On the free plan a cron run gets 10 ms of CPU, so aggregation likely needs Workers Paid (US$5 a month minimum).
      - Checking Play Integrity on the server needs a Google Cloud service account stored as a Worker secret.
      - A new platform and a TypeScript codebase, and D1 caps a database at 500 MB free or 10 GB paid.
resolution:
  choice: firebase-functions
  resolved_at: 2026-11-13T00:47:08Z
---

## Context

The goal is a public link where anyone can plan a climb and see where each carrier has signal,
built from samples users upload. Today:

- The Android app writes raw samples to Firestore (`signal_logs`, project `cellsignalmapper-a9da1`)
  after anonymous sign-in. The rules let any signed-in (anonymous) client create, overwrite or
  delete any document. App Check isn't in the app yet.
- Whichever option wins, the app's uploader gets reworked anyway (audit B4): it sends the whole
  log as one batch, which Firestore caps at 500 writes, and it overwrites by a client-chosen id.
- The companion `signal-heatmap` (public repo, last commit 2025-05-30) is a Go server on Cloud Run.
  It loads **every** Firestore document into memory at start, polls every 10 s, and serves all raw
  points as JSON to a Leaflet page.
- The only data so far is 241 test points from one night in 2025, so nothing has to be migrated.

The proposed shape is the same in every option. The phone keeps an offline queue. Raw samples are
private. A scheduled job turns them into H3 hexagon cells with per-carrier stats. The public map is
a static MapLibre page reading static files from a CDN. What the cells show is a separate card.
This card decides where uploads land and where the aggregation runs.

Also considered: a Go API with PostGIS on a small VPS of its own (about US$5 to 10 a month, plus
patching, backups and monitoring). Not on Geode's host: a public upload endpoint next to finance
data widens what an attacker can reach. It's left out here as the most work before a first map;
say so if you want it instead.

## Option firebase-rules

Rules allow `create` only, check field types and ranges, and limit the field set
(`keys().hasOnly([...])`) and string lengths. An hourly Actions job reads samples newer than its
last cursor and publishes to Pages.

## Option firebase-functions

`POST /v1/samples` with a batch of up to a few hundred samples. The function verifies the
`X-Firebase-AppCheck` header with the Admin SDK (or is a callable function with
`enforceAppCheck: true`), checks the schema and a per-install budget, then writes. A scheduled function updates the hexes
hourly.

## Option supabase

An Edge Function `samples` inserts rows. A `pg_cron` job runs the aggregation SQL hourly, then
calls an Edge Function through `pg_net`, and that function writes the hex files to Storage.

## Option workers

`POST /v1/samples` to a Worker. A cron trigger updates the hexes and writes them to R2.

## Sources

- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing): free 50k reads and 20k writes a day.
- [Firestore rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions): checks on `request.resource.data`.
- [App Check with Play Integrity](https://firebase.google.com/docs/app-check/android/play-integrity-provider).
- [Cloud Functions for Firebase pricing](https://firebase.google.com/pricing): Blaze plan, 2M invocations a month free.
- [GitHub Actions schedule event](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows): scheduled workflows in public repos are disabled after 60 days without activity.
- [Supabase pricing](https://supabase.com/pricing): free projects pause after 1 week of inactivity; 500 MB database. [Supabase extensions](https://supabase.com/docs/guides/database/extensions): no h3-pg ([supabase/postgres#664](https://github.com/supabase/postgres/issues/664)).
- [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing); [App Check on a custom backend](https://firebase.google.com/docs/app-check/custom-resource-backend); [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans): Pages on private repos needs a paid plan; [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): US$5 a month minimum.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 10 ms CPU per invocation on Free; [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/); [D1 limits](https://developers.cloudflare.com/d1/platform/limits/); [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- `signal-heatmap/main.go`: `loadAll` reads the whole `signal_logs` collection at startup.
