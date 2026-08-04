# Runbook: Outbound Email (Mail.Send) Permission

## What this covers

MRBS sends a handful of **notification emails** via Microsoft Graph `sendMail`:

- **Premises / transport notifications** — to `premises_email` (and, for minibus bookings, `minibus_email`) in `config/groups.yaml`
- **Minibus booking confirmations** — to the booker, with the safety-check checklist attached (Admin → Minibus checklist)
- **Visitor car park confirmations** — to the booker
- **System alerts** — to `admin_alert_email`

All of these are sent **as one mailbox**, configured by the `MAIL_SENDER_UPN` environment variable (Railway → Variables). It is currently:

```
MAIL_SENDER_UPN = noreply@greenhead.ac.uk
```

The send uses **application (app-only) Graph credentials** — the same app registration used for room bookings (AppId `655e8d1f-b446-4124-978e-a74e2d57183c`) — calling `POST /users/{MAIL_SENDER_UPN}/sendMail`. This requires the **`Mail.Send` application permission**, which is *separate* from the calendar permissions used to write bookings.

---

## Symptom

- Notification emails do not arrive, but **bookings themselves succeed** (calendar writes use a different permission, so they are unaffected).
- The **Admin → Audit log** shows `Premises email failed` entries with:

  ```
  Error: Graph HTTP 403: {"error":{"code":"ErrorAccessDenied",
  "message":"Access is denied. Check credentials and try again."}}
  ```

Mail failures are best-effort and never roll back a booking, so the only signal is the audit log (and app logs: `mailer: premises_email_failed`).

---

## Root cause

A `403 ErrorAccessDenied` on `sendMail` means the app is **not authorised to send as `MAIL_SENDER_UPN`**. In order of likelihood:

1. **`Mail.Send` application permission is missing or not admin-consented.** Most common — the app was granted calendar permissions for booking but never `Mail.Send`, so email has never worked.
2. **An Exchange Application Access Policy scopes the app away from the sender mailbox.** (This variant usually carries a `[RAOP]` marker in the error text — see `project` memory `exchange-application-access-policy` and the checks below.)
3. **`MAIL_SENDER_UPN` is not a real mailbox** — e.g. it points at a distribution list or an unlicensed alias. You cannot `sendMail` as a distribution list.

---

## Fix

### 1. Grant and consent the `Mail.Send` application permission

1. **Entra ID → App registrations →** the MRBS app (AppId `655e8d1f-b446-4124-978e-a74e2d57183c`) **→ API permissions**.
2. Under **Microsoft Graph → Application permissions**, look for **`Mail.Send`**.
   - If missing: **Add a permission → Microsoft Graph → Application permissions → `Mail.Send` → Add permission**.
3. Click **"Grant admin consent for Greenhead"**. This step is mandatory — an added-but-unconsented permission still returns `403`.
4. Confirm the `Mail.Send` row shows **Status: Granted for Greenhead** (green tick).

No redeploy is needed — the permission is enforced server-side by Graph on the next call.

### 2. Confirm the sender is a real mailbox

```powershell
Connect-ExchangeOnline -UserPrincipalName admin@greenhead.ac.uk

# Expected: a UserMailbox or SharedMailbox (NOT a distribution/mail-enabled group)
Get-Recipient -Identity "noreply@greenhead.ac.uk" |
    Select-Object Name, RecipientType, RecipientTypeDetails, PrimarySmtpAddress
```

A shared mailbox is fine and needs no licence — app-only `Mail.Send` can send from it. If `RecipientType` is a group, pick a different sender and update `MAIL_SENDER_UPN` in Railway.

### 3. If still 403 after consent — check for an Application Access Policy

```powershell
Test-ApplicationAccessPolicy -Identity "noreply@greenhead.ac.uk" `
    -AppId "655e8d1f-b446-4124-978e-a74e2d57183c"
Get-ApplicationAccessPolicy
```

- `AccessCheckResult : Granted` → the policy is not the problem.
- `DenyAccess` → either remove the policy, or add `noreply@greenhead.ac.uk` to the mailbox group the policy allows. Policy changes can take up to **60 minutes** to propagate to API enforcement.

---

## Verification

1. Make a test booking that triggers a notification — the simplest is a **minibus booking** (always notifies premises), or any room booking with **premises notes** filled in.
2. Confirm the email arrives at `premises@greenhead.ac.uk`.
3. Check **Admin → Audit log** — there should be **no** new `Premises email failed` entry.
4. For the **minibus checklist** email specifically: it only sends once a checklist has been uploaded via **Admin → Minibus checklist**. Upload one, then book a test minibus and confirm the booker receives the email with the attachment.

---

## When to run

- Notification emails stop arriving while bookings still work.
- `Premises email failed` (or `mailer: *_failed`) appears in the audit log / app logs.
- After rotating the app registration, changing `MAIL_SENDER_UPN`, or any Exchange admin activity touching application access policies.
