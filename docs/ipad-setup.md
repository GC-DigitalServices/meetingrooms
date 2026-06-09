# iPad display setup guide

One display represents one room (or, for a composite-room main-entrance iPad, the whole
composite with its section chooser). This guide covers a single display. Repeat from
**Step 2** for every additional unit.

**Time per unit:** ~20 minutes once MDM and power are in place.

---

## Prerequisites

- Admin access to the Room Booking Portal (`meetingrooms.greenhead.digital/admin`).
- MDM solution (Jamf, Intune, or similar) enrolled and able to push profiles to the iPad.
- The room is already provisioned in Exchange and in `config/rooms.yaml`
  (see `docs/runbooks/room-mailbox-provisioning.md`).

---

## Step 1 — Site check (before mounting)

Do this before drilling anything.

| Check | Pass condition |
|---|---|
| Staff Wi-Fi signal at mount position | Phone in aeroplane mode → toggle Wi-Fi on → connects to staff SSID without moving away from the mount location |
| Phone can reach the portal | With phone on staff Wi-Fi, open `meetingrooms.greenhead.digital` and sign in |
| Power available | PoE injector or mains socket within cable run; cable run is tidy and won't be a trip hazard |
| Mount height | Centre of screen at 145–155 cm from floor (eye-level standing); clear sightline from both directions of approach |

If Wi-Fi signal fails: raise a networking ticket to add an AP before proceeding. Do not deploy the iPad without confirmed phone signal — the QR code is useless if the phone can't reach the portal after scanning.

---

## Step 2 — Hardware

1. Fit the iPad into its case.
2. Mount the case on the wall bracket and secure the cable run.
3. Connect power. Confirm the iPad boots and stays on.

**Recommended spec** (any of these works):
- iPad (9th gen or later), iPad Air (4th gen or later), or iPad mini (6th gen or later).
- Recommended: Heckler Design or Vogel's wall mount with integrated charging.

---

## Step 3 — MDM configuration

Push a profile to this iPad with the following settings. The exact path varies by MDM;
the setting names below are the iOS restriction keys.

| Setting | Value | Reason |
|---|---|---|
| Auto-Lock | Never | Prevents the screen blanking between bookings |
| Guided Access / Single App Mode | Locked to Safari (see note) | Prevents accidental navigation away from the display |
| Volume controls | Disabled | Display has no audio purpose |
| Allow Camera | Yes | Required for the admin to scan the enrolment QR code during setup; can be removed after pairing if preferred |
| Allowed URLs (if using Supervised + Content Restrictions) | `meetingrooms.greenhead.digital` | Prevents accidental use as a general browser |

> **Single-app mode note.** If using Jamf's Single App Mode, lock to Safari with the
> start URL `https://meetingrooms.greenhead.digital/display`. If using Apple Configurator
> or ABM Automated Device Enrollment, Guided Access can also achieve this. The display
> is a web app — there is no native app to lock to.

After pushing the profile, confirm on the device that:
- The screen does not auto-lock after 2 minutes of no interaction.
- The volume buttons have no effect.

---

## Step 4 — Pair the display

Pairing links this iPad to a specific room and scope.

### On a desktop/laptop (admin portal)

1. Go to `meetingrooms.greenhead.digital/admin/devices` and sign in as an admin.
2. Click **Pair display**.
3. Select the room from the dropdown.
4. Choose the scope:
   - **Standard room** — iPad is outside a normal meeting room.
   - **One section** — iPad is outside one section's door in a composite room.
   - **Whole composite room (main entrance)** — iPad is outside the composite room's main entrance; shows all sections and lets users book any section or the whole room.
5. Optionally enter a device name (e.g. "iPad outside Main Hall entrance") — shown in admin monitoring.
6. Click **Generate pairing code**. A 6-digit code and enrolment URL appear. **The code expires in 10 minutes.**

### On the iPad

