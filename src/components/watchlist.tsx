"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type WatchRow = { staffId: number; staffName: string; count: number };

// "Needs attention" card: staff ranked by their expired / expiring documents,
// with a tab toggle (reference: the Watchlist card).
export function Watchlist({ expired, expiring }: { expired: WatchRow[]; expiring: WatchRow[] }) {
  const [tab, setTab] = useState<"expired" | "expiring">("expired");
  const rows = tab === "expired" ? expired : expiring;
  const countColor = tab === "expired" ? "text-red-600" : "text-amber-600";

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Needs attention</h2>
        <Link href="/documents" className="text-xs font-semibold text-[#2f6bd8] hover:underline">
          View report →
        </Link>
      </div>

      <div className="mt-3 inline-flex rounded-full bg-slate-100 p-0.5 text-xs font-medium">
        {(["expired", "expiring"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded-full px-3 py-1 capitalize transition-colors",
              tab === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {k}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">No {tab} documents. 🎉</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {rows.map((r, i) => (
            <li key={r.staffId}>
              <Link
                href={`/staff/${r.staffId}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{r.staffName}</span>
                <span className={cn("flex-none text-xs font-semibold", countColor)}>
                  {r.count} doc{r.count === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
