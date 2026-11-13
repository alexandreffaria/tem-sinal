---
id: "20261113bmjv"
title: How long should the server keep raw signal samples?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T02:15:05Z
created_by: claude-code
tags: [privacy, backend, cost]
depends_on: ["20261113a7do", "20261113p3kn"]
recommendation:
  option: ninety-days
  why: >-
    Ninety days covers the longest wait before a sample reaches the public map (about 60 days for
    a cell only one install logged) plus a month to notice a bug in the aggregation (or a trimming
    that kept too much) and rerun it on raw samples. Month-level coverage history per cell survives
    in every option; longer windows add exact trails for finer analyses nobody has planned yet. A
    window can be shortened later, but data already deleted can't come back. This assumes no
    anonymised archive (see Context); with one, after-publish loses much less. Pick after-publish if you'd rather hold
    nothing beyond what the map strictly needs; pick one-year if you expect to retune the grid or
    the strength rule during the first year.
options:
  - id: after-publish
    title: Delete each raw sample once the public files include it
    summary: A raw sample is deleted in the aggregation run after the published files include its cell, at most about 60 days after upload.
    pros:
      - The least personal data held, for the shortest time; the plainest fit with LGPD art. 6 III and art. 15 (stop once the data is no longer needed).
      - Most samples are gone within a day of upload (busy cells publish daily); lone-install cells within about 60 days. A leak exposes little beyond that, plus the install ids kept for lone cells.
      - The smallest storage of any option.
    cons:
      - A bug in the aggregation, or a finer grid or a new headline-strength rule, can never be applied to past samples; the map keeps whatever the job computed. (An anonymised archive, see Context, would still allow strength-rule changes and most bug fixes.)
      - A session uploaded in several batches, days apart, can't have its trimming redone once its first part is published and deleted.
      - The job has to get the running statistics right the first time, since nothing can rebuild them.
  - id: ninety-days
    title: Keep raw samples 90 days, then delete them
    summary: A raw sample is deleted 90 days after the server received it; the map keeps its running statistics.
    pros:
      - A month beyond the longest wait to the map, to catch a bug and rerun the aggregation on raw samples.
      - Still a short window; a leak exposes about three months of traces.
      - One fixed rule that Firestore's TTL policy can apply by itself, with no deletion job beyond the trimming and on-request deletes every option has.
    cons:
      - Rules changed after 90 days apply only to new samples; older cells keep their old statistics.
      - Holds exact traces up to about three months longer than after-publish for samples in busy cells, and one to two months longer for lone-install cells, for a purpose (fixing bugs) that may never arise.
      - No raw data for analyses that need more than three months; and if the aggregation were broken for over 90 days, samples would expire before being counted.
  - id: one-year
    title: Keep raw samples for 12 months, then delete them
    summary: A raw sample is deleted 12 months after the server received it; the map keeps its running statistics.
    pros:
      - A whole year to retune the grid or the strength rule (or lengthen the trimming) and rerun everything from the last 12 months on real data.
      - A year of detail the statistics don't keep (exact times, positions finer than the 50 m cell, which tower or sector served, RSRQ, SINR and the other metrics).
      - Also a single TTL rule.
    cons:
      - A year of exact traces per contributor sits on the server, and a leak exposes all of it.
      - Hard to argue as "o mínimo necessário" (art. 6 III) while the map itself needs only aggregates.
      - About four times the stored data of ninety-days, at a steady upload rate.
  - id: indefinite
    title: Keep every raw sample
    summary: Raw samples are deleted only when a contributor asks; the map can always be rebuilt from scratch.
    pros:
      - Any future rule change or analysis can use all past data, and the map can be rebuilt from scratch at any time (except with a shorter trimming).
      - Full detail forever (exact times and positions, serving tower and sector, every metric), beyond the month-level history per cell that every option keeps.
      - No retention rule to choose or tune.
    cons:
      - Every contributor's full history of where they went is held forever, the worst case in a leak or a legal request.
      - Hard to argue under art. 6 III and art. 15 if the public map needs only aggregates; art. 16 says personal data "serão eliminados após o término de seu tratamento".
      - Storage grows without limit, and samples from before a reinstall can never be found by the person's new install id, so they stay forever even after a deletion request.
resolution:
  choice: ninety-days
  resolved_at: 2026-11-13T02:32:50Z
---

## Context