1. Open Safari.
2. Navigate to the enrolment URL shown in the portal dialog:
   ```
   https://meetingrooms.greenhead.digital/display/enroll?code=XXXXXX
   ```
   Alternatively, type the 6-digit code into a dedicated enrolment page if one has been set up.
3. The page shows "Pairing display…" then "Paired successfully" and auto-redirects to `/display`.

If the code expires before you reach the iPad, generate a new one from the portal — the old device record is replaced automatically.

### Add to home screen (recommended)

This installs the PWA so the display runs full-screen without browser chrome:

1. In Safari on the iPad, tap the Share button → **Add to Home Screen** → **Add**.
2. The icon appears on the home screen. Tap it — the display opens full-screen.
3. If using Single App Mode, update the locked URL to the home-screen PWA rather than Safari after this step.

---

## Step 5 — Affix the mount label

Cut and affix the printed label to the underside of the mount (or a nearby wall plate).
The label must be visible to someone standing in front of the display.

Label text:
```
Can't scan? Book this room at:
meetingrooms.greenhead.digital/r/<ROOM-ID>
```

Replace `<ROOM-ID>` with the room's short ID from `config/rooms.yaml`. This URL lets
staff without smartphones (or with cameras that don't auto-detect QR codes) type the
address directly on a phone, tablet, or PC.

---

## Step 6 — Verify

Run all three checks before considering the unit live.

### 6a. Display shows correct room and status

On the iPad, confirm:
- Room name is correct.
- Status (Available / In use / Starting soon) matches the room's current calendar state.
- The live clock is ticking.

If the room name is wrong: the device was paired to the wrong room — revoke (see below)
and re-pair.

### 6b. Live updates work

1. Make a test booking for this room via the portal (start time = now, duration 5 minutes).
2. Within 5 seconds, the display should flip to **In use** and show the booking subject.
3. Cancel the booking via the portal. Within 5 seconds, the display should return to **Available**.

If updates are not appearing: check the socket connection — the small "Offline" badge
should not be visible. If it is, check the iPad's Wi-Fi connection.

### 6c. QR scan works end-to-end

1. On a phone on staff Wi-Fi, open the camera and point it at the QR code.
2. The phone prompts to open the URL in Microsoft Edge — tap it.
3. Sign in if prompted (MSAL; should be automatic if already signed in on the device).
4. The booking dialog opens with this room pre-selected and a sensible start time.
5. Make a test booking. Confirm it appears on the display within 5 seconds.
6. Cancel the booking from the portal.

If the QR code doesn't trigger a scan on the first try: test from arm's length (~60 cm)
in normal corridor lighting. The QR is regenerated every 90 seconds — wait for a fresh
code if the current one is near expiry.

---

## Revoking a display

If an iPad is lost, stolen, or decommissioned:

1. Go to `meetingrooms.greenhead.digital/admin/devices`.
2. Find the device by name or room.
3. Click **Revoke**. The token is immediately invalidated — the display goes offline.

The device can no longer make any API requests. If the iPad is later recovered, pair it
again from Step 4.

---

## Troubleshooting quick reference

| Symptom | Most likely cause | Fix |
|---|---|---|
| Display shows "Display not paired" | No device token in localStorage | Re-pair from Step 4 |
| Display shows "Display error — device token revoked" | Token was revoked from admin portal | Re-pair from Step 4 |
| Display shows "Reconnecting…" or "Offline" badge | iPad lost Wi-Fi | Check Wi-Fi; the display auto-recovers when reconnected |
| QR code replaced with "Refreshing — please book from your desk" | QR token fetch failed for >4 minutes | Check Wi-Fi; recovers automatically |
| Room name is correct but status is stuck | Socket reconnected but no snapshot received | Refresh the page once; if persistent, check server health at `/api/health` |
| Status updates appear after >30 seconds | Network congestion or server load | Acceptable if occasional; escalate if consistent |
| QR scan opens portal but shows wrong room | Device paired to wrong room | Revoke and re-pair with correct room |
