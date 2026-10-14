# BME MIS — Phase 1

**Brilliant Minds Events LLC — Management Information System.**
Phase 1 is a **Staff Profile & Document Repository**: a single place to hold staff
records, track the expiry of their key documents (Emirates ID, OHC, BFHC,
passport), and get alerted before things lapse.

---

## Features

- **Staff records** — searchable, filterable, paginated list; full profile with
  role-based editing; Excel export.
- **Documents** — upload / version EID (front & back), passport, OHC, BFHC, bank
  proof; auth-gated file serving; expiry synced to the profile.
- **Emirates-ID auto-fill** — the New-Profile wizard reads an EID photo with
  Claude vision and pre-fills name, EID number, expiry, nationality and gender
  for you to verify.
- **Expiry engine + notifications** — nightly scan raises in-system alerts for
  expired / expiring documents, re-notifies on a schedule, and escalates by
  email to a user's manager.
- **Dashboard & reports** — live KPIs, per-document status breakdown, and a
  Document-Expiry renewals worklist (with Excel export).
- **Settings** — expiry-engine tuning, editable dropdown lists, and user
  management (roles, managers, Operations-Head flag).
- **Roles (RBAC)** — Data-Entry, Operations, HR/Admin, Finance, System Admin.
- **Bilingual** — English and Arabic (RTL), switchable in the top bar.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
PostgreSQL 16 + Prisma 6 · Auth.js v5 (credentials) · `@anthropic-ai/sdk`
(Claude vision) · exceljs · node-cron · nodemailer · next-intl.

---

## Prerequisites

- **Node.js 20+**
- **PostgreSQL 16** running and reachable (this project was set up with a native
  install on `localhost:5433`).

## Setup

```powershell
# 1. Install dependencies
npm install

# 2. Configure environment — see the .env reference below
#    (a .env is created during setup; fill in the blanks)

# 3. Create the database schema and seed baseline data
npx prisma migrate deploy        # or: npx prisma migrate dev
npm run seed

# 4. (Optional) Import real data — see Data import below
```

### `.env` reference

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://bme:...@localhost:5433/bme_mis?schema=public`) |
| `NEXTAUTH_SECRET` | Auth.js session-signing secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | App URL, e.g. `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | Claude API key for EID auto-fill (from console.anthropic.com). Auto-fill degrades to manual entry if unset. |
| `EID_OCR_MODEL` | *(optional)* OCR model — default `claude-opus-5`; set `claude-sonnet-5` for a cheaper scan |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email for escalation alerts. Unset → emails are logged to the console instead of sent. |
| `UPLOAD_DIR` | Local document storage root (default `./uploads`) |
| `SCAN_CRON` / `SCAN_TZ` | *(optional)* Nightly scan schedule (default `0 2 * * *`, `Asia/Dubai`) |
| `PG_DUMP` | *(optional)* Full path to `pg_dump.exe` if it isn't on PATH (used by `npm run backup`) |

`.env`, `/uploads`, `/data`, `/backups`, and `/import-reports` are gitignored —
they hold secrets or PII and must never be committed.

## Running

```powershell
npm run dev          # http://localhost:3000
```

Sign in with the seeded admin (change the password in Settings after first login):

- **Email:** `admin@bmeventsksa.com`
- **Password:** `Admin@BME2026`

For production: `npm run build` then `npm run start`.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run seed` | Seed the admin user, dropdown lists, and app settings |
| `npm run import:staff -- "<file.xlsx>" [--wipe]` | Import the staff master list |
| `npm run import:docs -- [--wipe]` | Bulk-import document scans from `data/<STAFF NAME>/…` (exact-name match only) |
| `npm run backup` | `pg_dump` the database to `./backups` (keeps the newest 14) |

### Data import

Place source files under `data/` (gitignored). The staff import handles the
real column layout and `DD/MM/YYYY` text dates; the document import matches
folders to staff by **exact name only** (never fuzzy — a mis-file would attach
someone's ID to the wrong person). Both write a CSV report to `import-reports/`.

---

## Notifications & the nightly scan

The expiry engine runs in-process via `node-cron` (started from
`src/instrumentation.ts`) at `SCAN_CRON` (default 02:00 Asia/Dubai). It only
fires while the app is running. To run it on demand, sign in as an admin and use
**Notifications → Run expiry scan now**.

Alerts route to the staff member's *handled-by* Operations user, else the
flagged **Operations Head**, else all Operations users, else System Admins.
Create those users under **Settings → Users** so alerts reach the right people;
set each user's **manager** for escalation emails.

## Backup & restore

```powershell
npm run backup                      # -> backups/bme_mis-<timestamp>.dump

# restore a dump into the database
pg_restore -h localhost -p 5433 -U bme -d bme_mis --clean "backups/<file>.dump"
```

Uploaded files live under `UPLOAD_DIR` (`./uploads`) — back that folder up
alongside the database dump for a complete restore.

## Languages (EN / AR)

The top-bar toggle switches between English and Arabic; Arabic renders the app
right-to-left. The choice is stored in a cookie. UI strings live in
`src/messages/{en,ar}.json` — extend those catalogs to translate more of the
interface.

---

## Security notes

- All document files are served through an authenticated route — no direct
  public access.
- The Claude API key is used server-side only and never exposed to the browser.
- Staff documents and the master lists are PII; the gitignore keeps `data/`,
  `uploads/`, `backups/`, and `.env` out of version control.
- Permissions are enforced server-side on every action, not just hidden in the
  UI.

*Phase 1 of 5 · Brilliant Minds Events LLC.*
