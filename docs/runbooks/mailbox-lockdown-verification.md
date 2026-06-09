# Runbook: Room Mailbox Lockdown Verification

## What this checks and why

A critical invariant of MRBS is that **our application is the only writer to room mailboxes**. This is enforced by two Exchange calendar processing settings on every room mailbox:

- `AllBookInPolicy = $false` — disables automatic acceptance of any meeting request
- `BookInPolicy = @()` (empty) — no users are permitted to book directly via Outlook

If either setting drifts (e.g. an Exchange admin resets defaults, a tenant-wide policy change propagates, or a new room mailbox is provisioned without lockdown applied), users can bypass MRBS entirely and book rooms directly from Outlook. Those bookings land in Exchange but never reach our database, so:

- The display shows the room as free when it is occupied
- Our conflict checker does not see the booking
- Audit logs have no record of the booking

Detection relies on comparing Exchange calendar events against Postgres. Any event present in Exchange but absent from our DB (or vice versa) is a discrepancy requiring investigation.

---

## Verification procedure

Run the following PowerShell commands. The script is designed to be run in full as a single session.

```powershell
# 1. Connect to Exchange Online
Connect-ExchangeOnline -UserPrincipalName admin@greenhead.ac.uk

# 2. Check all room mailboxes at once
#    Expected: every row shows AllBookInPolicy = False and BookInPolicy = {}
Get-Mailbox -RecipientTypeDetails RoomMailbox |
    Get-CalendarProcessing |
    Select-Object Identity, AllBookInPolicy, BookInPolicy |
    Format-Table -AutoSize

# 3. To check a single room in detail
Get-CalendarProcessing -Identity "roomalias@greenhead.ac.uk" |
    Select-Object AllBookInPolicy, BookInPolicy

# 4. Identify any rooms that are out of compliance
$drifted = Get-Mailbox -RecipientTypeDetails RoomMailbox |
    Get-CalendarProcessing |
    Where-Object { $_.AllBookInPolicy -eq $true -or $_.BookInPolicy.Count -gt 0 }

if ($drifted) {
    Write-Warning "DRIFT DETECTED on the following mailboxes:"
    $drifted | Select-Object Identity, AllBookInPolicy, BookInPolicy | Format-Table -AutoSize
} else {
    Write-Host "OK: All room mailboxes are correctly locked down." -ForegroundColor Green
}
```

### Expected output (healthy)

| Identity | AllBookInPolicy | BookInPolicy |
|---|---|---|
| room-a@greenhead.ac.uk | False | {} |
| room-b@greenhead.ac.uk | False | {} |
| ... | False | {} |

Any row showing `AllBookInPolicy = True` or a non-empty `BookInPolicy` is a compliance failure requiring immediate remediation.

---

## Remediation

For each drifted mailbox identified above, run:

```powershell
# Re-lock a single mailbox
Set-CalendarProcessing -Identity "room@greenhead.ac.uk" `
    -AllBookInPolicy $false `
    -BookInPolicy @()

# Re-lock all drifted mailboxes in one pass (uses $drifted from the verification step above)
foreach ($mailbox in $drifted) {
    Write-Host "Locking: $($mailbox.Identity)"
    Set-CalendarProcessing -Identity $mailbox.Identity `
        -AllBookInPolicy $false `
        -BookInPolicy @()
}

# Confirm remediation
Get-Mailbox -RecipientTypeDetails RoomMailbox |
    Get-CalendarProcessing |
    Select-Object Identity, AllBookInPolicy, BookInPolicy |
    Format-Table -AutoSize
```

After remediation, re-run the verification step and confirm all rows show `False / {}` before continuing.

---

## When to run

- **After any Exchange admin activity** touching room mailboxes or calendar processing policies
- **After tenant-wide policy changes** (e.g. Conditional Access rollouts, Exchange transport rule updates, M365 admin centre bulk operations)
- **Monthly**, as part of the regular ops routine — schedule for the first Monday of each month
- **Immediately** if the display shows a room as free but it appears occupied, or if a user reports being able to book via Outlook without going through MRBS

---

## Post-check actions if drift was found

1. **Remediate** all drifted mailboxes using the commands above.

2. **Identify the window of exposure.** Check Exchange admin audit logs to determine when the setting changed:
   ```powershell
   Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date) `
       -Operations "Set-CalendarProcessing" |
       Select-Object -ExpandProperty AuditData |
       ConvertFrom-Json |
       Where-Object { $_.Parameters.Name -in @("AllBookInPolicy","BookInPolicy") } |
       Select-Object CreationTime, UserId, Parameters
   ```

3. **Run a manual resync** to catch any bookings that bypassed the system during the exposure window. The resync procedure pulls Exchange calendar events for the affected rooms and reconciles them against Postgres. Refer to the resync runbook (`docs/runbooks/exchange-db-resync.md`) for the full procedure.

4. **Audit discrepancies.** Any Exchange event that has no corresponding Postgres record must be reviewed:
   - If it is a legitimate booking that bypassed MRBS: create the Postgres record manually and broadcast a socket update so displays refresh
   - If it is a spurious or test event: cancel it from Exchange and confirm the cancellation propagates

5. **Document the incident.** Record the date of detection, estimated exposure window, affected mailboxes, and corrective actions taken.

6. **Alert.** Notify the MRBS system owner and, if the exposure window exceeded 24 hours, the affected room administrators.
