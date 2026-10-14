import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEnterTimesheet, formatTimeUTC } from "@/lib/deployment";
import { parseDeploymentParams, loadDeployments } from "@/lib/deployment-query";
import { xlsxResponse, type ExportCol, type ExportRow } from "@/lib/report-export";
import { TS_HEADERS } from "@/lib/timesheet-sheet";
import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";

// Blank timesheet for the current filter selection: one row per scheduled shift, with
// the last five columns left empty for the venue to fill in. Handing out a file that
// already carries the deployment id is what lets the upload match rows exactly instead
// of guessing from names.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  if (!me || !canEnterTimesheet({ role: me.role, isOperationsHead: me.isOperationsHead })) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const p = parseDeploymentParams(sp);
  const all = await loadDeployments(p);
  // Cancelled shifts never need hours against them.
  const rows = all.filter((r) => r.status !== "CANCELLED");

  const cols: ExportCol[] = [
    { key: "id", header: TS_HEADERS.id, width: 13 },
    { key: "date", header: TS_HEADERS.date, width: 13 },
    { key: "client", header: TS_HEADERS.client, width: 24 },
    { key: "event", header: TS_HEADERS.event, width: 22 },
    { key: "location", header: TS_HEADERS.location, width: 18 },
    { key: "staffId", header: TS_HEADERS.staffId, width: 9 },
    { key: "staff", header: TS_HEADERS.staff, width: 28 },
    { key: "category", header: TS_HEADERS.category, width: 16 },
    { key: "scheduled", header: TS_HEADERS.scheduled, width: 18 },
    { key: "actualIn", header: TS_HEADERS.actualIn, width: 12 },
    { key: "actualOut", header: TS_HEADERS.actualOut, width: 12 },
    { key: "break", header: TS_HEADERS.break, width: 12 },
    { key: "noShow", header: TS_HEADERS.noShow, width: 10 },
    { key: "notes", header: TS_HEADERS.notes, width: 30 },
  ];

  const out: ExportRow[] = rows.map((r) => {
    const who = r.replacementStaff ?? r.staff;
    return {
      id: r.id,
      date: formatDateUTC(r.eventDate),
      client: titleCaseLabel(r.project.client.name),
      event: titleCaseLabel(r.project.name),
      location: titleCaseLabel(r.location ?? r.project.location ?? ""),
      staffId: who.id,
      staff: titleCaseName(who.fullName),
      category: titleCaseLabel(r.category ?? ""),
      scheduled: `${formatTimeUTC(r.startAt)} – ${formatTimeUTC(r.endAt)}`,
      // Anything already recorded comes back pre-filled, so re-issuing the sheet
      // mid-event doesn't ask the venue to type the same hours twice.
      actualIn: r.actualIn ? formatTimeUTC(r.actualIn) : "",
      actualOut: r.actualOut ? formatTimeUTC(r.actualOut) : "",
      break: r.actualBreakMinutes ?? "",
      noShow: r.noShow ? "YES" : "",
      notes: r.notes ?? "",
    };
  });

  return xlsxResponse({
    title: "Timesheet",
    subtitle:
      `${p.from} to ${p.to} · ${rows.length} shift${rows.length === 1 ? "" : "s"} · ` +
      `fill in ${TS_HEADERS.actualIn}, ${TS_HEADERS.actualOut}, ${TS_HEADERS.break}, ${TS_HEADERS.noShow}, ${TS_HEADERS.notes} — ` +
      `leave ${TS_HEADERS.id} untouched, it is how the upload finds the shift`,
    cols,
    rows: out,
    filename: `bme-timesheet-${p.from}_${p.to}`,
  });
}
