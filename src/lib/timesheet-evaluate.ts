import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildShiftRange, formatHM, type Actor } from "@/lib/deployment";
import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import type { SheetRow } from "@/lib/timesheet-sheet";
import {
  matchExtractedRows, type FileInfo, type MatchError, type NewShift, type ReadFile, type SheetOptions,
} from "@/lib/timesheet-match";
import {
  describeActuals, planTimesheetRows, workedMinutes, PLAN_SELECT, type PlanRow, type Target,
} from "@/lib/timesheet-plan";

// Everything an upload would do, worked out from what was READ (signed at check time)
// plus what the reviewer chose on screen (a sheet's date, its client and event). Check,
// check-again and record all call this, so what gets saved is exactly what was shown —
// and the files are only ever read once.
//
// A line lands one of three ways:
//   update — it matched a scheduled shift, whose actual hours it fills in;
//   create — nothing was scheduled, so a shift is created from the timesheet for the one
//            staff profile the line points to (scheduled time = the time worked);
//   error  — it could not be tied to one shift or one person, and is skipped.
// Nothing is ever approved here: created and updated shifts land as Timesheet submitted
// and still go through Verify → Approve before payroll and billing reports count them.

export type UploadData = {
  files: string[];
  template: { file: string; rows: SheetRow[] }[];
  read: ReadFile[];
  nextRow: number;
};

export type CreateTarget = {
  row: number;
  label: string;
  staffId: number;
  category: string | null;
  client: string;
  event: string;
  location: string | null;
  timesheetNo: number | null;
  eventDate: Date;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  notes: string | null;
};

export type SheetSummary = FileInfo & { event: string | null; newShifts: number; needsClient: boolean };

