import { prisma } from "@/lib/prisma";
import { formatDateUTC, titleCaseName } from "@/lib/format";
import { parseTimeHHMM, type SheetRow } from "@/lib/timesheet-sheet";
import type { ExtractedRow } from "@/lib/timesheet-ocr";

// Ties lines read off a timesheet to shifts. The order of evidence is fixed:
//   1. a printed Deployment ID — checked against the date and staff on the line;
//   2. a scheduled shift that day for the Staff ID, or for the one person whose name fits;
//   3. no shift was scheduled: the line becomes a NEW shift, but only for the one staff
//      profile the Staff ID or name points to.
// A line that cannot be tied to ONE shift or ONE person is reported, never assigned —
// these hours become wages.

export type MatchError = { row: number; source: string; detail: string };

/** A timesheet as read, before matching. Rows from a template whose shift was deleted come through here too. */
export type ReadFile = {
  name: string;
  documentDate: string | null;
  clientName: string | null;
  location: string | null;
  sheetNo?: number | null; // the venue's printed timesheet number, stamped on every shift it records
  rows: (ExtractedRow & { row?: number; client?: string | null; event?: string | null })[];
};

/** What the reviewer set for a sheet on screen: the date to use and where new shifts belong. */
export type SheetOptions = { date?: string; client?: string; event?: string };

/** A line with no scheduled shift, tied to exactly one staff profile. */
export type NewShift = {
  row: number;
  source: string;
  file: string;
  staffId: number;
  staffName: string;
  category: string | null;
  date: string;
  actualIn: string | null;
  actualOut: string | null;
  breakMinutes: number | null;
  noShow: boolean;
  notes: string | null;
  client: string | null;
  event: string | null;
  location: string | null;
  timesheetNo: number | null;
  matchNote?: string;
};

export type FileInfo = {
  name: string;
  detectedDate: string | null;
  lineDates: string[];
  dateConflict: boolean; // heading and lines disagree and nobody has chosen yet
  date: string | null; // the date in force for the sheet (chosen, or the one detected)
  client: string | null;
  location: string | null;
};

type Candidate = {
  id: number;
  eventDate: Date;
  startAt: Date;
  status: string;
  staffId: number;
  replacementStaffId: number | null;
  staff: { fullName: string };
  replacementStaff: { fullName: string } | null;
};

// Written short forms of the same first name ("MD RASHADUL" on a sheet, "MOHAMMAD RASHADUL ISLAM" on file).
const SAME_NAME: Record<string, string> = {
  MD: "MOHAMMAD", MOHD: "MOHAMMAD", MOHAMAD: "MOHAMMAD", MOHAMED: "MOHAMMAD", MOHAMMED: "MOHAMMAD",
  MUHAMMAD: "MOHAMMAD", MUHAMMED: "MOHAMMAD", MOHAMMEDH: "MOHAMMAD",
};
const tokens = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").split(" ").filter(Boolean)
    .map((t) => SAME_NAME[t] ?? t);

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * How well a written name fits a name on file: 3 exact, 2 every written word appears
 * (first names agreeing; "KAREN V." fits "KAREN VILLANUEVA"), 1 close spelling on 2+
 * words ("MD RASHADUL" / "MD RASHEDUL ISLAM"), 0 no. A single first name only counts
 * when it narrows things down to one person — the caller enforces uniqueness.
 */
export function nameFit(written: string, onFile: string): number {
  const a = tokens(written);
  const b = tokens(onFile);
  if (!a.length || !b.length) return 0;
  if (a.join("") === b.join("")) return 3;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const tol = (t: string) => (t.length >= 8 ? 2 : t.length >= 5 ? 1 : 0);
  if (short[0].length === 1 || lev(short[0], long[0]) > tol(short[0])) return 0; // first names must agree
  const take = (pool: string[], same: (t: string, u: string) => boolean) => (t: string) => {
    const i = pool.findIndex((u) => (t.length === 1 ? u.startsWith(t) : same(t, u)));
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  };
  if (short.every(take([...long], (t, u) => t === u))) return 2;
  if (short.length >= 2 && short.every(take([...long], (t, u) => lev(t, u) <= tol(t)))) return 1;
  return 0;
}

