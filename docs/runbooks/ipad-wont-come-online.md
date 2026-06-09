# iPad display won't come online

---

## Symptoms

- `/admin/status` → Displays: device shows **Offline** (last seen > 6h) or **Never**
- Admin email: "Display offline: [room name]"
- Room display shows a stale or blank screen
- Booking updates not reflected on the display

---

## Diagnosis table

| What you see | Likely cause |
|---|---|
| White Safari screen / "Cannot connect" | iPad has no network / wrong Wi-Fi SSID |
| `/display/enroll` page with a pairing code field | Device storage cleared or Safari data wiped |
| `/display` loads but shows wrong room or "Unknown room" | Device token corrupted or paired to wrong room |
| Display loads but doesn't update in real time | Socket.IO connection failing (CSP, proxy, or ws:// vs wss://) |
| Display shows correct room but `lastSeenAt` is stale | Heartbeat endpoint failing; check logs |
| Page won't load at all | MDM Single App Mode stuck; or server is down — check `/api/health` |

---

## Resolution

### Step 1 — Check network

On the iPad (exit Guided Access temporarily if needed):

- **Settings → Wi-Fi**: confirm connected to school network with internet access
- Open Safari manually and browse to `https://meetingrooms.greenhead.digital/api/health`
  - Should return `{"ok":true,...}`
  - If it times out: Wi-Fi or DNS issue — fix MDM Wi-Fi profile

### Step 2 — Check server

From any browser:

```
https://meetingrooms.greenhead.digital/api/health
https://meetingrooms.greenhead.digital/admin/status
```

If the server is down, this is not an iPad issue — see `rolling-deploy-and-rollback.md`.

### Step 3 — Force a display reload

If the device is stuck but the server is healthy:

1. Exit Guided Access (MDM PIN or triple-click Home)
2. Safari → tap the URL bar → reload
3. If the URL bar shows a different URL than the display URL, navigate to:
   ```
   https://meetingrooms.greenhead.digital/display
   ```
4. Re-enable Guided Access

### Step 4 — Re-enroll the device

Use this if the display shows the enroll page, or if the token is corrupted.

**On the admin portal:**
1. Go to `/admin/devices`
2. Find the device and click **Revoke** (or DELETE) to remove the old token
3. Click **Pair new device** → select room and scope → get the 6-digit code (valid 10 min)

**On the iPad:**
1. Navigate to:
   ```
   https://meetingrooms.greenhead.digital/display/enroll?code=XXXXXX
   ```
   (Replace XXXXXX with the pairing code, or use the fallback QR)
2. The iPad receives a new device token and stores it in `localStorage`
3. It redirects automatically to the display view

### Step 5 — MDM settings check

If the device re-enrolls but keeps losing state:

| Setting | Required value |
|---|---|
| Auto-Lock | Never |
| Single App Mode | Enabled (Safari, `meetingrooms.greenhead.digital`) |
| Camera access | Allowed (for QR scan) |
| Volume | Muted or disabled |
| Supervised mode | Required for Single App Mode |

Check MDM console (Mosyle, Jamf, Intune, etc.) for the device.

### Step 6 — Clear Safari cache (last resort)

If the device shows a stale version after a deploy:

1. Exit Guided Access
2. Settings → Safari → Clear History and Website Data
3. **Do not** wipe `localStorage` — it contains the device token
4. Reload the display URL

---

## Verification

1. `/admin/status` → device row shows **Online** (within 5 minutes)
2. Make a booking in the portal → booking appears on the display within 5 seconds
3. QR code refreshes on the display every ~4 minutes without manual intervention

---

## Escalation

If the above steps don't resolve it and the server is healthy:

- Check Railway logs for `deviceId: [id]` errors around the last seen time
- Confirm the `device:pair:XXXXXX` Redis key hasn't expired (10-min TTL) before enrollment

---

## Post-incident notes template

```
Date:
Device / Room:
Last seen at (before incident):
Root cause:
Resolution steps taken:
Downtime (approx):
MDM changes required:
```
