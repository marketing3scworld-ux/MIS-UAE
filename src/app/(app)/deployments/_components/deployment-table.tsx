"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, ShieldCheck, Truck, XCircle } from "lucide-react";
import type { DeploymentStatus } from "@prisma/client";
import { STATUS_LABEL, STATUS_TONE, formatHM } from "@/lib/deployment";
import { cn } from "@/lib/utils";
import { approveDeployments, cancelDeployments, markDeployed, verifyTimesheets } from "../actions";

export type DeploymentTableRow = {
  id: number;
  date: string;
  client: string;
  project: string;
  location: string;
  staffId: number;
  staffName: string;
  category: string;
  shift: string;
  duty: string;
  scheduled: string; // "09:00 – 18:00"
  scheduledMinutes: number;
  actual: string;
  actualMinutes: number;
  overtimeMinutes: number;
  varianceMinutes: number;
  status: DeploymentStatus;
  flags: string[]; // Late / Early / Absent / Replaced
  replacedBy: string | null;
};

const COLS = [
  "Date", "Client / Event", "Location", "Staff", "Category",
  "Shift", "Scheduled", "Actual", "OT", "Variance", "Status", "Flags",
];

/**
 * The operational worklist. Selection drives the approval chain in bulk, because a
 * supervisor signing off an event verifies fifty rows at once, not one at a time.
 * Each button is shown only to a role that may use it — the server re-checks anyway.
 */
export function DeploymentTable({
  rows,
  can,
}: {
  rows: DeploymentTableRow[];
  can: { deploy: boolean; verify: boolean; approve: boolean; cancel: boolean };
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = selected.size > 0 && !allSelected;

  const toggle = (id: number) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const run = (fn: (ids: number[]) => Promise<{ ok?: string; error?: string }>, confirmText?: string) => {
    const picked = [...selected];
    if (!picked.length) return;
    if (confirmText && !confirm(`${confirmText}\n\n${picked.length} deployment(s).`)) return;
    setMsg({});
    start(async () => {
      const res = await fn(picked);
      setMsg(res);
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  };

  const btn = "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50";
  const anyAction = can.deploy || can.verify || can.approve || can.cancel;

  return (
    <>
      {anyAction ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{selected.size} selected</span>
          {can.deploy ? (
            <button type="button" disabled={!selected.size || pending} onClick={() => run(markDeployed)} className={btn}>
              <Truck className="h-3.5 w-3.5" /> Mark deployed
            </button>
          ) : null}
          {can.verify ? (
            <button type="button" disabled={!selected.size || pending} onClick={() => run(verifyTimesheets)} className={btn}>
              <ShieldCheck className="h-3.5 w-3.5" /> Verify timesheet
            </button>
          ) : null}
          {can.approve ? (
            <button
              type="button"
              disabled={!selected.size || pending}
              onClick={() => run(approveDeployments, "Approve these hours? They become the basis for payroll and client invoicing.")}
              className="inline-flex items-center gap-1.5 rounded border border-status-valid/40 px-3 py-1.5 text-xs font-medium text-status-valid hover:bg-status-valid/10 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </button>
          ) : null}
          {can.cancel ? (
            <button
              type="button"
              disabled={!selected.size || pending}
              onClick={() => run(cancelDeployments, "Cancel these deployments? They drop out of every report.")}
              className="inline-flex items-center gap-1.5 rounded border border-status-expired/40 px-3 py-1.5 text-xs font-medium text-status-expired hover:bg-status-expired/10 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : null}
          {selected.size ? (
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          ) : null}
          {msg.ok ? <span className="text-xs font-medium text-status-valid">{msg.ok}</span> : null}
          {msg.error ? <span className="text-xs font-medium text-status-expired">{msg.error}</span> : null}
        </div>
      ) : null}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="table-head">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              {anyAction ? (
                <th className="w-9 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="h-4 w-4 align-middle"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = some; }}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                    disabled={!ids.length}
                  />
                </th>
              ) : null}
              {COLS.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + (anyAction ? 1 : 0)} className="p-10 text-center text-sm text-muted-foreground">
                  No deployments match these filters.
                </td>
              </tr>
            ) : rows.map((r) => {
              const checked = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/deployments/${r.id}`)}
                  className={cn("cursor-pointer border-t border-border hover:bg-slate-50", checked && "bg-brand-gold/10 hover:bg-brand-gold/15")}
                >
                  {anyAction ? (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select deployment ${r.id}`} className="h-4 w-4 align-middle" checked={checked} onChange={() => toggle(r.id)} />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-medium text-foreground">{r.client}</div>
                    <div className="text-xs text-muted-foreground">{r.project}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.location || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/staff/${r.staffId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-navy hover:underline">
                      {r.staffName}
                    </Link>
                    <div className="text-xs text-muted-foreground">#{r.staffId}</div>
                    {r.replacedBy ? <div className="text-xs text-status-expiring">covered by {r.replacedBy}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.category || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.shift || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.scheduled}
                    <div className="text-xs text-muted-foreground">{formatHM(r.scheduledMinutes)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.actual}
                    <div className="text-xs text-muted-foreground">{formatHM(r.actualMinutes)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.overtimeMinutes > 0 ? <span className="font-medium text-status-expiring">{formatHM(r.overtimeMinutes)}</span> : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.varianceMinutes === 0 ? <span className="text-muted-foreground">—</span>
                      : <span className={r.varianceMinutes < 0 ? "font-medium text-status-expired" : "font-medium text-status-valid"}>
                          {r.varianceMinutes > 0 ? "+" : ""}{formatHM(r.varianceMinutes)}
                        </span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn("text-xs font-semibold", STATUS_TONE[r.status])}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span key={f} className={cn(
                          "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          f === "Absent" ? "bg-status-expired/10 text-status-expired"
                            : f === "Replaced" ? "bg-[#7c3aed]/10 text-[#7c3aed]"
                              : "bg-status-expiring/10 text-status-expiring",
                        )}>{f}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
