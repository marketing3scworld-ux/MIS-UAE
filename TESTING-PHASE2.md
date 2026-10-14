# Phase 2 — how to test it, module by module

A click-through script for user acceptance. Roughly 40 minutes end to end. Each
module says what to do, what you should see, and what it proves.

Test on a **staging copy** if you can — Module 5 approves hours, which is what
payroll and invoices read.

---

## Before you start

### 1. Log in
Go to the app (locally: `http://localhost:3000`). Sign in with your own account.

### 2. Give yourself the right roles

Phase 2 splits four duties across roles. Your current accounts:

| Account | Role | Ops Head | Can it schedule? | Verify? | Approve? | See payroll? |
| --- | --- | --- | --- | --- | --- | --- |
| `laibahkhattak@3scworld.com` | System Admin | yes | yes | yes | yes | yes |
| `asim@bmevents.ae` | System Admin | yes | yes | yes | yes | yes |
| `operationsmanager@bme.com` | Operations | no | yes | **no** | **no** | **no** |
| `reception@bmevents.ae` | Data Entry | no | **no** | no | no | no |

To test the *separation* between roles properly you need two more:

1. **Settings → Users → Add user**: create an **Accounts** tester with role
   **Finance** (e.g. `accounts.test@bmevents.ae`). Note the temp password — it is
   visible in the Password column afterwards.
2. Decide who your **supervisor** is. Anyone who verifies timesheets needs the
   **Ops Head** tick box in Settings → Users. Tick it for `operationsmanager@bme.com`
   *after* you finish Module 5 step 2, so you can first see the refusal.

> Forgotten a password? Settings → Users → the **🔑 key icon** on that row sets a
> new one, and the **👁 eye icon** reveals it afterwards.

### 3. Know where things are
New sidebar entries: **Deployments** (with *Schedule staff* and *Clients & projects*)
and **Reports**.

---

## Module 1 — Clients & projects

Staff are scheduled onto a **project/event**, never onto a client directly, so one
client can run several venues at once.

1. **Deployments → Clients & projects**.
2. Under *Add a client*, type `MANDARIN ORIENTAL` → **Add**.
3. Under *Add a project / event*: pick that client, name it `NYE GALA 2027`,
   location `MANDARIN ORIENTAL DOWNTOWN` → **Add**.
4. Add a second project under the same client, e.g. `BRUNCH SERVICE`.

**You should see** the client listed with "2 projects", each showing its default
location and "0 deployments".

**Proves** clients/projects exist and one client can hold several events.

*Also try:* press **Disable** on a project. It greys out and disappears from the
scheduling dropdown, but any deployments already recorded against it are untouched.

---

## Module 2 — Staff scheduling / deployment

1. **Deployments → Schedule staff**.
2. Check the **Event date** — it defaults to **tomorrow** (the brief asks for
   scheduling a day ahead).
3. Choose the project `Mandarin Oriental — Nye Gala 2027`.
4. Pick a **Shift** — choosing `NIGHT` should auto-fill start `22:00` and end
   `06:00`. Change them to **18:00 → 02:00**.
   - **You should see** the note *"Runs past midnight — ends the next day"*.
5. Set **Unpaid break** to `30`, **Duty** to `Banquet service`.
6. In section 2, tick **5 staff**. Use the search box and the category filter.
   - **You should see** a Documents column: *Complete* in green, or the specific
     problem in amber (e.g. "OHC Missing"). Staff are **not** blocked — this is
     advisory, because Operations sometimes deploys someone mid-renewal.
   - Tick **Documents complete only** to hide the non-compliant ones.
7. Press **Schedule 5 staff**.

**You should see** *"Scheduled 5 staff members."*

**Proves** staff are selected from the existing database and assigned to a client,
project, date, location, shift, duty and category. No profiles are created.

### 2b. Duplicate scheduling is prevented — the important one

8. Stay on the page. Schedule **the same people again**, same date, times
   **20:00 → 23:00** (inside the shift they already have).