const dayISO = (d: Date) => d.toISOString().slice(0, 10);
const who = (c: Candidate) => c.replacementStaff?.fullName ?? c.staff.fullName;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function matchExtractedRows(
  files: ReadFile[],
  firstRow: number,
  options: Record<string, SheetOptions> = {},
): Promise<{ sheetRows: SheetRow[]; newShifts: NewShift[]; errors: MatchError[]; info: FileInfo[] }> {
  const info: FileInfo[] = files.map((f) => {
    const opt = options[f.name] ?? {};
    const lineDates = [...new Set(f.rows.map((r) => r.date).filter((d): d is string => !!d))].sort();
    const dateConflict = !opt.date && !!f.documentDate && lineDates.some((d) => d !== f.documentDate);
    return {
      name: f.name,
      detectedDate: f.documentDate,
      lineDates,
      dateConflict,
      date: opt.date ?? (lineDates.length === 1 ? lineDates[0] : f.documentDate),
      client: opt.client ?? f.clientName,
      location: f.location,
    };
  });

  const ids = new Set<number>();
  const dates = new Set<string>();
  files.forEach((f, i) => {
    for (const r of f.rows) {
      if (r.deploymentId) ids.add(r.deploymentId);
      const d = options[f.name]?.date ?? r.date ?? f.documentDate;
      if (d) dates.add(d);
    }
    if (info[i].date) dates.add(info[i].date!);
  });

  const candidates: Candidate[] = ids.size || dates.size
    ? await prisma.deployment.findMany({
        where: {
          OR: [
            ...(ids.size ? [{ id: { in: [...ids] } }] : []),
            ...(dates.size ? [{ eventDate: { in: [...dates].map((d) => new Date(`${d}T00:00:00.000Z`)) } }] : []),
          ],
        },
        select: {
          id: true, eventDate: true, startAt: true, status: true, staffId: true, replacementStaffId: true,
          staff: { select: { fullName: true } }, replacementStaff: { select: { fullName: true } },
        },
      })
    : [];
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // The staff list, only loaded when a line has no scheduled shift to match.
  let everyone: { id: number; fullName: string; category: string | null }[] | null = null;
  const staffList = async () =>
    (everyone ??= await prisma.staff.findMany({ select: { id: true, fullName: true, category: true } }));

  const sheetRows: SheetRow[] = [];
  const newShifts: NewShift[] = [];
  const errors: MatchError[] = [];
  let n = firstRow;

  for (const [fi, f] of files.entries()) {
    const opt = options[f.name] ?? {};
    for (const raw of f.rows) {
      // Once the reviewer has chosen the sheet's date, the reader's remarks about
      // conflicting dates are settled and would only repeat on every line.
      const unclear = opt.date && raw.unclear
        // Split on ";" and on sentence ends only — "SEPT. 12, 2026" must stay in one piece.
        ? raw.unclear.split(/;\s*|,\s*(?=both|kept)|(?<=[a-z0-9)'"])\.\s+(?=[A-Z])/).filter((s) => !/\bdate|heading|carried down|kept as written|\b20\d\d\b/i.test(s)).join("; ").trim() || null
        : raw.unclear;
      const r = { ...raw, unclear };
      const row = r.row ?? n++;
      const source = `${f.name} · ${r.source}`;
      const fail = (detail: string) => errors.push({ row, source, detail: r.unclear ? `${detail} (Reader note: ${r.unclear})` : detail });

      const actualIn = parseTimeHHMM(r.timeIn);
      const actualOut = parseTimeHHMM(r.timeOut);
      if (r.timeIn && !actualIn) { fail(`Could not read the time in "${r.timeIn}".`); continue; }
      if (r.timeOut && !actualOut) { fail(`Could not read the time out "${r.timeOut}".`); continue; }

      if (info[fi].dateConflict && r.date && r.date !== f.documentDate) {
        fail(`The sheet's heading says ${f.documentDate} but this line says ${r.date}. Choose the date for this sheet below, then check again.`);
        continue;
      }
      const date = opt.date ?? r.date ?? f.documentDate;
      const name = r.staffName ?? "";
      const label = name ? `"${name}"` : "this line";
      const notes: string[] = [];
      if (r.unclear) notes.push(`Reader note: ${r.unclear}`);

      if (r.deploymentId) {
        const c = byId.get(r.deploymentId);
        if (c) {
          if (date && date !== dayISO(c.eventDate)) {
            fail(`Deployment ID ${c.id} is on ${formatDateUTC(c.eventDate)}, but the sheet says ${date}.`); continue;
          }
          if (r.staffNumber && r.staffNumber !== c.staffId && r.staffNumber !== c.replacementStaffId) {
            fail(`Deployment ID ${c.id} is for ${titleCaseName(who(c))} (Staff ID ${c.replacementStaffId ?? c.staffId}), but the sheet says Staff ID ${r.staffNumber}.`); continue;
          }
          if (name && Math.max(nameFit(name, c.staff.fullName), c.replacementStaff ? nameFit(name, c.replacementStaff.fullName) : 0) === 0) {
            notes.push(`Name on sheet "${name}" differs from the scheduled ${titleCaseName(who(c))} — check`);
          }
          sheetRows.push({ ...toSheetRow(row, source, c.id, date, actualIn, actualOut, r, notes), timesheetNo: f.sheetNo ?? null });
          continue;
        }
        notes.push(`Deployment ID ${r.deploymentId} does not exist (any more) — matched by staff and date instead`);
      }

      if (!date) { fail(`No date for ${label} — choose the date for this sheet below, then check again.`); continue; }
      const onDay = candidates.filter((c) => dayISO(c.eventDate) === date && c.status !== "CANCELLED");

      // 2. A shift scheduled that day.
      let pool: Candidate[] = [];
      if (r.staffNumber) {
        pool = onDay.filter((c) => c.staffId === r.staffNumber || c.replacementStaffId === r.staffNumber);
      } else if (name && onDay.length) {
        const fits = onDay.map((c) => ({ c, fit: Math.max(nameFit(name, c.staff.fullName), c.replacementStaff ? nameFit(name, c.replacementStaff.fullName) : 0) }));
        const best = Math.max(...fits.map((x) => x.fit));
        if (best > 0) {
          pool = fits.filter((x) => x.fit === best).map((x) => x.c);
          const people = new Set(pool.map((c) => c.replacementStaffId ?? c.staffId));
          if (people.size > 1) {
            fail(`${label} could be ${[...new Set(pool.map((c) => titleCaseName(who(c))))].join(" or ")} on ${date} — add the Staff ID or Deployment ID.`); continue;
          }
          if (best < 3) notes.push(`Matched by name: "${name}" → ${titleCaseName(who(pool[0]))} — check`);
        }
      } else if (!name) {
        fail("This line has no name, Staff ID or Deployment ID."); continue;
      }

      if (pool.length) {
        // One person, several shifts that day (split shift): the time in decides, if it clearly can.
        if (pool.length > 1 && actualIn) {
          const near = pool.filter((c) => Math.abs(minutes(c.startAt.toISOString().slice(11, 16)) - minutes(actualIn)) <= 180);
          if (near.length === 1) { pool = near; notes.push("Picked the shift whose start is nearest the time in — check"); }
        }
        if (pool.length > 1) {
          fail(`${titleCaseName(who(pool[0]))} has ${pool.length} shifts on ${date} — add the Deployment ID to say which.`); continue;
        }
        sheetRows.push({ ...toSheetRow(row, source, pool[0].id, date, actualIn, actualOut, r, notes), timesheetNo: f.sheetNo ?? null });
        continue;
      }

      // 3. Nothing scheduled: find the one staff profile this line is about.
      const staff = await staffList();
      let person: (typeof staff)[number] | undefined;
      if (r.staffNumber) {
        person = staff.find((s) => s.id === r.staffNumber);
        if (!person) { fail(`Staff ID ${r.staffNumber} is not in the staff list.`); continue; }
      } else {
        const fits = staff.map((s) => ({ s, fit: nameFit(name, s.fullName) }));
        const best = Math.max(0, ...fits.map((x) => x.fit));
        const top = fits.filter((x) => x.fit === best).map((x) => x.s);
        if (!best) { fail(`No shift was scheduled for ${label} on ${date}, and no staff profile matches that name — add them under Staff (or correct the name / write their Staff ID on the sheet), then upload again.`); continue; }
        if (top.length > 1) {
          const shown = top.slice(0, 4).map((s) => `${titleCaseName(s.fullName)} (ID ${s.id})`).join(", ");
          fail(`${label} matches ${top.length} staff profiles: ${shown}${top.length > 4 ? ", …" : ""} — add the Staff ID.`); continue;
        }
        person = top[0];
        if (best < 3) notes.push(`Matched to the profile by name: "${name}" → ${titleCaseName(person.fullName)} — check`);
      }
      newShifts.push({
        row, source, file: f.name, staffId: person.id, staffName: person.fullName, category: person.category,
        date, actualIn, actualOut, breakMinutes: r.breakMinutes, noShow: r.noShow, notes: r.notes,
        client: r.client ?? opt.client ?? f.clientName,
        event: r.event ?? opt.event ?? null,
        location: f.location,
        timesheetNo: f.sheetNo ?? null,
        matchNote: notes.join(" · ") || undefined,
      });
    }
  }

  return { sheetRows, newShifts, errors, info };
}

function toSheetRow(
  row: number, source: string, deploymentId: number, date: string | null,
  actualIn: string | null, actualOut: string | null, r: ExtractedRow, notes: string[],
): SheetRow {
  return {
    row,
    deploymentId,
    staffId: r.staffNumber,
    eventDate: date,
    actualIn,
    actualOut,
    breakMinutes: r.breakMinutes,
    noShow: r.noShow,
    notes: r.notes,
    blank: !actualIn && !actualOut && r.breakMinutes === null && !r.noShow && !r.notes,
    source,
    matchNote: notes.join(" · ") || undefined,
  };
}
