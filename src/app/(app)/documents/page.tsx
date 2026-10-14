import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { can } from "@/lib/rbac";
import { buildExpiryReport } from "@/lib/expiry-report";
import { DOC_LABELS, type ComputedStatus, type DocKey } from "@/lib/doc-status";
import type { DocumentType } from "@prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { formatDateUTC, titleCaseName, titleCaseLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocumentFilters } from "./_components/document-filters";

export const dynamic = "force-dynamic";
const RENDER_CAP = 300;

const STATUS_OF: Record<string, ComputedStatus> = {
  expired: "EXPIRED", expiring: "EXPIRING_SOON", missing: "MISSING",
};

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const role = session!.user.role;
  if (!can(role, "staff:viewAll")) redirect("/dashboard");
  const canDownload = can(role, "docs:download");

  const sp = await searchParams;
  const g = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const statusKey = g("status");
  const typeKey = g("type");
  const wantStatus = STATUS_OF[statusKey] ?? null;
  const wantType = (["eid", "ohc", "bfhc", "passport"] as DocKey[]).includes(typeKey as DocKey)
    ? (typeKey as DocKey)
    : null;

  const { expiryWindowDays } = await getSettings();
  const report = await buildExpiryReport(expiryWindowDays);

  const filtered = report.problems.filter(
    (p) => (!wantStatus || p.status === wantStatus) && (!wantType || p.docKey === wantType),
  );
  const shown = filtered.slice(0, RENDER_CAP);

  // Resolve the uploaded file (if any) behind each row's doc so we can offer a
  // Download link site-wide. Maps `${staffId}:${docKey}` -> document id.
  const TYPE_TO_DOCKEY: Partial<Record<DocumentType, DocKey>> = {
    EID_FRONT: "eid", EID_BACK: "eid", OHC: "ohc", BFHC: "bfhc", PASSPORT: "passport",
  };
  const fileByKey = new Map<string, number>();
  if (canDownload && shown.length) {
    const staffIds = [...new Set(shown.map((p) => p.staffId))];
    const docRows = await prisma.staffDocument.findMany({
      where: { staffId: { in: staffIds }, isCurrent: true, type: { in: Object.keys(TYPE_TO_DOCKEY) as DocumentType[] } },
      select: { id: true, staffId: true, type: true },
    });
    for (const d of docRows) {
      const dk = TYPE_TO_DOCKEY[d.type];
      if (!dk) continue;
      const key = `${d.staffId}:${dk}`;
      // Prefer EID_FRONT over EID_BACK for the "eid" row.
      if (d.type === "EID_FRONT" || !fileByKey.has(key)) fileByKey.set(key, d.id);
    }
  }

  const qs = (over: { status?: string; type?: string }) => {
    const u = new URLSearchParams();
    const s = over.status ?? statusKey;
    const t = over.type ?? typeKey;
    if (s) u.set("status", s);
    if (t) u.set("type", t);
    return u.toString();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Document Expiry Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length.toLocaleString()} document{filtered.length === 1 ? "" : "s"} needing attention across active staff
            · {report.totals.EXPIRED} expired, {report.totals.EXPIRING_SOON} expiring, {report.totals.MISSING} missing
          </p>
        </div>
        <a
          href={`/documents/export?${qs({})}`}
          className="inline-flex flex-none items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90"
        >
          <Download className="h-4 w-4" /> Export Excel
        </a>
      </div>

      {/* Filters */}
      <div className="mt-4">
        <DocumentFilters status={statusKey} type={typeKey} />
      </div>

      <div className="mt-4 max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="table-head">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              {["Staff", "Category", "Location", "Document", "Status", "Expiry", "Days", "File"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                  No documents match this filter.
                </td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={`${p.staffId}-${p.docKey}`} className="border-t border-border hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/staff/${p.staffId}`} className="font-medium text-foreground hover:text-brand-navy hover:underline">
                      {titleCaseName(p.staffName)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{titleCaseLabel(p.category) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{titleCaseLabel(p.location) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{DOC_LABELS[p.docKey]}</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateUTC(p.expiry)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-xs",
                    p.status === "EXPIRED" ? "text-status-expired font-medium" : "text-muted-foreground")}>
                    {p.days === null
                      ? "—"
                      : p.days < 0
                        ? `${Math.abs(p.days)}d overdue`
                        : p.days === 0
                          ? "today"
                          : `in ${p.days}d`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {(() => {
                      const fileId = fileByKey.get(`${p.staffId}:${p.docKey}`);
                      return fileId ? (
                        <a
                          href={`/api/documents/${fileId}?dl=1`}
                          download
                          title="Download document"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      );
                    })()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > shown.length ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing the first {shown.length.toLocaleString()} of {filtered.length.toLocaleString()} — narrow the filter or use Export for the full list.
        </p>
      ) : null}
    </div>
  );
}
