# Room mailbox provisioning runbook

**Operationally load-bearing.** Run this for every room mailbox added to the
Room Booking Platform — new rooms and renamed rooms alike. Skipping any step
leaves a security or correctness gap. The whole process takes ~10 minutes once
you're set up.

## What this runbook covers

1. One-time: creating the `room-mailboxes` security group and Application Access Policy.
2. Per-room: adding the mailbox to the group and locking it down.
3. Verification: confirming the lockdown and app access actually work.

The Application Access Policy is the blast-radius boundary that restricts our
app's `Calendars.ReadWrite` permission to room mailboxes only. The
`Set-CalendarProcessing` lockdown is the boundary that ensures our portal is
the only booking path. **Both must be in place before the first room goes live.**

---

## Prerequisites

- Exchange Online PowerShell session under an account with **Exchange Administrator** role.
- The room mailbox already exists in Exchange Online.
- The Entra ID app registration ("College Room Booking") is already created with
  `Calendars.ReadWrite` application permission, admin-consented.
- App Client ID is known (Azure portal → Entra ID → App registrations → your app → Overview).

## Connecting

```powershell
# Install the module once (run as CurrentUser to avoid needing admin on your PC)
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force

# Connect — use an account with Exchange Administrator role
Connect-ExchangeOnline -UserPrincipalName admin@college.ac.uk
```

---

## Step A — One-time setup (do this once, before any rooms are provisioned)

### A1. Create the `room-mailboxes` mail-enabled security group

```powershell
New-DistributionGroup `
  -Name "Room Mailboxes" `
  -Alias "room-mailboxes" `
  -PrimarySmtpAddress "room-mailboxes@college.ac.uk" `
  -Type Security `
  -MemberJoinRestriction Closed `
  -MemberDepartRestriction Closed
```

### A2. Create the Application Access Policy

This restricts our app's `Calendars.ReadWrite` to mailboxes in the group above.
**Without this, the app has read/write access to every mailbox in the tenant.**

```powershell
New-ApplicationAccessPolicy `
  -AppId "<AZURE_CLIENT_ID>" `
  -PolicyScopeGroupId "room-mailboxes@college.ac.uk" `
  -AccessRight RestrictAccess `
  -Description "Room booking platform — room mailboxes only"
```

> **Propagation delay:** this policy can take **up to 60 minutes** to take effect.
> Do the per-room steps while waiting; run the verification checks after the hour.

### A3. Verify the policy scope (after propagation)

Call the smoke test script against a mailbox that is **not** in the group.
It must return HTTP 403:

```powershell
# Should FAIL with "Graph HTTP 403"
pnpm smoke not-a-room@college.ac.uk
```

Call it against a room that **is** in the group. It must succeed:

```powershell
# Should SUCCEED (or print "(no events)")
pnpm smoke b12@college.ac.uk
```

If the out-of-scope call succeeds, the policy hasn't propagated yet. Wait and retry.

---

## Step B — Per-room provisioning

Replace `<room-upn>` throughout with the room's UPN (e.g. `b12@college.ac.uk`).

### B1. Add to the security group

```powershell
$RoomUpn = "<room-upn>"

Add-DistributionGroupMember `
  -Identity "room-mailboxes@college.ac.uk" `
  -Member $RoomUpn
```

### B2. Lock down the mailbox

This configuration ensures that **no user can book the room from Outlook or Teams**.
Only our app, writing under application credentials via Graph, can add events to
the room's calendar. The resource-booking attendant (`AutoAccept`) still auto-accepts
events that our app creates.

```powershell
Set-CalendarProcessing -Identity $RoomUpn `
  -AutomateProcessing AutoAccept `
  -AllBookInPolicy $false `
  -BookInPolicy @() `
  -AllRequestInPolicy $false `
  -AllRequestOutOfPolicy $false `
  -AddOrganizerToSubject $false `
  -DeleteSubject $false `
  -DeleteComments $false `
  -RemovePrivateProperty $false `
  -ProcessExternalMeetingMessages $false
```

### B3. Read back to confirm

```powershell
Get-CalendarProcessing -Identity $RoomUpn | `
  Format-List Identity, AutomateProcessing, AllBookInPolicy, BookInPolicy, AllRequestInPolicy
```

Expected output:

```
Identity              : <name from Exchange>
AutomateProcessing    : AutoAccept
AllBookInPolicy       : False
BookInPolicy          : {}
AllRequestInPolicy    : False
```

If `AllBookInPolicy` is `True` or `BookInPolicy` is non-empty, the lockdown
did not apply. Re-run Step B2.

---

## Step C — Verification (all three checks required)

Mark the room as provisioned only after all three pass.

### C1. A normal user cannot book the room from Outlook

1. As a non-admin user, open Outlook.
2. Create a new meeting. Invite `<room-upn>` as a location/resource.
3. Send the invite.
4. **Expected:** within ~1 minute, an auto-decline email arrives from the room.
   The meeting is NOT added to the room's calendar.

If the room accepts the invite, the lockdown didn't apply — investigate before proceeding.

### C2. Our app can read the room calendar

```powershell
# List events for the next 7 days — should print events or "(no events)"
pnpm smoke <room-upn>
```

If this returns "Graph HTTP 403 — ErrorAccessDenied":
- Confirm the room is in the `room-mailboxes` group:
  ```powershell
  Get-DistributionGroupMember -Identity "room-mailboxes@college.ac.uk" | Select-Object PrimarySmtpAddress
  ```
- Application Access Policy changes take up to 60 minutes. Wait and retry.
- Confirm the app registration Client ID in `AZURE_CLIENT_ID` matches the policy.

### C3. Config/rooms.yaml has the room defined

```bash
# Room should appear in the list
grep -A5 "id: \"$(echo '<room-id>')" config/rooms.yaml
```

If it's missing, add it and raise a PR.

---

## After provisioning

1. **rooms.yaml PR** — add (or confirm) the room in `config/rooms.yaml` with
   the correct `mailboxUpn`, `allowedGroups`, `capacity`, and `equipment`.
2. **Import** — after the PR merges and deploys, run `pnpm rooms:import` so the
   database is up to date with the YAML.
3. **Graph subscription** — run `pnpm subscriptions:ensure` so change notifications
   are active for this mailbox (added in Phase 4).
4. **iPad pairing** — if this room gets a display, pair the device via the admin UI
   (added in Phase 6).

---

## Drift detection

An Exchange admin who doesn't know about this runbook could accidentally re-enable
direct booking on a locked room. The Phase 7 script `scripts/verify-lockdown.ts`
iterates every room in `rooms.yaml`, reads its `CalendarProcessing` settings, and
reports any with `AllBookInPolicy = True` or a non-empty `BookInPolicy`.

**Run this monthly, or after any change to Exchange admin roles.**

---

## Rotating the Application Access Policy

If the app registration changes (e.g. tenant migration, major security rotation):

```powershell
# Find the current policy ID
Get-ApplicationAccessPolicy | Where-Object { $_.AppId -eq "<old-client-id>" }

# Remove the old policy
Remove-ApplicationAccessPolicy -Identity "<policy-id>"

# Create the replacement
New-ApplicationAccessPolicy `
  -AppId "<new-client-id>" `
  -PolicyScopeGroupId "room-mailboxes@college.ac.uk" `
  -AccessRight RestrictAccess `
  -Description "Room booking platform — room mailboxes only (rotated <date>)"
```

Allow up to 60 minutes for propagation. Run the smoke test against an in-scope
and out-of-scope mailbox before decommissioning the old app registration.
