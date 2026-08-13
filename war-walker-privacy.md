---
layout: page
title: WarWalker Privacy Policy
permalink: /war-walker/privacy/
---

# Privacy Policy

**WarWalker** (`com.warwalking.app`)

Last updated: 12 August 2026

## The short version

WarWalker is a wardriving fitness app: it scans nearby Wi-Fi and Bluetooth
networks while you walk, checks your step count against Health Connect, and
uploads the scan to **WiGLE**, a separate crowdsourced wireless-network
mapping service, under **your own WiGLE account**. There is no WarWalker
account, no analytics, no advertising, and no WarWalker server sitting
between you and WiGLE.

Because uploading to WiGLE is the entire point of the app, read the "What
gets uploaded to WiGLE" section below carefully — that data becomes part of
WiGLE's public database, not just something shared privately with us.

## What the app stores on your device

Written to the app's private storage. Other apps cannot read it.

- Your WiGLE API Name and Token, encrypted at rest with Android's
  `EncryptedSharedPreferences` (`WigleCredentialStore.kt`). This is the same
  credential pair you'd use on wigle.net directly — WarWalker never sees or
  stores your WiGLE account password.
- A local history of your walks: start/end time, step count, number of
  access points discovered, an optional title, and a coarse GPS breadcrumb
  of the route (sampled periodically, not the precise per-network
  coordinates — see below).
- Whether a given walk's WiGLE upload succeeded.
- Derived stats computed from the above: your current streak and the
  "Last 7 Days" chart on the Profile tab.

None of this is uploaded anywhere by WarWalker itself. It stays on your
phone until you delete a walk, clear app data, or uninstall the app.

## What gets uploaded to WiGLE

When you stop a walk, WarWalker builds a standard `WigleWifi-1.4` CSV file —
each row is one detected Wi-Fi or Bluetooth network, its signal strength,
and the GPS coordinates where it was seen — and uploads it directly from
your phone to `https://api.wigle.net/api/v2/file/upload`, using the WiGLE
API credentials you entered in Settings.

**This data becomes part of WiGLE's public wireless-network database.**
That's WiGLE's whole purpose — it's a global, crowdsourced map of wireless
networks, and it's how your contributions count toward your WiGLE rank,
which WarWalker reads back and shows on your Profile tab
(`GET /api/v2/stats/user`). WarWalker doesn't control what WiGLE does with
uploaded data, how long WiGLE retains it, or who can query it — that's
governed by WiGLE's own privacy policy and terms, not this one:
<https://wigle.net/tos>.

The per-network GPS coordinates in that CSV are more precise than the
coarse route breadcrumb WarWalker keeps locally (above) — they only ever
exist in the transient upload file, not in WarWalker's own database.

If a WiGLE upload fails or you never tap Verify & Save in Settings, no scan
data leaves your device — WarWalker has no fallback server of its own.

## Permissions

- **Location (fine/coarse, foreground only)** — required to geotag scanned
  networks and to draw the local route breadcrumb. WarWalker does not
  request background location access; scanning only happens while a walk
  is actively running, shown by a persistent notification.
- **Nearby devices (Bluetooth scan/connect)** — used to detect BLE
  beacons during a walk, geotagged the same way as Wi-Fi networks.
- **Wi-Fi state** — used to read nearby access points during a scan.
- **Internet / network state** — used solely to talk to `api.wigle.net`.
- **Notifications** — used to show the ongoing-scan notification required
  while the foreground location service is running.
- **Health Connect (steps, distance, active calories — read-only)** — read
  once when a walk ends, as an anti-cheat check against the step count
  WarWalker already tracked live via the phone's on-device step sensor.
  WarWalker cannot write to Health Connect, and none of this is uploaded
  anywhere; it's only used to compute the step count stored locally for
  that walk (see above).

## Analytics, advertising, and tracking

There are none. WarWalker contains no analytics SDK, no advertising SDK, no
crash reporting service, and reports nothing about you or your device to
anyone except the WiGLE upload described above, which you control.

## The optional self-hosted backend

This repository also contains an unused FastAPI/Postgres backend
(`backend/`) from an earlier design. The published app does not call it for
anything — WarWalker talks to WiGLE directly. It's mentioned here only for
completeness, in case you're reading this alongside the source code.

## Children

WarWalker is not directed at children and collects nothing that identifies
anyone beyond what you choose to upload to your own WiGLE account.

## Deleting your data

Uninstalling WarWalker removes everything stored locally: your credentials,
walk history, and stats. WarWalker has no server of its own, so there's no
WarWalker account to close.

Data already uploaded to WiGLE is separate — it lives in your WiGLE
account, not WarWalker's. To remove it, use WiGLE's own tools or contact
WiGLE directly: <https://wigle.net>.

## Changes

If the app's behavior changes in a way that affects this policy, this
document will be updated alongside that change, and the date above revised.

## Contact

Questions: <https://www.dugcanlift.com>
