# BME MIS — Upgrade notes for this build

Read this **before** deploying over the version currently running at
`bmemisae.3sc.tech`. It is an upgrade of an existing install, not a fresh one, so
two steps that `DATA-RESTORE.txt` says you can skip are now **required**.

---

## 0. Behaviour change users will notice immediately

**Active / Inactive is no longer a field somebody sets. It is calculated from the
documents, and it updates itself.**

> A staff member is **Active** only while all four tracked documents (EID, OHC,
> BFHC, Passport) are uploaded **and** still in date.
> One **expired** document, or one **missing** one (no file, or no expiry date
> recorded), makes them **Inactive** automatically.
> A document that is merely *expiring soon* has not lapsed, so those people stay
> Active.

Consequences on the current data:

| | Old stored flag | This build |
| --- | --- | --- |
| Active | 86 | **75** |
| Inactive | 268 | **279** |

- The **Employment Status** dropdown on a profile is now a read-only
  *Status (from documents)* field. Saving a profile no longer writes to it.
- The `Staff.employmentStatus` column still exists and is untouched by the app's
  screens. It is what `notifications.ts` uses to decide who the nightly expiry scan
  alerts about. This is deliberate: if alerts keyed off the derived status, a
  document expiring would instantly mark the person Inactive and the scan would
  close the very alert that document needed. **There is currently no screen for
  marking someone as having left the company** — decide how you want that handled.
- The staff-list document filters (Has expired / Expiring soon / Has missing) are
  now mutually exclusive and match the badge on each row. "Expiring soon" no longer
  lists people whose row says Expired.
- Document status colours are now the traffic light required by spec §6 — green
  valid, yellow expiring, red expired. Valid previously rendered blue.

---

## 0b. Phase 2 is included in this build

Scheduling, timesheets, the approval workflow and the four MIS reports are live.
New navigation: **Deployments** (with *Schedule staff* and *Clients & projects*) and
**Reports**.

**The workflow.** Scheduled → Deployed → Timesheet Submitted → Timesheet Verified →
Approved → payroll / client billing. Reports A, B and C read **approved rows only**;
report D (Scheduled vs Actual) deliberately shows everything, because its job is to
surface discrepancies before sign-off.

**Who can do what** — mapped onto the existing five roles plus the Operations-Head
flag, so no new roles were invented:

| Duty in the brief | Role in the system | Can |
| --- | --- | --- |
| Operations | `OPERATIONS` | create deployments, enter actuals |
| Supervisor | any user with **Operations Head** ticked | verify timesheets |
| Operations Manager | `HR_ADMIN` / `SYSTEM_ADMIN` | approve (releases to payroll + billing) |
| Accounts | `FINANCE` | read approved payroll & chargeable-hours reports |
| Management | any role | read Actual Deployment and Scheduled vs Actual |

Set the **Operations Head** tick box in Settings → Users for whoever verifies
timesheets, otherwise nothing can move past *Timesheet Submitted* except HR/Admin.

**Two rules enforced in code, not just in the UI**

1. Approving requires a *verified* timesheet; verifying requires a *submitted* one.
   Skipping a step is refused server-side.
2. Editing an approved row is allowed only for HR/Admin, is written to the audit
   trail field-by-field, and **sends the row back for re-approval** — so a figure
   Accounts has already used can never change silently underneath them.

**Double-booking is impossible, not merely discouraged.** Besides the check in the
scheduling form, the migration adds a PostgreSQL exclusion constraint
(`Deployment_no_overlap`) so two schedulers acting at the same instant still cannot
create overlapping shifts for one person. Back-to-back shifts (17:00 end, 17:00
start) remain allowed.

**Assumptions to confirm before the first payroll run**

- **Overtime** = minutes worked beyond the minutes *scheduled for that shift*. The
  brief does not define the threshold and UAE practice varies (beyond the roster,
  beyond 8h/day, beyond 48h/week). Changing it means editing `computeHours()` in
  `src/lib/deployment.ts` and nothing else.
- **Chargeable hours = approved actual hours**, matching "client invoices are
  generated based on approved working hours". Scheduled hours are reported
  alongside so a different billing basis is a one-line change.
