# Sample schema, version 2

Issue numbers here written before the move to tem-sinal are the archive's,
`alexandreffaria/CellSignalMapper#n` (see `plans/README.md`, "Numbers from before the move").

What the phone records on each logging tick, field by field, and where each value comes from on
Android. The Kotlin types are in `app/src/main/java/dev/meuquerido/cellsignalmapper/Sample.kt`;
their property names are the wire names, in the log file on the phone, in JSON sent to the server
and in Firestore. `minSdk` is 30 (Android 11), so every API below is available unless a row says
otherwise.

## Rules that hold for every field

- **One sample per tick that has a location fix.** No fix, no sample. A tick with a fix and no
  signal is a sample: "no signal here" is the most useful fact for planning. Ticks start every
  5 s, and no tick is skipped as a repeat of the last, so in a session each sample stands for 5 s
  whatever the service state.
- **No active subscription, no sample.** Every sample has at least one entry in `sims`, because
  every carrier fact is tied to a subscription.
- **Unavailable is `null`, never a sentinel.** Android reports a missing int as
  `CellInfo.UNAVAILABLE` (`Integer.MAX_VALUE`, API 29), a missing long as
  `CellInfo.UNAVAILABLE_LONG` (`Long.MAX_VALUE`, API 29), a missing string as `null` or `""`, and
  some values only behind a `has...()` check. All of these become `null`. So does any value outside
  the range in the tables below: phones do report out-of-range values (`0`, `-1`, all bits set).
  `-999`, `99` and `Integer.MAX_VALUE` never appear in a sample.
- **A field that is `null` may be left out.** Gson omits nulls; Firestore stores them. Readers treat
  a missing field and `null` alike.
- **Every change to this schema is a new `schemaVersion`.** That includes adding a nullable field
  or an enum value, because the server rejects fields and values it doesn't know (#15).
- **Enums are written as their names** (`"LTE"`, `"EMERGENCY_ONLY"`). No property name starts with
  `is`, so Gson (which uses field names) and Firestore (which uses getter names) write the same
  name.

## Sample

| Field | Type | Unit | Null | Source (API level) |
|---|---|---|---|---|
| `schemaVersion` | Int | | never | the constant `SAMPLE_SCHEMA_VERSION`, `2` |
| `id` | String | | never | `java.util.UUID.randomUUID()`, a random (version 4) UUID, new for every sample |
| `installId` | String | | never | the install id, see below |
| `sessionId` | String | | never | the session id, see below |
| `timeMs` | Long | ms since the Unix epoch, UTC | never | `System.currentTimeMillis()` when the sample was built |
| `elapsedRealtimeMs` | Long | ms since boot | never | `SystemClock.elapsedRealtime()` (1) when the sample was built |
| `fix` | Fix | | never | see **Fix** |
| `sims` | List of SimReading | | never, at least one | one per active subscription, see **SimReading** |

