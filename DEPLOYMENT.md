# BME MIS — Deployment Guide

Read **`PROJECT_MAP.md`** first for the "what is this" overview. This file is the how-to-deploy.

## What's in this package (and what isn't)

**Included:** all application source (`src/`), the database model + migrations + seed (`prisma/`),
static assets (`public/`), utility scripts (`scripts/`), config files, `package.json` +
`package-lock.json`, `docker-compose.yml`, `.env.example`, and these docs.

**Deliberately NOT included** (provision or transfer separately):
| Not in zip | Why | How to get it |
| --- | --- | --- |
| `node_modules/` | reinstallable | `npm ci` (step 2) |
| `.next/` build output | regenerated | `npm run build` (step 6) |
| real `.env` | contains live secrets | create from `.env.example` (step 4) |
| `uploads/` (documents) | personal data (PII) | transfer securely (step 7) |
| `data/`, `backups/` | source spreadsheets / DB dumps (PII) | transfer securely (step 7) |

---

## 1. Prerequisites
- **Node.js 20+** (LTS) and npm
- **PostgreSQL 16** — a managed instance, a self-hosted server, or the bundled `docker-compose.yml`
- A host that can run a **long-lived Node process** (Linux + systemd/pm2, or Windows service/NSSM),
  ideally behind **Nginx / IIS** for HTTPS
- *(optional)* **Ghostscript** — enables PDF compression on upload

## 2. Install dependencies
```bash
unzip bme-mis-deploy.zip && cd bme-mis
npm ci               # clean, reproducible install from package-lock.json
npx prisma generate  # REQUIRED — see below
```

> **`npx prisma generate` is not optional.** It used to happen by itself, as
> `@prisma/client`'s postinstall hook. **npm 11 and later block install scripts by
> default** (`npm ci` prints an `install-scripts` warning listing what it skipped),
> so on a current Node/npm the Prisma client is never generated and the build dies
> with `Module '"@prisma/client"' has no exported member 'Role'`. Running it
> explicitly is safe on every npm version — it is a no-op if the hook already ran.

> **Windows/PowerShell:** if `npm` gives you *"running scripts is disabled on this
> system"*, PowerShell is blocking npm's `.ps1` wrapper. Either call `npm.cmd` /
> `npx.cmd`, or run once:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.

## 3. Provision the database
- **Option A — existing/managed Postgres:** create a database + user and note the connection string.
- **Option B — Docker (included):** `docker compose up -d` starts PostgreSQL 16 on port 5432.
  **Change the password** in `docker-compose.yml` first.

## 4. Configure environment
```bash
cp .env.example .env
```
Fill in (each is explained in `.env.example`):
- `DATABASE_URL` — your Postgres connection string
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL` — the **real public URL** (e.g. `https://mis.bmevents.ae`). Required in production — login and email links break if it's wrong.
- `UPLOAD_DIR` — **absolute** path to writable, backed-up storage for documents
- `ANTHROPIC_API_KEY` — *optional, but the Emirates-ID auto-fill button does nothing without it.*
  The upload form shows "Auto-fill isn't configured yet (no ANTHROPIC_API_KEY)" and users must
  type every field by hand. Get a key from console.anthropic.com.
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` — *optional, but nobody is notified without them.*
  Document-expiry escalation emails are written to the server log instead of sent.
  `SMTP_HOST` is a mail server hostname (Gmail: `smtp.gmail.com`), **not** an email address;
  `SMTP_USER` is the address you authenticate as, and it must be non-empty or the password is
  ignored and the connection goes out unauthenticated.

> Both "optional" features fail **silently and by design** — the app runs fine without them, so a
> deploy that forgot them looks healthy until someone asks why auto-fill is greyed out or why no
> expiry alerts ever arrived. `npm run preflight` (step 5) is what catches that.

## 5. Build the schema + seed
```bash
npx prisma migrate deploy    # creates all tables from prisma/migrations
npm run seed                 # creates the admin login + default dropdowns/settings
```
Seeded admin — **change the password right after first login:**
`admin@bmeventsksa.com` / `Admin@BME2026`

### Verify the environment before building
```bash
npm run preflight
```
Checks every variable by **using** it: connects to Postgres, writes a probe file to `UPLOAD_DIR`,
authenticates against the Anthropic API (no tokens spent), and completes an SMTP handshake without
sending mail. Exits non-zero if a required variable is wrong; reports the two optional features as
warnings when they're switched off, so "auto-fill is disabled" is a line of output rather than a
support ticket three weeks later.

To confirm mail actually lands (preflight authenticates but sends nothing):
```bash
npm run test:mail -- you@yourdomain.com
```

## 6. Build + run
```bash
npm run build
npm run start                # serves on port 3000
```
Put a reverse proxy (Nginx/IIS) in front for HTTPS, and keep the process alive with a supervisor,
e.g. `pm2 start npm --name bme-mis -- start`, a systemd unit, or a Windows service.
**The nightly expiry scan only runs while the app is running.**

## 7. Migrate the existing data (354 staff + their documents)
The app deploys with an **empty** database. To carry the current data across, on the **current** machine:
```powershell
# database dump (port 5433 is the current dev instance)
pg_dump -h localhost -p 5433 -U bme -d bme_mis -F c -f bme_mis.dump

# documents
Compress-Archive -Path uploads -DestinationPath uploads.zip      # or: tar -czf uploads.tgz uploads
```
**Transfer both files securely** (encrypted drive / secure file transfer — they are personal data,
do not email them). On the **new** server:
```bash
pg_restore -h <host> -p <port> -U <user> -d bme_mis --clean bme_mis.dump
npx prisma migrate deploy    # REQUIRED — see below
npm run seed                 # baseline lists + the 83-client customer list
# unzip uploads.zip into the new UPLOAD_DIR
```
After this the app already contains all staff, users, and documents.

> **Do not skip the two commands after `pg_restore`.** A dump is only as current as
> the day it was taken. The dump shipped in `database/bme_mis.dump` is from
> 31 July 2026 and is three migrations behind this code — no `Project`,
> `Deployment`, `DeploymentAudit`, `ShiftOption` or `ResidenceOption` table and no
> `User.passwordEnc` column — so Deployments and Clients fail on a missing table
> until `migrate deploy` runs. Both commands are safe on live data: the pending
> migrations only add tables and columns, and the seed only fills in what is
> missing (it never overwrites a renamed or disabled client). Confirm with
> `npx prisma migrate status` → "Database schema is up to date!".

## 8. Post-deploy checklist
- [ ] Changed the seeded admin password
- [ ] `NEXTAUTH_URL` set to the production URL (HTTPS)
- [ ] **Rotated every secret used in development** (the Gmail app password and Anthropic key that were
      in the dev `.env` should be regenerated — they are not shipped in this package, but rotate them anyway)
- [ ] `UPLOAD_DIR` on backed-up storage
- [ ] Nightly DB backup scheduled (`npm run backup` + copy of `UPLOAD_DIR`)
- [ ] HTTPS + reverse proxy verified
- [ ] Sent a test email (Settings → Email) and ran an expiry scan (Notifications)

---

## Quick reference
| Thing | Value |
| --- | --- |
| App port | 3000 (behind reverse proxy in prod) |
| DB | PostgreSQL 16 (Docker default 5432; current dev 5433) |
| Processes to run | **1** Node app + **1** Postgres. No separate API server. |
| Node | 20+ |
| Scan schedule | `SCAN_CRON` (default `0 2 * * *`), `SCAN_TZ` (default `Asia/Dubai`) |
| Health check | open `NEXTAUTH_URL/login` → should return the sign-in page |