export type Evaluation = {
  plan: PlanRow[];
  counts: { update: number; create: number; unchanged: number; error: number };
  updates: Target[];
  creates: CreateTarget[];
  sheets: SheetSummary[];
  totalMinutes: number;
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase() || null;

export async function evaluateUpload(
  data: UploadData,
  options: Record<string, SheetOptions>,
  a: Actor,
): Promise<Evaluation> {
  // Template rows whose shift was deleted after the sheet was downloaded: if hours were
  // filled in, match them by the staff and date printed on the template instead.
  const templateIds = [...new Set(data.template.flatMap((t) => t.rows.map((r) => r.deploymentId)).filter((n): n is number => !!n))];
  const existing = new Set(
    templateIds.length ? (await prisma.deployment.findMany({ where: { id: { in: templateIds } }, select: { id: true } })).map((d) => d.id) : [],
  );
  const templateRows: SheetRow[] = [];
  const orphanPlan: PlanRow[] = [];
  const read: ReadFile[] = [...data.read];
  for (const t of data.template) {
    const orphans: ReadFile["rows"] = [];
    for (const r of t.rows) {
      if (!r.deploymentId || existing.has(r.deploymentId)) { templateRows.push(r); continue; }
      const label = r.source ?? `Row ${r.row}`;
      if (r.blank) {
        orphanPlan.push({ sheetRow: r.row, source: r.source, deploymentId: r.deploymentId, label, action: "unchanged",
          detail: `Deployment ID ${r.deploymentId} no longer exists (it was removed after this timesheet was downloaded), and nothing was filled in.` });
        continue;
      }
      orphans.push({
        row: r.row, source: r.source?.split(" · ").pop() ?? `row ${r.row}`,
        deploymentId: r.deploymentId, staffNumber: r.staffId, staffName: r.staffName ?? null, date: r.eventDate,
        timeIn: r.actualIn, timeOut: r.actualOut, breakMinutes: r.breakMinutes, noShow: r.noShow, notes: r.notes,
        unclear: null, client: r.clientName ?? null, event: r.eventName ?? null,
      });
    }
    if (orphans.length) read.push({ name: t.file, documentDate: null, clientName: null, location: null, rows: orphans });
  }

  const matched = read.length
    ? await matchExtractedRows(read, data.nextRow, options)
    : { sheetRows: [] as SheetRow[], newShifts: [] as NewShift[], errors: [] as MatchError[], info: [] as FileInfo[] };

  // Updates to scheduled shifts.
  const rows = [...templateRows, ...matched.sheetRows];
  const ids = [...new Set(rows.map((r) => r.deploymentId).filter((n): n is number => !!n))];
  const deployments = ids.length ? await prisma.deployment.findMany({ where: { id: { in: ids } }, select: PLAN_SELECT }) : [];
  const { plan, targets } = planTimesheetRows(rows, deployments, a);

  // New shifts.
  const { plan: createPlan, creates, eventBySheet } = await planNewShifts(matched.newShifts, options);

  const all = [
    ...plan,
    ...orphanPlan,
    ...createPlan,
    ...matched.errors.map((e): PlanRow => ({ sheetRow: e.row, source: e.source, deploymentId: null, label: e.source, action: "error", detail: e.detail })),
  ].sort((x, y) => x.sheetRow - y.sheetRow);

  const sheets: SheetSummary[] = matched.info.map((i) => {
    const mine = matched.newShifts.filter((s) => s.file === i.name);
    return {
      ...i,
      event: eventBySheet.get(i.name) ?? null,
      newShifts: mine.length,
      needsClient: mine.some((s) => !clean(s.client)),
    };
  });

  return {
    plan: all,
    counts: {
      update: all.filter((p) => p.action === "update").length,
      create: all.filter((p) => p.action === "create").length,
      unchanged: all.filter((p) => p.action === "unchanged").length,
      error: all.filter((p) => p.action === "error").length,
    },
    updates: targets,
    creates,
    sheets,
    totalMinutes: all.reduce((s, p) => s + (p.action === "update" || p.action === "create" ? (p.minutes ?? 0) : 0), 0),
  };
}

async function planNewShifts(
  lines: NewShift[],
  options: Record<string, SheetOptions>,
): Promise<{ plan: PlanRow[]; creates: CreateTarget[]; eventBySheet: Map<string, string> }> {
  const plan: PlanRow[] = [];
  const creates: CreateTarget[] = [];
  const eventBySheet = new Map<string, string>();
  if (!lines.length) return { plan, creates, eventBySheet };

  // Default event for a client: its only active event if it has exactly one, else the
  // outlet written on the sheet, else the client's own name.
  const clientNames = [...new Set(lines.map((l) => clean(l.client)).filter((c): c is string => !!c))];
  const clients = clientNames.length
    ? await prisma.client.findMany({ where: { name: { in: clientNames } }, select: { name: true, projects: { where: { active: true }, select: { name: true } } } })
    : [];
  const onlyEvent = new Map(clients.filter((c) => c.projects.length === 1).map((c) => [c.name, c.projects[0].name]));

  const ranges = lines.map((l) => (l.actualIn && l.actualOut ? buildShiftRange(l.date, l.actualIn, l.actualOut) : null));
  const booked = await prisma.deployment.findMany({
    where: {
      staffId: { in: [...new Set(lines.map((l) => l.staffId))] },
      status: { not: "CANCELLED" },
      eventDate: { in: [...new Set(lines.map((l) => l.date))].map((d) => new Date(`${d}T00:00:00.000Z`)) },
    },
    select: { staffId: true, startAt: true, endAt: true, project: { select: { name: true, client: { select: { name: true } } } } },
  });
  const inUpload: { staffId: number; startAt: Date; endAt: Date }[] = [];

  for (const [i, l] of lines.entries()) {
    const client = clean(options[l.file]?.client ?? l.client);
    const event = clean(options[l.file]?.event ?? l.event) ?? (client ? onlyEvent.get(client) ?? clean(l.location) ?? client : null);
    if (event) eventBySheet.set(l.file, event);
    const label = `${formatDateUTC(new Date(`${l.date}T00:00:00.000Z`))} · ${titleCaseLabel(client ?? "no client")} · ${titleCaseName(l.staffName)}`;
    const push = (action: PlanRow["action"], detail: string, minutes?: number) =>
      plan.push({ sheetRow: l.row, source: l.source, deploymentId: null, label, action, minutes,
        detail: l.matchNote && action !== "error" ? `${detail}  (${l.matchNote})` : detail });

    if (l.noShow) { push("unchanged", "Marked absent, and no shift was scheduled — nothing to record."); continue; }
    const range = ranges[i];
    if (!range) {
      push(l.actualIn || l.actualOut ? "error" : "unchanged", l.actualIn || l.actualOut ? "Needs both a time in and a time out." : "No times given.");
      continue;
    }
    if (!client) { push("error", "No shift was scheduled and the sheet has no client name — enter the client below, then check again."); continue; }
    if (l.breakMinutes !== null && (l.breakMinutes < 0 || l.breakMinutes > 600)) { push("error", "Break must be between 0 and 600 minutes."); continue; }

    const clash = booked.find((b) => b.staffId === l.staffId && b.startAt < range.endAt && b.endAt > range.startAt);
    if (clash) {
      push("error", `${titleCaseName(l.staffName)} already has a shift at that time (${titleCaseLabel(clash.project.client.name)} · ${titleCaseLabel(clash.project.name)}), but it did not match this line — check the name or add the Staff ID.`);
      continue;
    }
    if (inUpload.some((u) => u.staffId === l.staffId && u.startAt < range.endAt && u.endAt > range.startAt)) {
      push("error", "This person already appears earlier in this upload for an overlapping time — it is only recorded once.");
      continue;
    }
    inUpload.push({ staffId: l.staffId, ...range });

    const actuals = { actualIn: range.startAt, actualOut: range.endAt, actualBreakMinutes: l.breakMinutes ?? 0, noShow: false };
    const minutes = workedMinutes(actuals);
    push("create", `No shift was scheduled — creates one under ${titleCaseLabel(client)} · ${titleCaseLabel(event!)}: ${describeActuals(actuals)}`, minutes);
    creates.push({
      row: l.row, label, staffId: l.staffId, category: l.category, client, event: event!, location: clean(l.location),
      timesheetNo: l.timesheetNo,
      eventDate: new Date(`${l.date}T00:00:00.000Z`), startAt: range.startAt, endAt: range.endAt,
      breakMinutes: l.breakMinutes ?? 0, notes: l.notes,
    });
  }
  return { plan, creates, eventBySheet };
}

/**
 * Create the shifts that were not scheduled, already carrying their timesheet. Each in
 * its own transaction, like applyTimesheetTargets: one clash must not undo the rest.
 */
export async function applyNewShifts(creates: CreateTarget[], userId: number): Promise<{ written: number; failed: string[] }> {
  let written = 0;
  const failed: string[] = [];
  const projectIds = new Map<string, number>();

  for (const c of creates) {
    try {
      const key = `${c.client}|${c.event}`;
      if (!projectIds.has(key)) {
        const client = await prisma.client.upsert({ where: { name: c.client }, update: {}, create: { name: c.client }, select: { id: true } });
        const project = await prisma.project.upsert({
          where: { clientId_name: { clientId: client.id, name: c.event } },
          update: {},
          create: { clientId: client.id, name: c.event, location: c.location },
          select: { id: true },
        });
        projectIds.set(key, project.id);
      }
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const d = await tx.deployment.create({
          data: {
            projectId: projectIds.get(key)!,
            staffId: c.staffId,
            eventDate: c.eventDate,
            timesheetNo: c.timesheetNo,
            location: c.location,
            category: c.category,
            startAt: c.startAt,
            endAt: c.endAt,
            breakMinutes: c.breakMinutes,
            actualIn: c.startAt,
            actualOut: c.endAt,
            actualBreakMinutes: c.breakMinutes,
            notes: c.notes,
            status: "TIMESHEET_SUBMITTED",
            submittedAt: new Date(),
            createdById: userId,
            updatedById: userId,
          },
          select: { id: true },
        });
        await tx.deploymentAudit.create({ data: { deploymentId: d.id, userId, action: "created-from-timesheet" } });
        await tx.deploymentAudit.create({
          data: { deploymentId: d.id, userId, action: "timesheet-upload", field: "actuals",
            newValue: `${describeActuals({ actualIn: c.startAt, actualOut: c.endAt, actualBreakMinutes: c.breakMinutes, noShow: false })}` },
        });
      });
      written++;
    } catch (e) {
      console.error("[timesheet:create]", c.staffId, e);
      failed.push(`${c.label} (${formatHM(Math.round((c.endAt.getTime() - c.startAt.getTime()) / 60000))})`);
    }
  }
  return { written, failed };
}
