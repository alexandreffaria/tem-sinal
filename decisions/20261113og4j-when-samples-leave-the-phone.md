---
id: "20261113og4j"
title: When should logged samples leave the phone?
status: resolved
kind: choice
priority: normal
created: 2026-11-13T17:29:03Z
created_by: claude-code
tags: [privacy, product, ux]
depends_on: []
recommendation:
  option: one-button
  why: >-
    The map fills without a second step, and the app already sends everything at the next start,
    so this mostly removes a button that decides little. It follows one reading of your note
    (pressing LOG is the choice to share). If you meant that nothing leaves until the person
    asks, pick review. Pick hold if you want people to be able to throw away a session (one
    started at home, say) before it goes, at the cost of a delay before data reaches the map.
options:
  - id: today
    title: Keep LOG and "Send my data" as they are
    summary: LOG/STOP records; samples are sent when the person presses "Send my data" and also, without a press, at the next app start.
    pros:
      - Nothing to change.
      - Samples reach the server at the next app start (if online then) even if the person never presses Send, and Send lets them go sooner (say, once on Wi-Fi).
    cons:
      - Two buttons suggest that sending is a separate choice, but Send decides only when, not whether; the app sends anyway at the next start.
      - Nobody can hold back a session, and nobody sees what is sent before it goes.
  - id: one-button
    title: LOG is the only button and also means "share"
    summary: Pressing LOG records and shares; samples are sent automatically when logging stops and when the app starts, retrying until they go, and "Send my data" is removed.
    pros:
      - One decision, made once, matching what the app already does in practice.
      - The simplest screen; the pending count can stay as a sign that something is still to be sent.
      - The map fills without anyone remembering to send.
    cons:
      - Nobody can hold back a session once it is recorded, for example one started at home by mistake; only the server's trim protects it.
      - "New work: an upload when logging stops and a background retry (for example WorkManager), with sign-in outside the main screen; today only starting the app retries; it can use today's uploader, and later the upload function of issue 87."
      - Anyone who wants to record for themselves without sharing can't (as today).
  - id: hold
    title: Sent automatically after a hold, with a delete
    summary: As one-button, but each stopped session waits on the phone for a set time (say 12 hours) before it is sent, and the main screen lists waiting sessions with "delete this session".
    pros:
      - A session started at home or in the car by mistake can be deleted before it leaves, without anyone having to remember to send.
      - Data still reaches the map without a second press.
    cons:
      - Every session reaches the map later, by the length of the hold.
      - The same background upload work as one-button, plus a list of waiting sessions and a delete, and the upload on app start must skip sessions still held.
      - Deleting a session is a place the app drops samples on purpose (by the person's own press, never silently).
  - id: review
    title: Nothing is sent until the person reviews and sends it
    summary: Samples stay on the phone until the person presses "Send my data"; the upload on app start is removed. Optionally, before sending, the app lists the sessions so any can be deleted first.
    pros:
      - The person decides, session by session, what leaves the phone, and nothing goes without an explicit press.
      - Matches "click when you DO want to send the information" taken literally.
    cons:
      - People who forget to send leave samples waiting on the phone longer, and a lost or reset phone loses more of them.
      - The map is staler, since data arrives only when people remember to send.
      - The optional session list is another screen to build, and deleting a session drops samples on purpose.
resolution:
  choice: one-button
  resolved_at: 2026-11-13T18:43:46Z
---

## Context

Your note on card `20261113nk9r` (2026-11-13) says: "The way I naturally thought about it is
having the only big button, that you click when you DO want to send the information". It can be
read two ways: pressing the big button is the choice to share (so nothing else is needed), or
data leaves the phone only when the person asks it to. The app today does neither cleanly:

- The big round button (200 dp) says LOG, and STOP while logging. It starts and stops the
  recording service; samples go to a file in the app's private storage (`MainActivity.kt`,
  `LoggerButton.kt`).
- A smaller "Send my data" button appears under it whenever samples are waiting, and sends them.
- Every time the app starts (not when it is brought back from the background) it also sends
  whatever is waiting, after signing in anonymously (`MainActivity.onCreate`, "Retry upload on
  start"), including the session still being recorded. So the samples go at the next start even
  if "Send my data" is never pressed. Nothing else retries in the background.
- A failed send keeps the samples on the phone (`FirebaseUploader.kt`); that rule stays in every
  option.

Already filed: a "What is shared?" explanation on the main screen (issue 157), a hint after an
indoor start suggesting logging on the trail (issue 156), and a view of the exact data that is
sent (issue 158). Under one-button the explanation would also need to say that pressing LOG
shares what is recorded; it is not shown before the first press unless opened, since issue 157
adds no consent screen. Under one-button and hold, samples leave soon after STOP, so the
preview of issue 158 needs to keep or build a sample to show; under review it becomes part of the
send screen. This card decides only when samples leave the phone, and so what the buttons are.

## Option today: Keep LOG and "Send my data" as they are

```
   1240 pending points stored
   [ LOG ]            big
   [ Send my data ]   when samples are waiting
   (and a silent send each time the app starts)
```

## Option one-button: LOG is the only button and also means "share"

```
   [ LOG ]            big; STOP while logging
   1240 pending points stored   (until they go)
   What is shared?    (issue 157)
```

Stopping sends the session; the app retries in the background and when it starts.

## Option hold: Sent automatically after a hold, with a delete

```
   [ LOG ]            big
   Waiting to be sent:
     Sat 7 Nov, 2 h 10 min, sends in 9 h   [delete]
   What is shared?    (issue 157)
```

## Option review: Nothing is sent until the person reviews and sends it

```
   1240 pending points stored
   [ LOG ]            big
   [ Send my data ]   the only way data leaves
     optional: Sat 7 Nov, 2 h 10 min   [delete]
               Sun 8 Nov, 45 min       [delete]
```

The silent send on app start is removed.

## Sources

- `app/src/main/java/dev/meuquerido/cellsignalmapper/LoggerButton.kt`: `Modifier.size(200.dp)`,
  `Text(if (isLogging) "STOP" else "LOG")`, and `if (pendingPoints > 0)` ... `Text("Send my data")`.
- `MainActivity.kt`, `onCreate`: `FirebaseUploader.uploadLogFile(this) { Log.d("MainActivity",
  "Retry upload on start: $it") }` after `signInAnonymously()` succeeds.
- `FirebaseUploader.kt`, `uploadLogFile`: "a failed or timed-out upload keeps it for the next
  attempt".
- [Issue 156](https://github.com/alexandreffaria/CellSignalMapper/issues/156): the indoor hint, "Logging keeps running; nothing is dropped or held back."
- [Issue 157](https://github.com/alexandreffaria/CellSignalMapper/issues/157): the explanation; "don't add a first-run screen or a consent gate."
- [Issue 158](https://github.com/alexandreffaria/CellSignalMapper/issues/158): the preview, of "the most recent logged sample (or the first pending one)".
- [Issue 87](https://github.com/alexandreffaria/CellSignalMapper/issues/87): the switch of uploads to the function.
