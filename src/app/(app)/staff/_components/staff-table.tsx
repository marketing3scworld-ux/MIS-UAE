"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { ComputedStatus } from "@/lib/doc-status";
import { cn } from "@/lib/utils";
import { bulkDeleteStaff } from "../actions";

// One list row, pre-formatted on the server so this stays a plain data component.
export type StaffTableRow = {
  id: number;
  fullName: string;
  blacklisted: boolean;
  category: string;
  mobile: string;
  eidNumber: string | null;
  location: string;
  employmentStatus: "ACTIVE" | "INACTIVE";
  dates: { label: string; text: string; status: ComputedStatus }[];
  worst: ComputedStatus;
  summary: string;
};

const COLUMNS = [
  "No.", "Full Name", "Category", "Mobile", "EID Number",
  "EID Exp", "OHC Exp", "BFHC Exp", "Passport Exp", "Location", "Status", "Documents",
];

const DATE_TONE: Record<ComputedStatus, string> = {
  EXPIRED: "text-status-expired font-medium",
  EXPIRING_SOON: "text-status-expiring font-medium",
  MISSING: "text-muted-foreground",
  VALID: "text-foreground",
};

export function StaffTable({ rows, canDelete }: { rows: StaffTableRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Select-all covers THIS page of results only, which is what's visible — say so
  // in the bulk bar rather than implying the whole filtered set is selected.
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));

  const remove = () => {
    const picked = [...selected];
    if (!picked.length) return;
    const names = rows.filter((r) => picked.includes(r.id)).map((r) => `#${r.id} ${r.fullName}`);
    const preview = names.slice(0, 12).join("\n") + (names.length > 12 ? `\n…and ${names.length - 12} more` : "");
    if (!confirm(
      `Permanently delete ${picked.length} staff profile${picked.length === 1 ? "" : "s"}?\n\n${preview}\n\n` +
      `This also removes their uploaded documents and files. It cannot be undone.`,
    )) return;

    setMessage({});
    startTransition(async () => {
      const res = await bulkDeleteStaff(picked);
      setMessage(res);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const colCount = COLUMNS.length + (canDelete ? 1 : 0);

  return (
    <>
      {canDelete ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {selected.size} selected{selected.size ? " on this page" : ""}
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={!selected.size || pending}
            className="inline-flex items-center gap-1.5 rounded border border-status-expired/40 px-3 py-1.5 text-xs font-medium text-status-expired hover:bg-status-expired/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> {pending ? "Deleting…" : "Delete selected"}
          </button>
          {selected.size ? (
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
              Clear selection
            </button>
          ) : null}
          {message.ok ? <span className="text-xs font-medium text-status-valid">{message.ok}</span> : null}
          {message.error ? <span className="text-xs font-medium text-status-expired">{message.error}</span> : null}
        </div>
      ) : null}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="table-head">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              {canDelete ? (
                <th className="w-9 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 align-middle"
                    aria-label="Select all staff on this page"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    disabled={!ids.length}
                  />
                </th>
              ) : null}
              {COLUMNS.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-10 text-center text-sm text-muted-foreground">
                  No staff match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const checked = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/staff/${r.id}`)}
                    className={cn(
                      "cursor-pointer border-t border-border hover:bg-slate-50",
                      checked && "bg-brand-gold/10 hover:bg-brand-gold/15",
                    )}
                  >
                    {canDelete ? (
                      // Stop the click here or ticking a box would navigate to the profile.
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 align-middle"
                          aria-label={`Select ${r.fullName}`}
                          checked={checked}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <Link href={`/staff/${r.id}`} className="font-medium text-brand-navy hover:underline">{r.id}</Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/staff/${r.id}`} className="font-medium text-foreground hover:text-brand-navy hover:underline">
                        {r.fullName}
                      </Link>
                      {r.blacklisted ? (
                        <span className="ms-2 whitespace-nowrap rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Blacklisted</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{r.category || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.mobile || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                      {r.eidNumber ?? <span className="font-sans text-status-missing">No EID</span>}
                    </td>
                    {r.dates.map((d) => (
                      <td key={d.label} className={cn("whitespace-nowrap px-3 py-2", DATE_TONE[d.status])}>{d.text}</td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2">{r.location || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.employmentStatus === "ACTIVE"
                        ? <span className="font-medium text-status-valid">Active</span>
                        : <span className="text-muted-foreground">Inactive</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={r.worst} />
                        <span className="whitespace-nowrap text-muted-foreground">{r.summary}</span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
