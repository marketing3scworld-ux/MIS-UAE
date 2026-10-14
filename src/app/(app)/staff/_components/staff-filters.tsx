"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { titleCaseLabel } from "@/lib/format";

export function StaffFilters({
  categories,
  locations,
}: {
  categories: string[];
  locations: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlQ = sp.get("q") ?? "";
  const [q, setQ] = useState(urlQ);

  const update = useCallback(
    (patch: Record<string, string>) => {
      const usp = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) usp.set(k, v);
        else usp.delete(k);
      }
      usp.delete("page"); // any filter change returns to page 1
      const qs = usp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [sp, pathname, router],
  );

  // Reflect a q set elsewhere (e.g. the top-bar search) back into the box, so the
  // debounce below doesn't revert it. Adjusted during render rather than in an
  // effect, per https://react.dev/learn/you-might-not-need-an-effect.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQ(urlQ);
  }

  // Debounced search.
  useEffect(() => {
    if (urlQ === q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
  }, [q, urlQ, update]);

  const sel = "rounded-md border border-input bg-white px-2 py-2 text-sm outline-none focus:border-brand-gold";
  const hasFilters = sp.toString().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, EID, mobile, category…"
          className="w-full rounded-md border border-input bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-gold"
        />
      </div>

      <select value={sp.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })} className={sel}>
        <option value="">All status</option>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </select>

      <select value={sp.get("approval") ?? ""} onChange={(e) => update({ approval: e.target.value })} className={sel}>
        <option value="">All approvals</option>
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
      </select>

      <select value={sp.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })} className={sel}>
        <option value="">All categories</option>
        {categories.map((c) => <option key={c} value={c}>{titleCaseLabel(c)}</option>)}
      </select>

      <select value={sp.get("location") ?? ""} onChange={(e) => update({ location: e.target.value })} className={sel}>
        <option value="">All locations</option>
        {locations.map((l) => <option key={l} value={l}>{titleCaseLabel(l)}</option>)}
      </select>

      <select value={sp.get("flag") ?? ""} onChange={(e) => update({ flag: e.target.value })} className={sel}>
        <option value="">All documents</option>
        <option value="expired">Has expired</option>
        <option value="expiring">Expiring soon</option>
        <option value="missing">Has missing</option>
        <option value="noexpired">No expired documents</option>
        <option value="noeid">No EID on file</option>
        <option value="blacklisted">Blacklisted</option>
      </select>

      {hasFilters ? (
        <button
          onClick={() => { setQ(""); router.push(pathname); }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