**You should see** an amber panel: *"Skipped — already booked for an overlapping
shift"*, listing each person by name and the project they are already on. Nothing
is created.

9. Now try **02:00 → 06:00** on the **next day** for the same people — this starts
   exactly when the night shift ends.

**You should see** it succeed. Back-to-back shifts are legitimate; only *overlaps*
are refused.

**Proves** the same staff member cannot be double-booked. This is enforced by the
database itself, so two people scheduling at the same moment still cannot create a
clash.

---

## Module 3 — Deployment report

1. **Deployments** (the main list).
2. Check the six tiles: Shifts, Scheduled hrs, Actual hrs, Overtime, Absences,
   Replacements.
3. Confirm the table shows every column the brief lists: **Date, Client/Project,
   Location, Staff (with Staff ID), Category, Shift, Scheduled, Actual, OT,
   Variance, Status, Flags**.
4. Use the toolbar: change **From / To**, pick a **client**, then a **project**,
   then a **location**, then a **category**.
   - **You should see** the row count and the tiles change with each filter.
   - Selecting a client should narrow the project dropdown to that client's projects.
5. Press **Clear**.

**Proves** the deployment report exists, is filterable, and shows scheduled duty
time, hours and status.

---

## Module 4 — Actual timesheet entry & reconciliation

Do this as **Operations** (`operationsmanager@bme.com`) to confirm the role can.

1. From **Deployments**, click any row to open it.
2. Look at the **workflow strip** at the top: *Scheduled → Deployed → Timesheet
   Submitted → Timesheet Verified → Approved → Payroll / Client billing*. The
   stages reached so far are green.
3. In **Actual timesheet**, enter **check-in 18:00**, **check-out 02:00**, break
   `30` → **Save timesheet**.
   - **You should see** the status become *Timesheet submitted*, and the
     **Reconciliation** panel on the right fill in.

Now test each variance case on different rows:

| Enter this | Reconciliation should show |
| --- | --- |
| in 18:00, out 02:00, break 30 | Actual 7.5 h · Variance — · no overtime |
| in 18:00, out **04:00**, break 30 | Actual 9.5 h · **Overtime 2h 00m** · Variance +2h |
| in **18:45**, out **01:00**, break 30 | **Late arrival 45m** · **Early departure 60m** · Variance −1h 45m |
| tick **No-show / absent** | Absent = Yes · Variance −7h 30m · time boxes grey out |
| tick No-show **and** pick a **Replacement staff**, then enter that person's real in/out | Hours count again — and they belong to the **replacement** |

> That last row matters. "No-show" describes the person who was *scheduled*; if
> someone covered, the shift was worked and the replacement must be paid. Check
> the Reports module afterwards and confirm the hours appear under the
> **replacement's** name, not the absentee's.

**Proves** actual check-in/out, total hours, breaks, overtime, late arrival, early
departure, no-shows and replacements are all captured and reconciled against the
schedule.

---

## Module 5 — Approval workflow

This is the control that protects payroll and invoicing. Test the refusals first.

1. Still signed in as **Operations**, go to **Deployments**, tick a few rows with
   submitted timesheets.
2. Notice the bar only offers **Mark deployed** and **Cancel** — no Verify, no
   Approve.

3. Now tick **Ops Head** for that account (Settings → Users, as an admin), sign
   back in, and reload. **Verify timesheet** now appears.
4. Select the rows → **Verify timesheet**.
   - **You should see** *"verified N deployments"* and the status change to
     *Timesheet verified*.

5. Sign in as an **HR/Admin or System Admin**. Select the same rows → **Approve**.
   - **You should see** a confirmation warning that these become the basis for
     payroll and invoicing, then *"approved N deployments"*.

6. **Try to skip a step**: pick a row that is still only *Scheduled* and press
   **Approve**.
   - **You should see** it refused — *"not verified yet"*. Approval always requires
     a verified timesheet.

7. **Try to cancel an approved row as Operations**.
   - **You should see** *"N of these are approved — only HR/Admin can cancel those."*

