"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

// Export dropdown for the staff list: Excel (.xlsx), CSV (.csv), or PDF (opens a
// print-ready page). `query` is the current filter query string (without a
// leading "?") so the export mirrors exactly what's on screen.
export function ExportMenu({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const base = `/staff/export?${query ? `${query}&` : ""}`;
  const items = [
    { label: "Excel (.xlsx)", href: `${base}format=xlsx`, icon: FileSpreadsheet, blank: false },
    { label: "CSV (.csv)", href: `${base}format=csv`, icon: FileText, blank: false },
    { label: "PDF (print)", href: `${base}format=pdf`, icon: Printer, blank: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90"
      >
        <Download className="h-4 w-4" /> Export
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute end-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map(({ label, href, icon: Icon, blank }) => (
            <a
              key={label}
              href={href}
              target={blank ? "_blank" : undefined}
              rel={blank ? "noopener" : undefined}
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Icon className="h-4 w-4 text-slate-400" /> {label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
