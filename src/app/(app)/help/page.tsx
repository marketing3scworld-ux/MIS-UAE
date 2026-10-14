import Link from "next/link";
import { Building2, CalendarPlus, CheckCircle2, ClipboardCheck, ShieldCheck, Upload, type LucideIcon } from "lucide-react";
import { STATUS_LABEL } from "@/lib/deployment";
import { STAGES, STAGE_HELP } from "@/lib/workflow";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// One page that answers "what is this module and what am I supposed to do next".
// Deliberately plain: the same five stages, the same words, the same order as the
// strip that sits on top of Deployments, Timesheets and Reports.

type Step = {
  n: number;
  title: string;
  icon: LucideIcon;
  who: string;
  where: string;
  href?: string;
  points: string[];
  note?: string;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Add the client and the event",
    icon: Building2,
    who: "Operations · HR/Admin · System Admin",
    where: "Deployments → Clients & events",
    href: "/deployments/clients",
    points: [
      "Staff are scheduled onto an event, never onto a client directly, so one client can run several venues at once.",
      "Disabling an event hides it from the scheduling list; shifts already recorded against it stay exactly as they are.",
    ],
  },
  {
    n: 2,
    title: "Schedule the staff",
    icon: CalendarPlus,
    who: "Operations · HR/Admin · System Admin",
    where: "Deployments → Schedule staff",
    href: "/deployments/new",
    points: [
      "Pick the event, date and times. A shift that ends before it starts runs past midnight and is counted into the next day.",
      "Document status shows next to each name. Expired documents are flagged but never block scheduling.",
      "Anyone already booked on an overlapping shift is listed and skipped, so nobody is double-booked.",
    ],
    note: "Scheduling first is what makes overtime, lateness and early departures measurable — they are all differences against the planned shift.",
  },
  {
    n: 3,
    title: "Get the hours in",
    icon: Upload,
    who: "Operations · HR/Admin · System Admin",
    where: "Deployments → Timesheets",
    href: "/deployments/timesheets",
    points: [
      "Send the venue our blank timesheet, or upload whatever they send back — Excel, CSV, PDF or a photo of the signed sheet.",
      "Check first: the upload shows every line, the hours it would record, and anything it could not match. Nothing is saved until you press Record.",
      "If a sheet's date, client or event was misread, correct it under Sheet details and check again — the file is not read twice.",
      "No shift scheduled? One is created from the timesheet, but only when the name or Staff ID matches exactly one staff profile.",
      "A single shift can also be typed straight into its own page from the Deployments list.",
    ],
  },
  {
    n: 4,
    title: "Verify the hours",
    icon: ShieldCheck,
    who: "Ops Head · HR/Admin · System Admin",
    where: "Deployments → tick the rows → Verify timesheet",
    href: "/deployments?status=TIMESHEET_SUBMITTED",
    points: [
      "Filter to Timesheet submitted to see everything waiting.",
      "Verifying says: these are the hours actually worked, checked against the signed sheet.",
      "If something is wrong, do not verify — open the shift, correct the times and save. It stays in this queue.",
    ],
  },
  {
    n: 5,
    title: "Approve — the gate to money",
    icon: CheckCircle2,
    who: "HR/Admin · System Admin · Ops Head",
    where: "Deployments → tick the rows → Approve",
    href: "/deployments?status=TIMESHEET_VERIFIED",
    points: [
      "Only verified rows can be approved; anything else is skipped and reported back to you.",
      "Approving puts the hours into payroll and client invoices, so it asks you to confirm.",
      "Editing an approved shift reopens it for re-approval and records who changed what.",
    ],
  },
  {
    n: 6,
    title: "Read the reports",
    icon: ClipboardCheck,
    who: "Everyone · pay figures need Finance, HR/Admin or System Admin",
    where: "Reports",
    href: "/reports",
    points: [
      "Actual Deployment — who actually worked, shift by shift (approved only).",
      "Staff Working Hours / Payroll — days, regular and overtime hours per person (approved only).",
      "Client Chargeable Hours — what to invoice each client and event (approved only).",
      "Scheduled vs Actual — absences, replacements, lateness and overtime for everything except cancelled shifts. Use it before approving.",
    ],
  },
];

const ROLES: { role: string; enter: boolean; verify: boolean; approve: boolean; pay: boolean }[] = [
  { role: "Operations", enter: true, verify: false, approve: false, pay: false },
  { role: "Operations + Ops Head", enter: true, verify: true, approve: true, pay: false },
  { role: "HR / Admin", enter: true, verify: true, approve: true, pay: true },
  { role: "Finance", enter: false, verify: false, approve: false, pay: true },
  { role: "System Admin", enter: true, verify: true, approve: true, pay: true },
  { role: "Data Entry", enter: false, verify: false, approve: false, pay: false },
];