**Proves** the chain Scheduled → Deployed → Timesheet Submitted → Timesheet
Verified → Approved is enforced server-side, with the right people at each gate.

### 5b. Changing something after approval

8. As **HR/Admin**, open an **approved** deployment.
   - **You should see** an amber warning above the timesheet form saying the hours
     are approved and a change will reopen them.
9. Change the check-out time → **Save timesheet**.
   - **You should see** *"…it has been reopened and needs re-approval."* and the
     status drop back to *Timesheet submitted*.
10. Scroll to **Audit trail** on the right.
    - **You should see** entries naming the person, the field, and the old → new
      value, plus a `reopened` entry.

**Proves** approved figures cannot move silently underneath Accounts.

---

## Module 6 — The four MIS reports

Go to **Reports**. Four tabs across the top.

| Tab | Check |
| --- | --- |
| **A. Actual Deployment** | Only **approved** rows. Client, event date, location, staff name + ID, category, scheduled duty time, actual in–out, working hours, overtime, status. A replacement shows as *"Cover Name (for Original Name)"*. |
| **B. Staff Working Hours / Payroll** | One row per person: days worked, shifts, scheduled hrs, **regular**, **overtime**, total, absences. Confirm **regular + overtime = total** on the TOTAL row. |
| **C. Client Chargeable Hours** | One row per client/project: chargeable days, shifts, staff deployed, chargeable hours. Confirm the total **matches report B's total** — same approved source. |
| **D. Scheduled vs Actual** | Shows **everything**, including rows not yet approved — that is its job. Columns for scheduled vs actual staff, scheduled vs actual hours, difference, overtime, late, early out, and a **Discrepancy** column reading *No-show*, *Replaced*, *Late*, *Overtime* or *As scheduled*. |

1. On each tab, set a **date range** covering your test data.
2. Filter by **client**, then **project**, then **location**, then **category**,
   then **staff**. Confirm the totals row recalculates each time.
3. On tabs A, B and C, look for the green note *"Approved timesheets only"*.

**The key check:** a deployment that is *not* approved must appear in **D** but not
in **A**, **B** or **C**.

### 6b. Accounts access

4. Sign in as your **Finance** tester.
   - **You should see** all four tabs, including Payroll and Chargeable Hours.
5. Sign in as **Operations**.
   - **You should see** only *Actual Deployment* and *Scheduled vs Actual*. The
     payroll and billing tabs are **absent**, and typing their URL directly returns
     "Forbidden".

**Proves** wage and invoice figures are restricted to Accounts/HR/Admin.

---

## Module 7 — Exports

1. On any report tab, press **Excel**.
   - A `.xlsx` downloads, named for the report and date range. Open it: navy header
     row, the report title and the filter summary at the top, a bold **TOTAL** row
     at the bottom.
2. Press **PDF**.
   - A print-ready page opens and the browser's print dialog appears — choose
     *Save as PDF*. Landscape A4.
3. Apply a filter, export again.
   - **The export must contain exactly the rows on screen.** Same filters, same
     numbers.
4. From **Deployments**, press **Export** for the operational worklist.

**Proves** all reports are exportable to Excel and PDF, honouring the filters.

---

## What "everything passed" looks like

- 5 staff scheduled for tomorrow's night shift; a second overlapping attempt refused by name.
- One shift showing 2h overtime, one showing late + early departure, one no-show with a replacement who is paid.
- Operations blocked from verifying and approving; supervisor verifies; manager approves.
- An edit after approval reopens the row and appears in the audit trail.
- Reports B and C show the same total hours; D shows more rows than A.
- Excel and PDF match the screen.

---

## If something looks wrong

Note the **deployment number** (top of its detail page) and what you expected. The
audit trail on that page usually explains it — it records who changed what and when.

Two things are **assumptions**, not bugs, until you confirm them:

- **Overtime** counts minutes beyond the *scheduled shift*. If HR uses a daily or
  weekly threshold instead, say so.
- **A supervisor with the Ops Head flag can both verify and approve.** Your brief
  groups those duties on one line. If wages need two different people, that is a
  one-line change.
