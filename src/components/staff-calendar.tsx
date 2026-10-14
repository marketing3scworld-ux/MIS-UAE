"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalEvent = {
  date: string; // YYYY-MM-DD (UTC)
  staffId: number;
  staffName: string;
  docType: string;
  status: "EXPIRED" | "EXPIRING_SOON" | "UPCOMING";
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const SEV: Record<string, number> = { EXPIRED: 3, EXPIRING_SOON: 2, UPCOMING: 1 };
const DOT: Record<string, string> = { EXPIRED: "bg-red-500", EXPIRING_SOON: "bg-amber-500", UPCOMING: "bg-[#2f6bd8]" };

// A month calendar that marks the days staff documents expire on, with a per-day
// agenda beside it. Replaces the summary hero.
export function StaffCalendar({
  events,
  initialMonth,
  todayKey,
}: {
  events: CalEvent[];
  initialMonth: string; // YYYY-MM
  todayKey: string; // YYYY-MM-DD
}) {
  const [month, setMonth] = useState(initialMonth);
  const [selected, setSelected] = useState(todayKey);

  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) {
    const a = byDate.get(e.date);
    if (a) a.push(e);
    else byDate.set(e.date, [e]);
  }

  const [y, m] = month.split("-").map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const shift = (delta: number) => {
    let ny = y;
    let nm = m + delta;
    if (nm < 1) { nm = 12; ny -= 1; } else if (nm > 12) { nm = 1; ny += 1; }
    setMonth(`${ny}-${pad(nm)}`);
  };

  const [sy, sm, sd] = selected.split("-").map(Number);
  const selWeekday = new Date(Date.UTC(sy, sm - 1, sd)).getUTCDay();
  const selEvents = (byDate.get(selected) ?? []).slice().sort((a, b) => SEV[b.status] - SEV[a.status]);

  return (
    <div className="mt-5 flex flex-col gap-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm md:flex-row">
      {/* Calendar */}
      <div className="md:w-[440px] md:flex-none">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Document calendar</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold text-slate-700">{MONTHS[m - 1]} {y}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold uppercase text-slate-400">
          {WEEKDAYS.map((w) => <div key={w} className="py-1.5">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const key = `${y}-${pad(m)}-${pad(d)}`;
            const evs = byDate.get(key);
            const isToday = key === todayKey;
            const isSel = key === selected;
            const worst = evs ? evs.reduce((w, e) => (SEV[e.status] > SEV[w] ? e.status : w), "UPCOMING") : null;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(key)}
                className="group flex aspect-square flex-col items-center justify-center gap-1"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-base font-medium transition-all",
                    isSel
                      ? "bg-[#2f6bd8] font-semibold text-white shadow-md shadow-blue-500/40"
                      : isToday
                        ? "bg-blue-50 font-semibold text-[#2f6bd8]"
                        : "text-slate-600 group-hover:bg-slate-100",
                  )}
                >
                  {d}
                </span>
                <span className={cn("h-1.5 w-1.5 rounded-full", evs ? DOT[worst!] : "bg-transparent")} />
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Expired</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Expiring</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2f6bd8]" /> Upcoming</span>
        </div>
      </div>

      {/* Agenda for the selected day */}
      <div className="flex-1 md:border-s md:border-slate-100 md:ps-6">
        <h3 className="text-base font-semibold text-slate-800">
          {WEEKDAYS_FULL[selWeekday]}, {sd} {MONTHS_SHORT[sm - 1]} {sy}
        </h3>
        <p className="mt-0.5 text-sm text-slate-400">
          {selEvents.length} document{selEvents.length === 1 ? "" : "s"} expiring
        </p>
        {selEvents.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-400">No documents expiring on this day.</p>
        ) : (
          <ul className="mt-3 max-h-72 space-y-0.5 overflow-y-auto pe-1">
            {selEvents.map((e, i) => (
              <li key={i}>
                <Link href={`/staff/${e.staffId}`} className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50">
                  <span className={cn("h-2.5 w-2.5 flex-none rounded-full", DOT[e.status])} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-700">{e.staffName}</span>
                  <span className="flex-none text-sm font-medium text-slate-400">{e.docType}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
