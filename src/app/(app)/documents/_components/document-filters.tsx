"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";

const STATUS = [
  { v: "", l: "All statuses" },
  { v: "expired", l: "Expired" },
  { v: "expiring", l: "Expiring" },
  { v: "missing", l: "Missing" },
];
const TYPE = [
  { v: "", l: "All documents" },
  { v: "eid", l: "EID" },
  { v: "ohc", l: "OHC" },
  { v: "bfhc", l: "BFHC" },
  { v: "passport", l: "Passport" },
];
// Documents report filters — status + document type as dropdowns (replacing the
// old capsule chips). Navigates on change; server component reads status/type.
export function DocumentFilters({ status, type }: { status: string; type: string }) {
  const router = useRouter();

  const go = (next: { status?: string; type?: string }) => {
    const s = next.status ?? status;
    const t = next.type ?? type;
    const u = new URLSearchParams();
    if (s) u.set("status", s);
    if (t) u.set("type", t);
    const qs = u.toString();
    router.push(qs ? `/documents?${qs}` : "/documents");
  };

  const sel = "rounded-md border border-input bg-white px-2.5 py-2 text-sm outline-none focus:border-brand-gold";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={status} onChange={(e) => go({ status: e.target.value })} className={sel} aria-label="Filter by status">
        {STATUS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>

      <select value={type} onChange={(e) => go({ type: e.target.value })} className={sel} aria-label="Filter by document type">
        {TYPE.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>

      {status || type ? (
        <button
          onClick={() => router.push("/documents")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