- Night shifts crossing midnight are handled: an end time at or before the start
  rolls to the next day, and the shift still reports under its own event date.

---

## 1. Run the database migrations — REQUIRED

`DATA-RESTORE.txt` says you can skip `prisma migrate deploy` when restoring the
dump. That was true for the original handover. **It is not true for this build** —
there are two new migrations, and the app will fail on the Settings page and the
staff forms without them.

```bash
npx prisma migrate deploy
```

| Migration | What it does |
| --- | --- |
| `20260808104500_add_user_password_enc` | adds `User.passwordEnc` (nullable) — the recoverable password copy shown in Settings |
| `20260808120000_add_residence_option` | adds the `ResidenceOption` table and seeds the 8 residence cities |
| `20260819062626_phase2_scheduling` | adds `Project`, `Deployment`, `DeploymentAudit`, `ShiftOption`, the `DeploymentStatus` enum, the no-overlap constraint, and seeds 5 shift presets |

All three are additive — no existing column or row is changed, so they are safe to
run against live data and need no downtime beyond the app restart.

> The Phase-2 migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist`, which the
> no-overlap constraint needs. It is a *trusted* extension on PostgreSQL 13+, so the
> database owner can install it without superuser. If your host blocks extensions
> entirely, drop that statement and the following `ALTER TABLE ... EXCLUDE` block
> from the migration — the application-level conflict check still works, you just
> lose the guarantee against two schedulers racing each other.

## 2. Extract `database/uploads.zip` — REQUIRED if not already done

Every document row in the database points at a file on disk. If `uploads.zip` was
never extracted on the server, every document 404s with **"File missing on disk"**
and the profile pages show broken thumbnails. This was the case on the development
machine and is worth checking on the server.

```bash
unzip uploads.zip -d /path/that/UPLOAD_DIR/points/at/..
# the archive already contains an "uploads/" folder, so extract into its PARENT
```

Verify: `find $UPLOAD_DIR -type f | wc -l` should report **1552**.

## 3. Fix `NEXTAUTH_URL` — REQUIRED

Two problems with the current production value:

1. **It has a trailing slash.** Auth.js appends paths to it, so `https://host/`
   produces redirects to `https://host//dashboard`.
2. **It is `http://`, not `https://`.** Requesting
   `https://bmemisae.3sc.tech/documents` currently redirects to
   `http://bmemisae.3sc.tech/login?...` — a downgrade to plain HTTP. Staff are
   typing passwords into an unencrypted page on a system holding Emirates IDs,
   passports and bank details.

```
NEXTAUTH_URL="https://bmemisae.3sc.tech"     # https, NO trailing slash
```

If the app sits behind Nginx/IIS, also make sure the proxy forwards
`X-Forwarded-Proto: https`, or Next will keep generating `http://` URLs regardless
of this setting.

## 4. Rotate the secrets that were shipped in `.env`

The handover `.env` was distributed with the package, so treat these as
compromised and replace them on the server:

- `ANTHROPIC_API_KEY` — rotate at console.anthropic.com
- `SMTP_PASS` — the Gmail app password. It is currently **rejected** by Google
  (`534-5.7.9 Application-specific password required`), so escalation emails are
  not being delivered at all. Generate a fresh app password at
  myaccount.google.com/apppasswords with 2-Step Verification enabled.
- `NEXTAUTH_SECRET` — see the warning below before changing this one.

> **Changing `NEXTAUTH_SECRET` invalidates the stored password copies.**
> `User.passwordEnc` is encrypted with a key derived from `NEXTAUTH_SECRET`. Rotate
> the secret and every recorded password reads "not recorded" in Settings. Sign-in
> is unaffected (that checks the bcrypt hash), and a Super Admin can set fresh
> passwords afterwards. Rotating also signs everyone out, which is expected.

---

## Deploy sequence

```bash
unzip bme-mis-deploy.zip && cd bme-mis
npm ci
cp .env.example .env        # then fill it in — see notes 3 and 4 above
npx prisma migrate deploy   # note 1 — REQUIRED
npm run preflight           # checks DB, SMTP, upload dir, Anthropic key
npm run build
npm run start
```

`npm run preflight` is the quickest way to confirm the database, upload directory
and mail settings are all reachable before you put the app back in front of users.
