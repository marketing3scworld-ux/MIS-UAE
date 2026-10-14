"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { X } from "lucide-react";
import { STATUS_LABEL, DEPLOYMENT_FLOW } from "@/lib/deployment";
import { titleCaseLabel } from "@/lib/format";

export type FilterOptions = {
  clients: { id: number; name: string }[];
  projects: { id: number; name: string; clientId: number }[];
  categories: string[];
  locations: string[];
};

// One toolbar shared by the deployment list and all four reports, so "filterable by
// date range, client, project/event, location, staff and category" behaves
// identically everywhere. Every change is a navigation, which keeps the filter
// state in the URL and therefore shareable and exportable.
export function DeploymentFilters({
  options,
  showStatus = true,
}: {
  options: FilterOptions;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const update = useCallback(
    (patch: Record<string, string>) => {
      const usp = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) usp.set(k, v);
        else usp.delete(k);
      }
      // Changing the client invalidates a project chosen under the previous one.
      if ("clientId" in patch) usp.delete("projectId");
      const qs = usp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [sp, pathname, router],
  );

  const clientId = sp.get("clientId") ?? "";
  const projects = clientId
    ? options.projects.filter((p) => String(p.clientId) === clientId)
    : options.projects;

  const fld = "rounded-md border border-input bg-white px-2 py-2 text-sm outline-none focus:border-brand-gold";
  const hasAny = [...sp.keys()].some((k) => k !== "page");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">From</span>
        <input type="date" value={sp.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} className={fld} />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">To</span>
        <input type="date" value={sp.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} className={fld} />
      </label>

      <select value={clientId} onChange={(e) => update({ clientId: e.target.value })} className={fld} aria-label="Client">
        <option value="">All clients</option>
        {options.clients.map((c) => <option key={c.id} value={c.id}>{titleCaseLabel(c.name)}</option>)}
      </select>

      <select value={sp.get("projectId") ?? ""} onChange={(e) => update({ projectId: e.target.value })} className={fld} aria-label="Event">
        <option value="">All events</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{titleCaseLabel(p.name)}</option>)}
      </select>

      <select value={sp.get("location") ?? ""} onChange={(e) => update({ location: e.target.value })} className={fld} aria-label="Location">
        <option value="">All locations</option>
        {options.locations.map((l) => <option key={l} value={l}>{titleCaseLabel(l)}</option>)}
      </select>

      <select value={sp.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })} className={fld} aria-label="Staff category">
        <option value="">All categories</option>
        {options.categories.map((c) => <option key={c} value={c}>{titleCaseLabel(c)}</option>)}
      </select>

      {showStatus ? (
        <select value={sp.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })} className={fld} aria-label="Status">
          <option value="">All statuses</option>
          {DEPLOYMENT_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="CANCELLED">{STATUS_LABEL.CANCELLED}</option>
        </select>
      ) : null}

      <input
        defaultValue={sp.get("q") ?? ""}
        onKeyDown={(e) => { if (e.key === "Enter") update({ q: (e.target as HTMLInputElement).value }); }}
        placeholder="Search staff, client, staff category…"
        className={`${fld} min-w-[200px]`}
        aria-label="Search"
      />

      {hasAny ? (
        <button onClick={() => router.push(pathname)} className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
