import Link from "next/link";
import { UserPlus } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { computeDocStatuses } from "@/lib/doc-status";
import { formatDateUTC, titleCaseName, titleCaseLabel } from "@/lib/format";
import { can } from "@/lib/rbac";
import {
  parseStaffParams, buildStaffWhere, buildStaffOrderBy, staffQueryString, effectiveStatus,
} from "@/lib/staff-query";
import { ExportMenu } from "@/components/export-menu";
import { StaffFilters } from "./_components/staff-filters";
import { StaffPagination } from "./_components/staff-pagination";
import { StaffTable, type StaffTableRow } from "./_components/staff-table";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const role = session!.user.role;
  const p = parseStaffParams(await searchParams);
  const { expiryWindowDays } = await getSettings();
  const now = new Date();

  const where = buildStaffWhere(p, expiryWindowDays, now);
  // Data-Entry only sees their own entries (spec §9).
  if (!can(role, "staff:viewAll")) {
    const own = { createdById: Number(session!.user.id) };
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), own]
      : [own];
  }

  const [total, staff, categories, locations] = await Promise.all([
    prisma.staff.count({ where }),
    prisma.staff.findMany({
      where,
      orderBy: buildStaffOrderBy(p.sort, p.dir),
      skip: (p.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.categoryOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // File presence for the current page's rows (so "no file -> Missing" per §6).
  const staffIds = staff.map((s) => s.id);
  const docRows = staffIds.length
    ? await prisma.staffDocument.findMany({
        where: { staffId: { in: staffIds }, isCurrent: true },
        select: { staffId: true, type: true },
      })
    : [];
  const presence = new Map<number, Set<string>>();
  for (const d of docRows) {
    (presence.get(d.staffId) ?? presence.set(d.staffId, new Set()).get(d.staffId)!).add(d.type);
  }
  const filesFor = (id: number) => {
    const set = presence.get(id) ?? new Set<string>();
    return {
      eid: set.has("EID_FRONT") || set.has("EID_BACK"),
      ohc: set.has("OHC"),
      bfhc: set.has("BFHC"),
      passport: set.has("PASSPORT"),
    };
  };
  // Pre-format here so the interactive table stays a plain data component.
  const rows: StaffTableRow[] = staff.map((s) => {
    const d = computeDocStatuses(s, expiryWindowDays, now, filesFor(s.id));
    return {
      id: s.id,
      fullName: titleCaseName(s.fullName),
      blacklisted: s.blacklisted,
      category: titleCaseLabel(s.category),
      mobile: s.mobileNumber ?? "",
      eidNumber: s.eidNumber,
      location: titleCaseLabel(s.location),
      // Active only while all four documents are on file and in date — unless an
      // admin has set the status by hand on the profile.
      employmentStatus: effectiveStatus(s, d).status,
      dates: [
        { label: "eid", text: formatDateUTC(s.eidExpiry), status: d.eid },
        { label: "ohc", text: formatDateUTC(s.ohcExpiry), status: d.ohc },
        { label: "bfhc", text: formatDateUTC(s.bfhcExpiry), status: d.bfhc },
        { label: "passport", text: formatDateUTC(s.passportExpiry), status: d.passport },
      ],
      worst: d.worst,
      summary: d.summary,
    };
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} record{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {can(role, "staff:create") ? (
            <Link
              href="/staff/new"
              className="inline-flex items-center gap-2 rounded-md bg-brand-gold px-3 py-2 text-sm font-medium text-brand-navy-deep hover:bg-brand-gold/90"
            >
              <UserPlus className="h-4 w-4" /> New Profile
            </Link>
          ) : null}
          {can(role, "staff:viewAll") ? (
            <ExportMenu query={staffQueryString({ ...p, page: 1 })} />
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <StaffFilters
          categories={categories.map((c) => c.value)}
          locations={locations.map((l) => l.value)}
        />
      </div>

      <div className="mt-4">
        <StaffTable rows={rows} canDelete={can(role, "staff:delete")} />
      </div>

      <div className="mt-4">
        <StaffPagination page={p.page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
}
