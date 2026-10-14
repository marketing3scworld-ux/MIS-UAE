"use client";

import { useState } from "react";
import { CircleCheck, CircleSlash, RotateCcw } from "lucide-react";
import { setStaffStatus } from "./actions";

// Activate / Deactivate, next to the blacklist control.
//
// Active/Inactive normally follows the documents: any expired or missing document
// makes someone Inactive. An admin can overrule that for one person — kept active
// through an OHC renewal, or stood down while the papers are still valid — and hand
// control back to the documents afterwards.
export function StatusControl({
  staffId,
  status,
  overridden,
  note,
  derived,
  canManage,
}: {
  staffId: number;
  status: "ACTIVE" | "INACTIVE";
  overridden: boolean;
  note: string | null;
  derived: "ACTIVE" | "INACTIVE"; // what the documents say on their own
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = status === "ACTIVE";

  const badge = (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
      active ? "border-status-valid/40 text-status-valid" : "border-border text-muted-foreground"
    }`}>
      {active ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleSlash className="h-3.5 w-3.5" />}
      {active ? "Active" : "Inactive"}
      {overridden ? <span className="font-normal text-muted-foreground">· set by admin</span> : null}
    </span>
  );

  if (!canManage) return badge;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <form action={setStaffStatus.bind(null, staffId)} className="flex items-center gap-2">
          <input type="hidden" name="status" value={active ? "INACTIVE" : "ACTIVE"} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            {active ? <CircleSlash className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
            {active ? "Deactivate" : "Activate"}
          </button>
        </form>
        {overridden ? (
          <form action={setStaffStatus.bind(null, staffId)}>
            <input type="hidden" name="status" value="AUTO" />
            <button
              type="submit"
              title={`Follow the documents again — they currently say ${derived === "ACTIVE" ? "Active" : "Inactive"}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Follow documents
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {open ? "Cancel" : "with a reason…"}
          </button>
        )}
      </div>

      {note ? <p className="text-[11px] text-muted-foreground">Reason: {note}</p> : null}

      {open && !overridden ? (
        <form action={setStaffStatus.bind(null, staffId)} className="flex items-center gap-2">
          <input type="hidden" name="status" value={active ? "INACTIVE" : "ACTIVE"} />
          <input
            name="note"
            placeholder={active ? "Reason for deactivating…" : "Reason for activating…"}
            className="w-56 rounded-md border border-input bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-gold"
          />
          <button type="submit" className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy/90">
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}