The phone uploads raw samples: exact coordinates, exact times, cell identities, and a
pseudonymous install id and session id (the v2 schema, `docs/sample-schema.md`, issue #11). Card
`20261113p3kn` put them in Firestore behind a Cloud Function; card `20261113a7do` fixed that only
aggregates are public and that cells logged by a single install are published in monthly batches
once their first sample is 30 days old, so a sample can wait up to about 60 days before it is on
the map.

Nothing decides yet how long raw samples stay on the server after that. The answer changes what
the aggregation job (#16) must store and what can be fixed later.

**The same in every option:**

- The job keeps private running statistics per map cell, carrier and month, forever: the sample
  count, the best strength, a 1 dB strength histogram (a median can't be computed from totals),
  the network types seen, whether emergency-only was seen, and the install id while the cell has
  one contributor. The map is built from these once raw samples are gone, and they already give a
  month-by-month coverage history per cell (after a new tower, say) and show which crags need more
  contributors. Raw samples add only detail beyond that: time finer than a month, position finer
  than the 50 m cell, which tower or sector served, the other metrics, and a finer grid or a new
  strength rule applied to old data. The install ids in these statistics are personal data too,
  kept in every option, and a deletion request removes them as well; once a cell has two
  contributors, a person's counts can't be taken out of it unless their raw samples are still
  held.
- Samples dropped by the session trimming are deleted when they are trimmed, so a rerun can only
  lengthen the trimming, never undo it.
- The running statistics are kept per month, so a rerun recomputes the months whose samples are
  still held and leaves older months as they were.
- Age is counted from a receive time the Cloud Function stamps, not from the phone's `timeMs`,
  which can be wrong. Firestore's TTL policy can delete by that field ("Data is typically deleted
  within 24 hours after its expiration date"); TTL deletes are billed as deletes and get no free
  quota (the Blaze plan is already required). Expired documents still show in queries until they
  are deleted, so the job filters on the receive time. `receivedAt` and `expiresAt` are new
  server-side fields, not part of the phone's v2 schema.
- The project deletes a contributor's data by install id on request, whatever the legal basis
  (set elsewhere); LGPD art. 18 VI gives that right when the basis is consent.
- A window can be shortened later (a lower TTL, a one-off delete); a longer one applies only to
  samples not yet deleted.
- Whether to keep an anonymised archive after raw samples are deleted (rows with only the map
  cell, month, carrier and strengths, no ids or exact times) is a separate question, not decided
  here; it can follow any of these answers. It matters most for after-publish: such rows would
  still let a new strength rule or a fixed aggregation be rerun on past data, losing only finer
  positions, times and serving-cell detail. The recommendation assumes no archive.

**On the phone,** the app deletes its log file after a successful upload. Today the Firestore SDK's
local cache may also keep a copy of uploaded documents, and unparseable lines stay in a rejected file;
both are outside this card and change when uploads move to the Cloud Function.

**Law.** LGPD art. 6 III limits processing to "o mínimo necessário"; art. 15 ends it when "os
dados deixaram de ser necessários"; art. 16 says personal data are then deleted, and of its four
exceptions the only one that fits here is IV (II is for research bodies), which requires the data to be anonymised. How long
is "necessary" depends on the declared purpose (only the public map, or also improving it and
studying coverage over time), which is a judgement call.

**Volume and cost.** At the app's 5-second interval, one hour of logging is about 720 samples. A
sample is about 1 KB of JSON; Firestore adds two index entries (ascending and descending) for
every field by default, each carrying the document name, so stored size is several times that (not measured; exempting fields that are never
queried from indexing cuts it in every option). Firestore's free quota is 1 GiB of stored data;
beyond it, storage is billed per GiB-month at the region's price. With 241 test points so far,
storage cost is likely small in every option for a long time, so cost is a weak argument here.

## Option after-publish: Delete each raw sample once the public files include it

The aggregation run that publishes a cell deletes the raw samples counted in it. A lone
contributor's cell waits up to about 60 days, so their samples stay that long.

## Option ninety-days: Keep raw samples 90 days, then delete them

A TTL policy on `expiresAt = receivedAt + 90 days`. The aggregation can be rerun on the last 90
days at any time.

## Option one-year: Keep raw samples for 12 months, then delete them

A TTL policy on `expiresAt = receivedAt + 365 days`.

## Option indefinite: Keep every raw sample

No TTL policy. Deletion only by install id, on request.

## Sources

- [LGPD, Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm):
  art. 6 III "necessidade: limitação do tratamento ao mínimo necessário para a realização de suas
  finalidades"; art. 15 I, processing ends on "verificação de que a finalidade foi alcançada ou de
  que os dados deixaram de ser necessários ou pertinentes ao alcance da finalidade específica
  almejada"; art. 16 caput "Os dados pessoais serão eliminados após o término de seu tratamento",
  IV "uso exclusivo do controlador, vedado seu acesso por terceiro, e desde que anonimizados os
  dados"; art. 18 VI, the data subject's right to "eliminação dos dados pessoais tratados com o
  consentimento do titular, exceto nas hipóteses previstas no art. 16 desta Lei".
- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing): "Stored data | 1 GiB"
  free, and TTL deletes are among the operations that "don't include free usage";
  [storage size calculations](https://firebase.google.com/docs/firestore/storage-size):
  field names, values and index entries count;
  [per-region prices](https://cloud.google.com/firestore/pricing).
- [Firestore TTL policies](https://firebase.google.com/docs/firestore/ttl): the field must be a
  date and time; "Data is typically deleted within 24 hours after its expiration date"; "TTL
  delete operations count towards your document delete costs".
- Card `20261113a7do` (monthly batches, 30-day hold) and card `20261113p3kn` (Firestore behind a
  Cloud Function, Blaze plan).