The random `id` replaces the old id derived from carrier, position and dBm, which made two people's
identical readings overwrite each other. The server accepts a sample id once (#15), so uploading
the same sample twice is harmless.

### Install id

A pseudonymous id for this installation of the app, so the server can throttle uploads per install
(#15).

- **Generated** on first use as `UUID.randomUUID().toString()` (a version 4 UUID from a
  cryptographically strong generator), the way Android's identifier guide recommends for an
  app-scoped id ("Use a Firebase installation ID (FID) or a privately stored GUID").
- **Stored** in a file in `Context.getNoBackupFilesDir()` (API 21). The app has `allowBackup`
  on, and Auto Backup copies `filesDir` and shared preferences to the user's Google account; a
  restored id would make a second phone count as the same install. Files in `noBackupFilesDir` are
  never backed up.
- **Lifetime:** until the app's data is cleared or the app is uninstalled. It is never rotated.
- **Not the Android ID** (`Settings.Secure.ANDROID_ID`). On Android 8 and later it is "unique to
  each combination of app-signing key, user, and device" and changes only "if a factory reset is
  performed on the device or if an APK signing key changes". It survives uninstalling and clearing
  data, so the user has no way to break the link between their old and new samples short of a
  factory reset. The same goes for anything else tied to the hardware or the SIM (IMEI, IMSI,
  ICCID, phone number, MAC), which an app can't read anyway, and for the Advertising ID, which Play
  allows only for ads. The Firebase installation ID would also work, but it is shared with every
  Firebase SDK in the app; our own id keeps the link between samples under our control.

### Session id

A random UUID (version 4) made when `LoggerService` starts (`onCreate`) and kept in memory only. It
ends when the service stops; a service the system restarts gets a new one. Every sample of one
logging session shares it, so the aggregation job can drop the places where the phone rested half an hour or more at the start and end of each
session before aggregating (card `20261113a7do`). A session can be uploaded in several batches and
reach the server days late, so the job treats a session as finished only once it has had no new
sample for a while; that is the job's rule to set (#16).

## Fix

From the `android.location.Location` that the fused location provider delivered, the most recent
one no older than `MAX_FIX_AGE_MILLIS` (`LocationFix.kt`). Permission: `ACCESS_FINE_LOCATION`, with
the service's foreground type `location`.

| Field | Type | Unit | Null | Source (API level) |
|---|---|---|---|---|
| `lat` | Double | degrees, WGS84 | never | `getLatitude()` (1), rounded to 5 decimals (about 1.1 m) by `roundCoordinate` |
| `lon` | Double | degrees, WGS84 | never | `getLongitude()` (1), rounded the same way |
| `accuracyM` | Float | m, 68 % radius | when `hasAccuracy()` (1) is false | `getAccuracy()` (1) |
| `altitudeM` | Double | m above the WGS84 ellipsoid | when `hasAltitude()` (1) is false | `getAltitude()` (1) |
| `verticalAccuracyM` | Float | m, 68 % | when `hasVerticalAccuracy()` (26) is false | `getVerticalAccuracyMeters()` (26) |
| `timeMs` | Long | ms since the Unix epoch, UTC | never | `getTime()` (1) |
| `elapsedRealtimeMs` | Long | ms since boot | never | `getElapsedRealtimeNanos()` (17) / 1 000 000 |
| `mock` | Boolean | | never | `isFromMockProvider()` (18, deprecated in 31) on API 30, `isMock()` (31) on 31+ |

Altitude is ellipsoidal, not above sea level; Brazil's geoid separation is up to about 30 m. The
public map shows no altitude (card `2026111304re`), so the server never converts it. `Location.getMslAltitudeMeters()`
exists only from API 34, so it isn't recorded. `getTime()` comes from the satellite clock for GPS
fixes but may be the phone's clock for others, and the phone's clock can jump; order samples within
a session by `elapsedRealtimeMs`, never by `timeMs`. `mock` lets the server drop fixes from a mock
location app.

Consecutive samples can share the same fix (same `timeMs` and `elapsedRealtimeMs`) when no newer
one arrived, for as long as it is no older than `MAX_FIX_AGE_MILLIS`; each is still its own tick
with its own SIM readings, and samples are deduplicated by `id`, never by fix.

## SimReading

One per active subscription in `SubscriptionManager.getActiveSubscriptionInfoList()` (22,
`READ_PHONE_STATE`), read through `TelephonyManager.createForSubscriptionId(subId)` (24), which
pins every call below to that subscription.

| Field | Type | Unit | Null | Source (API level, permission) |
|---|---|---|---|---|
| `slot` | Int | 0-based SIM slot | when `INVALID_SIM_SLOT_INDEX` | `SubscriptionInfo.getSimSlotIndex()` (22, `READ_PHONE_STATE`) |
| `simPlmn` | String | MCC + MNC, 5 or 6 digits | when the SIM isn't ready (`""`); a value that isn't 5 or 6 digits is null | `TelephonyManager.getSimOperator()` (1, none) |
| `registeredPlmn` | String | MCC + MNC, 5 or 6 digits | when not registered; a value that isn't 5 or 6 digits is null | `ServiceState.getOperatorNumeric()` (1, needs a location permission or it is `null`) |
| `operatorName` | String | | when not registered | `ServiceState.getOperatorAlphaLong()` (1, same) |
| `serviceState` | ServiceStatus | | when `getServiceState()` returns `null` | see **Service state** |
| `overrideNetworkType` | OverrideNetworkType | | until the first display info arrives | see **5G NSA** |
| `cells` | List of CellReading | | when the modem didn't answer the request (timeout or `onError`) | `requestCellInfoUpdate()` (29, `ACCESS_FINE_LOCATION`), see **CellReading** |

`simPlmn` is the carrier the SIM belongs to; `registeredPlmn` is the network it is using, which
differs when roaming (national roaming and RAN sharing are common in rural Brazil). Carrier names
are mapped from PLMNs on the server; the app keeps no name table. `cells` empty means the modem
answered and saw no cell; `cells` null means nothing is known, which the server must not read as
"no signal".

The subscription id (`SubscriptionInfo.getSubscriptionId()`), the SIM's display name (which the
user can edit), the phone number and the ICCID are never recorded.

### Service state

`TelephonyManager.getServiceState()` (26) on the subscription's `TelephonyManager`, read on every
tick. Permission: `READ_PHONE_STATE` and `ACCESS_COARSE_LOCATION` (fine includes coarse). It can
return `null` when the subscription is inactive; then `serviceState` is `null`. The same object
also arrives through a listener, `PhoneStateListener.LISTEN_SERVICE_STATE` on API 30 and
`TelephonyCallback.ServiceStateListener` (31) on 31+, but reading it each tick needs no listener on
any level.

`serviceState` records whether a cellular network is reachable. Wi-Fi calling doesn't count: a
hut with Wi-Fi and no coverage is out of service.

`ServiceState.getState()` (1) is not the cellular voice registration state alone. AOSP's
`GsmCdmaPhone.getServiceState()` passes it through `mergeVoiceServiceStates` (`mergeServiceStates`
on Android 11, without the Telecom check): when cellular voice isn't in service, it raises the state
to `STATE_IN_SERVICE` if Telecom reports a phone account with voice calling (a carrier's Wi-Fi
calling app), or if IMS voice is registered and the data registration state is in service, which
`ServiceStateTracker.combinePsRegistrationStates` sets when the IWLAN registration is home and an
APN is on IWLAN, the Wi-Fi calling case. The merge copies everything else from the cellular state,
including `ServiceState.getNetworkRegistrationInfoList()` (30). So cellular service is decided from
the cellular (`TRANSPORT_TYPE_WWAN`) entries of that list, and Wi-Fi (`TRANSPORT_TYPE_WLAN`) entries
never count. AOSP always lists a cellular entry for each domain (`ServiceState.init()`), so a list
without one comes only from a phone that doesn't fill it; then `getState()` is all there is.

On phones whose IWLAN runs in legacy mode, Wi-Fi calling also shows up as a cellular entry.
`AccessNetworksManager.isInLegacyMode()` is true when `ro.telephony.iwlan_operation_mode` is
`legacy`, or unset with IRadio HAL 1.3 or older (phones that launched on Android 9 or earlier and
were upgraded to 11-13). There the modem reports IWLAN as the technology of the cellular data
registration: `ServiceStateTracker.processIwlanRegistrationInfo` leaves a `TRANSPORT_TYPE_WWAN`,
`DOMAIN_PS` entry with `getAccessNetworkTechnology()` (30) `== TelephonyManager.NETWORK_TYPE_IWLAN`
registered home, and adds one itself when the radio is off. So the cellular entries are the
`TRANSPORT_TYPE_WWAN` ones whose technology is not `NETWORK_TYPE_IWLAN`; below, "cellular" means
those, for registration, for emergency and for whether the list has a cellular entry.

Android's public constants include `STATE_EMERGENCY_ONLY`, but AOSP reports a phone that can only
make emergency calls as `STATE_OUT_OF_SERVICE` and keeps the emergency flag in a hidden field. The
public way to see it is the same list: AOSP's cellular network service lists only
`NetworkRegistrationInfo.SERVICE_TYPE_EMERGENCY` (30) in `getAvailableServices()` (30) when the
phone is in emergency-only state.

`getState() == STATE_POWER_OFF` means the radio is off: the merge only raises the state to in
service. The reverse doesn't hold with Wi-Fi calling. With the radio off,
`ServiceStateTracker.handlePollStateInternalForRadioOffOrUnavailable` sets `STATE_POWER_OFF` and
keeps the IWLAN registration, but `pollStateInternal` then still polls the modem when data is on
IWLAN, so the cellular voice state can come back out of service and the merge can raise it to in
service. The cellular entries can't tell either: radio off leaves them `REGISTRATION_STATE_UNKNOWN`,
which apps can't tell from not registered (the getters for it are system APIs), and the modem can
answer the poll with not registered. Airplane mode is a signal the merge doesn't change:
`Settings.Global.AIRPLANE_MODE_ON` (17), readable with no permission, read on every tick. Airplane
mode turns the cellular radio off (`PhoneGlobals.handleAirplaneModeChange`), unless the phone's
`Settings.Global.AIRPLANE_MODE_RADIOS` leaves the cellular radio out, so a registered cellular
network wins over it.

So `serviceState` is, in this order:

| Value | When |
|---|---|
| `POWER_OFF` | `getState() == STATE_POWER_OFF`, or airplane mode is on (`AIRPLANE_MODE_ON` is not 0) and no cellular `NetworkRegistrationInfo` is registered |
| `IN_SERVICE` | any cellular (`TRANSPORT_TYPE_WWAN`, not `NETWORK_TYPE_IWLAN`) `NetworkRegistrationInfo` is registered: `isRegistered()` (30, deprecated in 34) on API 30-33, `isNetworkRegistered()` (34) on 34+; or the list has no cellular entry and `getState() == STATE_IN_SERVICE` |
| `EMERGENCY_ONLY` | `getState() == STATE_EMERGENCY_ONLY`, or any cellular `NetworkRegistrationInfo` lists `SERVICE_TYPE_EMERGENCY` in `getAvailableServices()` |
| `OUT_OF_SERVICE` | otherwise, including a `getState()` of `STATE_IN_SERVICE` that no cellular registration backs |

With Wi-Fi calling at a spot without coverage, a sample is `OUT_OF_SERVICE`, or `EMERGENCY_ONLY`
when a cell offers emergency calls. In airplane mode with Wi-Fi calling it is `POWER_OFF`. With the
cellular radio off for another reason and Wi-Fi calling registered, it is `POWER_OFF` when
`getState()` says so and `OUT_OF_SERVICE` otherwise, since nothing public tells that apart from no
coverage.

The aggregation counts a SIM's reading towards coverage only when it says something about it. A
reading with `serviceState` `POWER_OFF` (the radio wasn't listening) or `null` (unknown) is left
out of every coverage figure: best and median strength, technology, and the reading counts
`serviceN`, `emergencyN` and `noServiceN`; the sample's other SIMs still count. A reading with
`cells` null still counts towards the count of its service state, since `serviceState` comes from
`getServiceState()` and not from the cell request, but adds no strength or technology. Strength
and technology come from `IN_SERVICE` readings only: a modem
in limited service can report the cell it is camped on as registered. A sample with no reading
that counts adds nothing to its cell. The app and the upload keep every sample as recorded.

AOSP sources, in `android.googlesource.com/platform`:

- `frameworks/opt/telephony`, `src/java/com/android/internal/telephony/GsmCdmaPhone.java`:
  `getServiceState()` and `mergeVoiceServiceStates` on `main`, `mergeServiceStates` on
  `android11-release`.
- `frameworks/opt/telephony`, `src/java/com/android/internal/telephony/ServiceStateTracker.java`:
  `combinePsRegistrationStates`, `pollStateInternal`,
  `handlePollStateInternalForRadioOffOrUnavailable`, and `processIwlanRegistrationInfo` on
  `android11-release` to `android13-release`.
- `frameworks/opt/telephony`, `src/java/com/android/internal/telephony/data/AccessNetworksManager.java`
  (`.../dataconnection/AccessNetworksManager.java` before Android 13): `isInLegacyMode`.
- `frameworks/base`, `telephony/java/android/telephony/ServiceState.java`: `init()`,
  `setOutOfService(boolean)`.
- `packages/services/Telephony`, `src/com/android/phone/PhoneGlobals.java`:
  `handleAirplaneModeChange`.

The emergency-only rule relies on AOSP behaviour that the reference docs don't state, and needs a
check on a real phone with a SIM whose carrier has no coverage (#47).

### 5G NSA

In 5G NSA (EN-DC), the phone is registered on an LTE cell (the anchor) and adds an NR cell as a
secondary for data. A sample records that as:

1. `overrideNetworkType` on the SimReading, from `TelephonyDisplayInfo.getOverrideNetworkType()`
   (30): `NONE`, `LTE_CA`, `LTE_ADVANCED_PRO`, `NR_NSA` or `NR_ADVANCED`. API 30 has no getter, so
   the logger keeps the latest value from a listener per subscription:
   `PhoneStateListener.LISTEN_DISPLAY_INFO_CHANGED` (30, deprecated in 31, needs `READ_PHONE_STATE`
   on Android 11) on API 30, `TelephonyCallback.DisplayInfoListener` (31, no permission) on 31+.
   `OVERRIDE_NETWORK_TYPE_NR_NSA_MMWAVE` (30, deprecated in 31 in favour of `NR_ADVANCED`, 31) is
   written as `NR_ADVANCED`. This is the value Android uses for the "5G" icon, which the docs call
   "for market branding or visualization purposes only"; the cells below are the measurement.
2. The LTE anchor as a CellReading with `rat` `LTE`, `registered` true and `connection`
   `PRIMARY_SERVING`.
3. The NR leg as a CellReading with `rat` `NR` and `connection` `SECONDARY_SERVING`, from the
   `CellInfoNr` in the `requestCellInfoUpdate()` result when there is one (`source` `CELL_INFO`;
   its identity is often only ARFCN and PCI). Many phones report no `CellInfoNr` in NSA; then, when
   the cells include a registered LTE cell (the anchor) and
   `TelephonyManager.getSignalStrength()` (28, no permission) on that subscription has a
   `CellSignalStrengthNr` (29) with any SS value, the NR leg is a CellReading with `source`
   `SIGNAL_STRENGTH`, `registered` false, every identity field null and only the SS values.
   Without an anchor there is no leg: an empty `cells` stays "no cell", and an SA registration
   whose modem reports no `CellInfoNr` isn't written as an NSA secondary. `getSignalStrength()` is
   read at a different moment from the cell list, so it can't stand for a cell on its own.

5G SA has no anchor: the NR cell itself is `registered`, `PRIMARY_SERVING`, from `CELL_INFO`.

## CellReading

One per cell in the `requestCellInfoUpdate()` result for the subscription (registered, serving and
neighbour cells), plus the NSA leg above. `requestCellInfoUpdate()` (29) asks the modem for fresh
values "from the current subscription"; `getAllCellInfo()` (17) returns a cached list from every
radio at once, which can't be told apart per SIM, so it isn't used. Both need
`ACCESS_FINE_LOCATION`. Cells of other technologies (`CellInfoCdma`, deprecated in 36, and
`CellInfoTdscdma`) are not recorded; neither is used in Brazil.

| Field | Type | Unit | Null | Source (API level) |
|---|---|---|---|---|
| `source` | CellSource | | never | `CELL_INFO` or `SIGNAL_STRENGTH` (see **5G NSA**) |
| `rat` | Rat | | never | the `CellInfo` subclass: `CellInfoGsm` (17) `GSM`, `CellInfoWcdma` (18) `WCDMA`, `CellInfoLte` (17) `LTE`, `CellInfoNr` (29) `NR` |
| `registered` | Boolean | | never | `CellInfo.isRegistered()` (17); false for `SIGNAL_STRENGTH` |
| `connection` | CellConnection | | for `CONNECTION_UNKNOWN` | `CellInfo.getCellConnectionStatus()` (28): `PRIMARY_SERVING`, `SECONDARY_SERVING`, `NONE` |
| `timestampMs` | Long | ms since boot | for `SIGNAL_STRENGTH` | `CellInfo.getTimestampMillis()` (30), when the modem measured it |
| `arfcn` | Int | channel number | when unavailable | GSM `getArfcn()` (24) 0..65535; WCDMA `getUarfcn()` (24) 0..65535; LTE `getEarfcn()` (24) 0..262143; NR `getNrarfcn()` (29) 0..3279165 |
| `pci` | Int | | when unavailable | GSM `getBsic()` (24) 0..63; WCDMA `getPsc()` (18) 0..511; LTE `getPci()` (17) 0..503; NR `getPci()` (29) 0..1007 |
| `plmn` | String | MCC + MNC, 5 or 6 digits | when either is unknown (usual for neighbours); a value that isn't 5 or 6 digits is null | `getMccString()` + `getMncString()` of the `CellIdentity` (28; 29 for NR) |
| `ci` | Long | | when unavailable | GSM `getCid()` (17) 0..65535; WCDMA `getCid()` (18) 0..268435455; LTE `getCi()` (17) 0..268435455; NR `getNci()` (29) 0..68719476735 (`UNAVAILABLE_LONG` when unknown) |
| `tac` | Int | | when unavailable | GSM and WCDMA `getLac()` (17, 18) 0..65535; LTE `getTac()` (17) 0..65535; NR `getTac()` (29) 0..16777215 |
| `rsrp` | Int | dBm | when unavailable, or not LTE/NR | LTE `CellSignalStrengthLte.getRsrp()` (26) -140..-43; NR `CellSignalStrengthNr.getSsRsrp()` (29) -156..-31 |
| `rsrq` | Int | dB | same | LTE `getRsrq()` (26) -34..3 (the reference page gives no range; this is 3GPP TS 36.133's extended range); NR `getSsRsrq()` (29) -43..20 |
| `sinr` | Int | dB | same | LTE `getRssnr()` (26) -20..30; NR `getSsSinr()` (29) -23..40 |
| `rssi` | Int | dBm | when unavailable, or not GSM/LTE | GSM `CellSignalStrengthGsm.getRssi()` (30) -113..-51; LTE `getRssi()` (29) -113..-51 |
| `rscp` | Int | dBm | when unavailable, or not WCDMA | `CellSignalStrengthWcdma.getDbm()` (18), the RSCP, -120..-24 |
| `ecno` | Int | dB | same | `CellSignalStrengthWcdma.getEcNo()` (30) -24..1 |

Strengths come from each cell's own `CellInfo.getCellSignalStrength()` (30), never from
`SignalStrength.getCellSignalStrengths().firstOrNull()`, which on NSA is often the LTE anchor and
isn't tied to the logged cell. The NR CSI values (`getCsiRsrp()` etc.) and timing advance are not
recorded: SS values are measured on every NR cell, and timing advance gives the distance to the
tower, which says more about the person than about coverage.

The headline strength for a cell, for the map's best and median, is `rsrp` for LTE and NR, `rscp`
for WCDMA and `rssi` for GSM.

A WCDMA `rscp` may be an RSSI. In AOSP (android11-release onwards) `CellSignalStrengthWcdma.getDbm()`
returns the RSCP when the modem reports one and the RSSI otherwise. An RSSI (-113..-51) falls inside
the RSCP range (-120..-24), so the range check keeps it, and it reads a little better than the RSCP
of the same cell would. API 30 has no public getter for the RSCP alone and no public flag for which
of the two `getDbm()` returned, so the two can't be told apart.

## Permissions

| Permission | Needed for |
|---|---|
| `ACCESS_FINE_LOCATION` | the fix; `requestCellInfoUpdate()` (it throws `SecurityException` with only approximate location, which Android 12+ lets the user pick); cell identity inside `ServiceState` |
| `ACCESS_COARSE_LOCATION` (held with fine) | `getServiceState()`; `registeredPlmn` and `operatorName` are `null` without a location permission |
| `READ_PHONE_STATE` | `getActiveSubscriptionInfoList()`, `getSimSlotIndex()`, `getServiceState()`, the display info listener on API 30 |
| none | `getSimOperator()`, `getSignalStrength()`, the display info listener on 31+, the install and session ids |

The manifest already declares all of them. The logger checks them before it starts (#9).

## Privacy

Card `20261113a7do` fixes what the public map shows: H3 resolution 11 cells with, per carrier, the
best and median strength, the network type, how many readings were in service, emergency-only
and out of service, and the month last seen (see **Public cells**). Raw samples stay private; the places where a session's phone rested half an hour or more at its
start or end are dropped before aggregation; every cell is published in the next daily run, however many installs back it.

**Personal data.** A sample as a whole is personal data under LGPD art. 5 I: an exact position and
time, linked by `installId` and `sessionId` to every other sample from the same person, is a trace
of where they live and go. Pseudonymous ids are still personal data, since they link a person's
samples. The fields that make it so are `fix` (position and both times), the sample's `timeMs` and
`elapsedRealtimeMs`, every cell's `timestampMs`, `installId`, `sessionId`, and the cell identities
(`ci`, `tac`, `pci` with `arfcn`), which locate a phone to a tower and a sector even without a fix.
Carrier facts (`simPlmn`, `registeredPlmn`, `serviceState`, strengths) are not personal on their
own but are part of the sample.

**Never read, so never leaves the phone:** IMEI, IMSI, ICCID, phone number, serial number, MAC,
Android ID, Advertising ID, the subscription id, the SIM's display name, the user's accounts.
`elapsedRealtimeMs` is time since boot; it leaves the phone only inside samples, for ordering.

**On the phone,** samples sit in app-private storage until uploaded; a failed upload keeps them.
They are never printed to the log, and fixtures and tests use made-up places.

**Firebase.** The first upload signs in to Firebase Auth anonymously
(`FirebaseUploader.upload`): that creates an anonymous account, which later uploads reuse until the
app's data is cleared. Firebase keeps that account's uid and its creation and sign-in times. The
app POSTs each batch to the upload function with the account's ID token, and with an App Check
token when it gets one. Every request to Auth, App Check and the upload function reaches Google
with the phone's IP address. Besides that, the SDKs send (firebase-auth 22.3.0, firebase-appcheck
17.1.1, firebase-common 20.4.2):

- **App Check, when it fetches a token** (a token lasts about an hour): the Play Integrity
  provider asks Google Play services for an integrity verdict on the app and the phone, which
  Google computes from signals on the device; App Check exchanges the verdict for a token. Those
  requests carry `X-Android-Package` and `X-Android-Cert` (the app's package and signing
  certificate hash), the API key and, when any are stored, the heartbeats in `X-Firebase-Client`.
  The upload function only logs whether the token is valid: Play Integrity can't vouch for an
  APK installed from GitHub Releases, so requiring it would refuse every install today.
- **Heartbeats** (`X-Firebase-Client`, about once a day): firebase-common's user agent:
  `Build.BRAND` (`device-brand`), `Build.DEVICE` (`device-model`, a device code), `Build.PRODUCT`
  (`device-name`, a product code, not the name the user gave the phone), the API level
  (`fire-android`), the store that installed the app (`android-installer`), the form factor
  (`android-platform`: empty on a phone; `tv`, `watch`, `auto` or `embedded` otherwise), the app's target and min SDK, and the
  Kotlin and SDK versions.
- **The upload function, on every request:** the batch, the ID token, the App Check token when
  there is one, and `User-Agent: tem-sinal`, so no device model goes with it.
- **Auth, on every request:** `Accept-Language`, built from `Locale.getDefault()` (the phone's
  language and country); `X-Android-Package` and `X-Android-Cert` (the app's package and signing
  certificate hash); `X-Client-Version`; `X-Firebase-GMPID`; and the heartbeats when there are
  any.
- **Uploads and Auth's token refreshes** carry the account's sign-in token.

The app ships only Firebase Auth and App Check: no Analytics and no Installations id.
The "What is shared?" dialog says this in `sharing_firebase`.

**The server must never publish** a raw sample or any field of one: no coordinates, no
`installId`, `sessionId` or sample `id`, no exact time (`timeMs`, `elapsedRealtimeMs`,
`timestampMs`; the public files carry the month only), no cell identity. The install id is used
to throttle uploads and is listed in the private cells; it stays on the private side. Public files
hold only the aggregates the card lists.

**Retention.** The server keeps a raw sample 90 days after it received it (card `20261113bmjv`).
The upload function stores each sample with `expireAt`, a server-side timestamp 90 days after
receipt; the phone never sends it, and a sample uploaded again keeps its first `expireAt`. A
Firestore TTL policy on `signal_logs.expireAt` (`firestore.indexes.json`) deletes the sample after
that. TTL deletion lags: a sample is typically deleted within about a day after `expireAt`, and
until then it still shows in queries. `expireAt` minus 90 days is the receive time, so the
aggregation reads new samples by `expireAt` (it keeps an ascending index for that) and counts each
one within hours of the end of its session, long before it expires. The aggregates are kept with
no expiry; they are the public map.

**Deletion.** `POST /v1/sessions/delete` with `{"installId": ..., "sessionId": ...}` deletes one
session: its raw samples (those with both ids) and its private cells, which are kept per session
(`session_cells`, keyed by the SHA-256 of the two ids) so they can go whole at any age, also after
the raw samples expired. The next daily run publishes the map without it, deleting a public cell
and emptying a tile it alone backed. A tombstone (`deleted_sessions`, the same hash, kept for
good) stops the upload function storing, and the hourly job aggregating, any later sample of it.
Only a phone holding the install id can delete; a wrong one deletes nothing.

**Listing.** `POST /v1/sessions/list` with `{"installId": ...}` answers
`{"sessions": [{"sessionId": ..., "startMs": ..., "samples": ...}]}`: each session among the raw
samples with that install id (at most 200), its earliest `timeMs` and its raw sample count, and no
coordinates. A session whose raw samples have all expired isn't listed. Like deletion, it needs a
Firebase Auth ID token, and a wrong install id lists nothing.

## Public cells

A public cell is `{"h3": "8b…", "carriers": {"72406": {...}}, "lastSeen": "2026-01"}`, keyed by
the SIM's PLMN, and published in the next daily run whatever its install count. A cell changes the
day after its samples arrive, so comparing the map day to day shows roughly the day of a visit.
Per carrier:

| Field | Meaning |
|---|---|
| `best` | the strongest headline strength in dBm (RSRP for LTE and NR, RSCP for WCDMA, RSSI for GSM) of the `IN_SERVICE` readings registered to a cell; null when none had one |
| `median` | the lower median of the same strengths; null when `best` is |
| `tech` | the network type of those readings registered most often, a tie going to the newer one; null when no `IN_SERVICE` reading was registered |
| `serviceN` | the `IN_SERVICE` readings, whether their cells are known or not |
| `emergencyN` | the `EMERGENCY_ONLY` readings, whether their cells are known or not |
| `noServiceN` | the `OUT_OF_SERVICE` readings, whether their cells are known or not |

Each count is a number of 5 s ticks (see **Rules that hold for every field**), so the counts
compare time spent in each state. The three counts don't overlap: each counted reading is in
exactly one of them, and their sum is the number of readings counted for the carrier in the cell.
A carrier missing from `carriers` has no data in that cell.

The map labels each carrier in a cell from the counts, with `total` their sum: signal when
`serviceN` is at least 90% of `total`; else emergency calls only when `serviceN + emergencyN` is at
least 90% of `total` (a phone in service can also make emergency calls); else no signal. So 199 /
0 / 1 (`serviceN` / `emergencyN` / `noServiceN`) is signal, 120 / 80 / 0 emergency calls only, and
85 / 0 / 15 no signal. The map page works the label out, so the 90% can be tuned without changing
these files (see `docs/decisions.md`).

## Example

A made-up sample (an invented place, not a real reading) from a dual-SIM phone: SIM 1 on Vivo in
5G NSA with no NR cell info, SIM 2 out of service. Nulls are left out, as Gson writes it.

```json
{
  "schemaVersion": 2,
  "id": "6f1c0a52-3b7e-4c1d-9a8e-2d5b7c9e4f10",
  "installId": "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
  "sessionId": "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
  "timeMs": 1767261600000,
  "elapsedRealtimeMs": 86400000,
  "fix": {
    "lat": -15.5, "lon": -47.5, "accuracyM": 4.5, "altitudeM": 1100.0,
    "verticalAccuracyM": 6.0, "timeMs": 1767261599000, "elapsedRealtimeMs": 86399000, "mock": false
  },
  "sims": [
    {
      "slot": 0, "simPlmn": "72406", "registeredPlmn": "72406", "operatorName": "VIVO",
      "serviceState": "IN_SERVICE", "overrideNetworkType": "NR_NSA",
      "cells": [
        {"source": "CELL_INFO", "rat": "LTE", "registered": true, "connection": "PRIMARY_SERVING",
         "timestampMs": 86399500, "arfcn": 1650, "pci": 101, "plmn": "72406", "ci": 12345678,
         "tac": 4321, "rsrp": -98, "rsrq": -11, "sinr": 7, "rssi": -67},
        {"source": "CELL_INFO", "rat": "LTE", "registered": false, "connection": "NONE",
         "timestampMs": 86399500, "arfcn": 1650, "pci": 205, "rsrp": -109, "rsrq": -15},
        {"source": "SIGNAL_STRENGTH", "rat": "NR", "registered": false,
         "connection": "SECONDARY_SERVING", "rsrp": -102, "rsrq": -12, "sinr": 4}
      ]
    },
    {"slot": 1, "simPlmn": "72402", "serviceState": "OUT_OF_SERVICE", "cells": []}
  ]
}
```

## Sources

Android reference, developer.android.com:

- [CellInfo](https://developer.android.com/reference/android/telephony/CellInfo): `UNAVAILABLE`
  "indicates that the integer field is unreported" (29); `isRegistered()` (17);
  `getCellConnectionStatus()` (28); `getTimestampMillis()` (30), "in the elapsedRealtime() time
  base"; `getCellIdentity()`, `getCellSignalStrength()` (30).
- [CellIdentityLte](https://developer.android.com/reference/android/telephony/CellIdentityLte),
  [CellIdentityNr](https://developer.android.com/reference/android/telephony/CellIdentityNr),
  [CellIdentityGsm](https://developer.android.com/reference/android/telephony/CellIdentityGsm),
  [CellIdentityWcdma](https://developer.android.com/reference/android/telephony/CellIdentityWcdma):
  ranges and levels in the CellReading table; `getNci()` returns "The 36-bit NR Cell Identity in
  range [0, 68719476735] or UNAVAILABLE_LONG if unknown".
- [CellSignalStrengthLte](https://developer.android.com/reference/android/telephony/CellSignalStrengthLte):
  `getRsrp()` "Range: -140 dBm to -43 dBm", `getRssnr()` "Range: -20 dB to +30 dB" (26),
  `getRssi()` "[-113, -51]" (29).
- [CellSignalStrengthNr](https://developer.android.com/reference/android/telephony/CellSignalStrengthNr):
  `getSsRsrp()` "-156 dBm to -31 dBm", `getSsRsrq()` "-43 dB to 20 dB", `getSsSinr()` "-23 dB to
  40 dB" (29).
- [CellSignalStrengthGsm](https://developer.android.com/reference/android/telephony/CellSignalStrengthGsm):
  `getRssi()` "the RSSI in dBm (-113, -51) or UNAVAILABLE" (30).
- [CellSignalStrengthWcdma](https://developer.android.com/reference/android/telephony/CellSignalStrengthWcdma):
  `getDbm()` "Get the RSCP as dBm value -120..-24dBm" (18); `getEcNo()` "[-24, 1]" (30).
- [TelephonyManager](https://developer.android.com/reference/android/telephony/TelephonyManager):
  `requestCellInfoUpdate()` (29) "Requests all available cell information from the current
  subscription", requires `ACCESS_FINE_LOCATION`; `getAllCellInfo()` (17) "from all radios on the
  device"; `getServiceState()` (26) requires `READ_PHONE_STATE` "and ACCESS_COARSE_LOCATION";
  `getSignalStrength()` (28); `getSimOperator()` (1) "5 or 6 decimal digits";
  `createForSubscriptionId()` (24).
- [ServiceState](https://developer.android.com/reference/android/telephony/ServiceState):
  `STATE_*` constants (1); `getOperatorNumeric()`, `getOperatorAlphaLong()` "return null if the
  caller does not hold neither ACCESS_FINE_LOCATION nor ACCESS_COARSE_LOCATION";
  `getNetworkRegistrationInfoList()` (30).
- [NetworkRegistrationInfo](https://developer.android.com/reference/android/telephony/NetworkRegistrationInfo):
  class (30); `getAvailableServices()`, `SERVICE_TYPE_EMERGENCY` (30); `isRegistered()` (30,
  deprecated in 34); `isNetworkRegistered()` (34).
- [TelephonyCallback.ServiceStateListener](https://developer.android.com/reference/android/telephony/TelephonyCallback.ServiceStateListener)
  (31); [TelephonyCallback.DisplayInfoListener](https://developer.android.com/reference/android/telephony/TelephonyCallback.DisplayInfoListener)
  (31); [PhoneStateListener](https://developer.android.com/reference/android/telephony/PhoneStateListener):
  `LISTEN_DISPLAY_INFO_CHANGED` (30, deprecated in 31) needs `READ_PHONE_STATE` "for apps compiled
  on the Android 11 SDK".
- [TelephonyDisplayInfo](https://developer.android.com/reference/android/telephony/TelephonyDisplayInfo):
  `getOverrideNetworkType()` (30), "for market branding or visualization purposes only";
  `OVERRIDE_NETWORK_TYPE_NR_NSA` (30); `NR_ADVANCED` (31); `NR_NSA_MMWAVE` deprecated in 31.
- [SubscriptionManager](https://developer.android.com/reference/android/telephony/SubscriptionManager):
  `getActiveSubscriptionInfoList()` (22), requires `READ_PHONE_STATE`;
  [SubscriptionInfo](https://developer.android.com/reference/android/telephony/SubscriptionInfo):
  `getSimSlotIndex()` (22), "maybe INVALID_SIM_SLOT_INDEX if unknown".
- [Location](https://developer.android.com/reference/android/location/Location): `getAccuracy()`
  "at the 68th percentile confidence level"; `getAltitude()` "above the WGS84 reference
  ellipsoid"; `getVerticalAccuracyMeters()` (26); `getMslAltitudeMeters()` (34); `getTime()` "this
  time should not be used to order or compare locations"; `isMock()` (31), `isFromMockProvider()`
  (18, deprecated in 31).
- [Best practices for unique identifiers](https://developer.android.com/identity/user-data-ids):
  "Use a Firebase installation ID (FID) or a privately stored GUID whenever possible".
- [Settings.Secure.ANDROID_ID](https://developer.android.com/reference/android/provider/Settings.Secure#ANDROID_ID):
  "unique to each combination of app-signing key, user, and device ... may change if a factory
  reset is performed on the device or if an APK signing key changes".
- [Context.getNoBackupFilesDir()](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir())
  and [Auto Backup](https://developer.android.com/identity/data/autobackup).

AOSP: the emergency-only mapping follows `CellularNetworkService.getAvailableServices()` in
`frameworks/opt/telephony`, which returns only `SERVICE_TYPE_EMERGENCY` when the modem reports
emergency-only.

AOSP: `CellSignalStrengthWcdma.getDbm()` in `frameworks/base/telephony/java/android/telephony/CellSignalStrengthWcdma.java`
(android11-release onwards) is `if (mRscp != CellInfo.UNAVAILABLE) return mRscp; return mRssi;`.

AOSP, for **5G NSA**, in `frameworks/base`:

- `telephony/java/android/telephony/TelephonyDisplayInfo.java` (`main`):
  `OVERRIDE_NETWORK_TYPE_NONE` 0, `LTE_CA` 1, `LTE_ADVANCED_PRO` 2, `NR_NSA` 3, `NR_NSA_MMWAVE` 4
  (`@Deprecated`, "Use OVERRIDE_NETWORK_TYPE_NR_ADVANCED instead"), `NR_ADVANCED` 5.
- `core/java/android/telephony/PhoneStateListener.java` (`android11-release`):
  `LISTEN_DISPLAY_INFO_CHANGED` "Requires Permission: READ_PHONE_STATE", and
  `onDisplayInfoChanged` is `@RequiresPermission(READ_PHONE_STATE)`.
- `telephony/java/android/telephony/SignalStrength.java` (`main`):
  `getCellSignalStrengths(Class)` returns at most one `CellSignalStrengthNr`, and only when it
  `isValid()`.
- `telephony/java/android/telephony/CellSignalStrengthNr.java` (`main`): `isValid()` is
  `!equals(sInvalid)`, so an NR strength with only CSI values is valid, which is why the NR leg
  needs an SS value; the constructor keeps SS-RSRP in -156..-31, SS-RSRQ in -43..20 and SS-SINR in
  -23..40, and makes anything else `UNAVAILABLE`.