const FIXES: { msg: string; fix: string }[] = [
  {
    msg: "No staff profile matches that name",
    fix: "That person has no staff record, and every shift needs one for payroll. Add them under Staff → New profile, or write their Staff ID on the sheet, then upload it again.",
  },
  {
    msg: "The heading says one date but the line says another",
    fix: "The sheet contradicts itself — usually a date written day-first in one place and month-first in another. Pick the right date under Sheet details and check again. It is never guessed for you.",
  },
  {
    msg: "“JANE” could be two different people that day",
    fix: "Two scheduled people fit that name. Add the Staff ID or the Deployment ID to that line.",
  },
  {
    msg: "Deployment ID … no longer exists",
    fix: "The timesheet was downloaded before that shift was removed. Download a fresh one. If hours were filled in, they are still matched by staff and date.",
  },
  {
    msg: "This shift already appears earlier in this upload",
    fix: "The same shift is on two lines — often a PDF and a photo of the same sheet. It is recorded once; nothing is lost.",
  },
  {
    msg: "Only HR/Admin can change approved hours",
    fix: "Approved figures are locked to protect payroll. Ask HR/Admin; their edit reopens the shift for re-approval and is logged.",
  },
  {
    msg: "Nothing to report · 0 rows · approved only",
    fix: "The hours exist but are not approved yet. Go to Deployments, filter to Timesheet submitted, then verify and approve them.",
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground">How deployments and timesheets work</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A shift travels the same five stages every time. Hours become wages, so nothing reaches a
        report until a manager has approved it.
      </p>

      {/* The journey, in the same words and order as the strip on every screen. */}
      <ol className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {STAGES.map((s, i) => (
          <li key={s} className="flex h-full flex-col gap-0.5 bg-card p-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Step {i + 1}</span>
            <span className="text-sm font-medium text-foreground">{STATUS_LABEL[s]}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{STAGE_HELP[s].short}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-3">
        {STEPS.map((s) => (
          <section key={s.n} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-gold text-sm font-bold text-brand-navy-deep">
                {s.n}
              </span>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <s.icon className="h-4 w-4 text-muted-foreground" /> {s.title}
              </h2>
              {s.href ? (
                <Link href={s.href} className="ms-auto text-xs font-medium text-brand-navy underline underline-offset-2">
                  Open {s.where.split("→").pop()!.trim()}
                </Link>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
              <span><strong className="font-medium text-foreground">Who:</strong> {s.who}</span>
              <span><strong className="font-medium text-foreground">Where:</strong> {s.where}</span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
              {s.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            {s.note ? (
              <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-foreground">{s.note}</p>
            ) : null}
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">How the hours are worked out</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything is calculated in whole minutes and only turned into hours for display, so
          rounding never piles up across a payroll run.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/50 p-3 text-xs leading-6 text-foreground">
{`Worked    = (out − in) − break taken
Scheduled = (planned end − start) − planned break
Overtime  = worked − scheduled, if positive
Late      = in − planned start, if positive
Early out = planned end − out, if positive
No-show   = 0 hours (the replacement is paid
            instead when someone covered)`}
          </pre>
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Example</div>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">In</dt><dd className="tabular-nums">14:00</dd>
              <dt className="text-muted-foreground">Out (past midnight)</dt><dd className="tabular-nums">00:00</dd>
              <dt className="text-muted-foreground">Break</dt><dd className="tabular-nums">0m</dd>
              <dt className="border-t border-border pt-1 font-medium text-foreground">Worked</dt>
              <dd className="border-t border-border pt-1 font-semibold tabular-nums">10h 00m</dd>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              A shift ending at or before it starts counts into the next day, so night shifts never
              come out negative.
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-foreground">
          <strong>Why overtime can read 0.</strong> A shift created from a venue timesheet had no roster to
          compare against, so its planned time is the time worked. Overtime only appears when the shift
          was scheduled first.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Correcting, rejecting and cancelling</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          There is no reject button — correcting the hours is the rejection.
        </p>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Wrong, not yet approved:</strong> open the shift, fix the times, save. It stays in the verify queue.</li>
          <li><strong className="text-foreground">Wrong, already approved:</strong> HR/Admin edits it. The shift reopens and needs approving again; the change is logged.</li>
          <li><strong className="text-foreground">Never happened:</strong> tick it and press Cancel. Cancelled shifts drop out of every report.</li>
          <li><strong className="text-foreground">Whole sheet misread:</strong> fix the sheet and upload it again. Rows already recorded are recognised and never doubled.</li>
        </ul>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">When a line will not go through</h2>
        <dl className="mt-3 divide-y divide-border">
          {FIXES.map((f) => (
            <div key={f.msg} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-xs font-medium text-status-expired">{f.msg}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{f.fix}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Who can do what</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Roles are set under Settings → Users. “Ops Head” is a tick box on a user, not a separate role.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="table-head">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Schedule &amp; enter hours</th>
                <th className="px-3 py-2 font-medium">Verify</th>
                <th className="px-3 py-2 font-medium">Approve</th>
                <th className="px-3 py-2 font-medium">See pay figures</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.role} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{r.role}</td>
                  {[r.enter, r.verify, r.approve, r.pay].map((v, i) => (
                    <td key={i} className={cn("px-3 py-2", v ? "font-medium text-status-valid" : "text-muted-foreground")}>
                      {v ? "Yes" : "No"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Only HR/Admin and System Admin can change or cancel something already approved.
        </p>
      </section>
    </div>
  );
}
