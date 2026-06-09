# Secret rotation

All secrets are set as Railway environment variables. Changing a variable
triggers an automatic redeploy.

---

## 1. Azure AD client secret (`AZURE_CLIENT_SECRET`)

**When to rotate:** Before expiry (set a calendar reminder at creation). Typical expiry: 1–2 years.

**Impact:** Zero-downtime if done in the right order. A brief gap between
deleting the old secret and the new instance starting uses the new secret.

**Procedure (zero-downtime):**

1. **Azure Portal** → App registrations → [MRBS app] → Certificates & secrets
2. Click **New client secret** → set description (e.g. `mrbs-2026`) and expiry
3. Copy the new secret **Value** immediately (shown only once)
4. **Railway dashboard** → meetingrooms → Variables → update `AZURE_CLIENT_SECRET` with the new value
5. Railway auto-redeploys. Wait for the new deployment to reach **Active** status
6. Verify: sign in to the portal; confirm bookings work
7. **Azure Portal** → delete the old client secret (the one you replaced)

**If the secret has already expired:**
- Step 3 above — Railway will redeploy automatically
- All Graph calls fail until the redeploy completes (~90 s)
- No data loss; Redis `graph:degraded` flag will be set and cleared automatically

---

## 2. Session secret (`SESSION_SECRET`)

**When to rotate:** Suspected compromise, periodic policy requirement, or after a staff member with server access leaves.

**Impact:** ALL active user sessions are immediately invalidated on redeploy. Every signed-in user is redirected to the sign-in page. No data loss.

**Procedure:**

1. Generate a new secret:
   ```bash
   openssl rand -hex 32
   ```
2. **Railway dashboard** → Variables → update `SESSION_SECRET`
3. Railway auto-redeploys
4. Notify staff: "You will need to sign in again to the room booking system"

**Do this outside school hours** to minimise disruption.

---

## 3. QR signing key (`QR_SIGNING_KEY`)

**When to rotate:** Suspected token forgery or periodic policy requirement.

**Impact:** All QR tokens currently displayed on iPads are invalidated immediately on redeploy. iPads refresh their QR token every 4 minutes — after one refresh cycle the displays show a valid new token. Maximum disruption: 4 minutes.

**Procedure:**

1. Generate a new key:
   ```bash
   openssl rand -hex 32
   ```
2. **Railway dashboard** → Variables → update `QR_SIGNING_KEY`
3. Railway auto-redeploys
4. Monitor `/admin/status` to confirm displays come back online within 5 minutes

**Note:** The QR token is provenance, not auth. Rotating this key means any QR codes photographed from screens before the rotation become invalid — this is the desired effect.

---

## 4. Device token revocation

Device tokens are long-lived random bytes stored as SHA-256 hashes. There is
no bulk rotation — tokens are revoked individually.

**When to revoke:** Device is lost, stolen, decommissioned, or re-purposed.

**Procedure:**

1. **Portal** → `/admin/devices` → find the device → click **Revoke**
   - This deletes the token hash from Postgres and disconnects any live Socket.IO connection
2. The device will show a 401 on its next heartbeat and fall back to the enroll screen
3. Re-pair if the device is still in use: see `ipad-wont-come-online.md` Step 4

**There is no way to recover a device token once revoked.** The device must be re-enrolled.

---

## Post-rotation checklist

- [ ] New secret/key is stored in the team password manager
- [ ] Expiry date noted in the team calendar (for client secrets)
- [ ] Old secret deleted from Azure (for client secret rotation)
- [ ] Deployment is **Active** in Railway dashboard
- [ ] `/api/health` returns `{"ok":true,...}`
- [ ] Test booking creates and cancels successfully
- [ ] `/admin/status` shows all displays Online (after QR key rotation)
