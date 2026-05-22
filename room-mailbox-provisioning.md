# Room mailbox provisioning runbook

Operationally load-bearing. Run this for every room mailbox added to
the Room Booking Platform. Skipping any step leaves a security or
correctness gap. The whole process takes about 5 minutes per room
once you're set up.

## What this runbook does

1. Adds the room mailbox to the `room-mailboxes` security group.
2. Verifies the Application Access Policy is in effect.
3. Locks down the mailbox so only our app can write to its calendar.
4. Configures the mailbox's calendar processing for clean event
   handling.
5. Verifies the lockdown actually works.

## Prerequisites

- An Exchange Online PowerShell session as an admin with at least
  the `Exchange Administrator` role.
- The room mailbox already exists in Exchange.
- The `room-mailboxes` mail-enabled security group already exists
  (created during phase 1).
- The Application Access Policy already exists (created during
  phase 1).
- The room is already in `config/rooms.yaml` (or will be added in
  the same PR as this provisioning).

## Connecting

```powershell
# Install the module once
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser

# Connect
Connect-ExchangeOnline -UserPrincipalName admin@college.ac.uk
```

## The script

Replace `<room-upn>` with the room mailbox's UPN (e.g.
`b12@college.ac.uk`).

```powershell
$RoomUpn = "<room-upn>"

# 1. Add to the security group
Add-DistributionGroupMember `
  -Identity "room-mailboxes@college.ac.uk" `
  -Member $RoomUpn

# 2. Lockdown — no user can directly book this room
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

# 3. Read back to confirm
Get-CalendarProcessing -Identity $RoomUpn | `
  Format-List Identity, AutomateProcessing, AllBookInPolicy, BookInPolicy, AllRequestInPolicy
```

Expected output for step 3:

```
Identity                : <name from Exchange>
AutomateProcessing      : AutoAccept
AllBookInPolicy         : False
BookInPolicy            : {}
AllRequestInPolicy      : False
```

If `AllBookInPolicy` is `True` or `BookInPolicy` is non-empty, the
mailbox is bookable from Outlook by some users — that's a hole in
our security model. Re-run the script.

## Verification

You must run all three of these checks before marking the room as
provisioned.

### Verify 1: A normal user cannot book the room from Outlook

1. As a non-admin user (e.g. yourself), open Outlook.
2. Create a new meeting, invite the room mailbox as a resource.
3. Send the invite.
4. Expected: within a minute, an auto-decline email from the room
   mailbox arrives saying it can't be booked.

If the room *accepts* the invite, the lockdown didn't apply.
Investigate before proceeding.

### Verify 2: Our app can write to the room

```powershell
# Replace with the real path to your repo
cd path/to/repo
pnpm tsx scripts/graph-smoke.ts --create-test-event "<room-upn>"
```

This script (committed in phase 1) authenticates with our app
credentials, creates a 30-minute test event 1 hour from now, prints
its event id, then deletes it. If this succeeds, app-permission
writes work.

If this fails with `ErrorAccessDenied`:
- Check the Application Access Policy includes the
  `room-mailboxes` group.
- Check the room is actually in the group
  (`Get-DistributionGroupMember -Identity room-mailboxes@college.ac.uk`).
- Policy changes can take up to 1 hour to propagate.

### Verify 3: Our app can read the room

```powershell
pnpm tsx scripts/graph-smoke.ts "<room-upn>"
```

Should list events from the room for the next 7 days. (If the
calendar is empty, "(no events)" is the expected output.)

## After provisioning

1. Add the room (or section) to `config/rooms.yaml` with the
   correct `allowedGroups`, in a PR.
2. After the PR merges and deploys, run `pnpm rooms:import` so
   the database is up to date.
3. Run `pnpm subscriptions:ensure` so a Graph subscription exists
   for this mailbox.
4. (For physical rooms about to get an iPad: pair the device via
   the admin UI.)

## Drift detection

The mailbox lockdown can be undone by an admin who didn't read this
runbook. The phase 7 `mailbox-lockdown-verification.md` runbook
documents a script (`scripts/verify-lockdown.ts`) that iterates
every room in `rooms.yaml`, reads its `CalendarProcessing`
settings, and reports any mailbox with `AllBookInPolicy = True` or
a non-empty `BookInPolicy`. Run this monthly, or after any change
to Exchange admin roles.

## Rotating the Application Access Policy

If we ever need to change which app has access to room mailboxes
(e.g. moving to a new app registration during a major rotation):

```powershell
# Remove the old policy
Remove-ApplicationAccessPolicy -Identity "<policy-id-of-old-app>"

# Create the new one
New-ApplicationAccessPolicy `
  -AppId "<new-app-id>" `
  -PolicyScopeGroupId "room-mailboxes@college.ac.uk" `
  -AccessRight RestrictAccess `
  -Description "Room booking platform — rooms only (rotated <date>)"
```

Allow up to 1 hour for propagation; verify with the smoke test
before deleting the old app registration.