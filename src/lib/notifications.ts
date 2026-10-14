// Document-expiry notification engine (spec §7). Idempotent: re-running never
// duplicates alerts — it re-notifies on the configured interval, escalates by
// email after N cycles, and auto-resolves when a document is renewed or the
// staff goes inactive. Invoked nightly by node-cron and on demand by admins.
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { statusFromDate, type ComputedStatus, type DocKey } from "@/lib/doc-status";
import { formatDateUTC, titleCaseName } from "@/lib/format";
import { sendMail } from "@/lib/mailer";
import type { DocumentType, DocStatus, Prisma } from "@prisma/client";

export type ScanSummary = {
  scannedStaff: number;
  created: number;
  renotified: number;
  escalated: number;
  resolved: number;
};

// The recurring engine alerts on actionable expiry only. MISSING documents are a
// data-completeness state already surfaced in the list/profile UI (Steps 6–7),
// not an escalation-worthy recurring alert — kept out to avoid flooding.
const ALERT_STATUSES: ComputedStatus[] = ["EXPIRED", "EXPIRING_SOON"];

const DOC_META: Record<
  DocKey,
  { type: DocumentType; label: string; field: "eidExpiry" | "ohcExpiry" | "bfhcExpiry" | "passportExpiry" }
> = {
  eid: { type: "EID_FRONT", label: "Emirates ID", field: "eidExpiry" },
  ohc: { type: "OHC", label: "OHC", field: "ohcExpiry" },
  bfhc: { type: "BFHC", label: "BFHC", field: "bfhcExpiry" },
  passport: { type: "PASSPORT", label: "Passport", field: "passportExpiry" },
};

const DAY_MS = 86_400_000;

function buildMessage(label: string, status: ComputedStatus, date: Date | null): string {
  const d = date ? formatDateUTC(date) : "";
  if (status === "EXPIRED") return d ? `${label} expired on ${d}.` : `${label} has expired.`;
  return d ? `${label} is expiring on ${d}.` : `${label} is expiring soon.`;
}

const APP_URL = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// A branded escalation email (plain text + HTML) sent to a staff member's manager
// when a document-expiry alert has gone unactioned past the escalation threshold.
function buildEscalationEmail(a: {
  to: string;
  managerName: string;
  staffName: string;
  staffId: number;
  docLabel: string;
  statusLine: string;
  expired: boolean;
  assigneeName: string;
  assigneeEmail: string;
  cycles: number;
}): { to: string; subject: string; text: string; html: string } {
  const url = APP_URL ? `${APP_URL}/staff/${a.staffId}` : "";
  const hi = a.managerName ? `Hi ${a.managerName},` : "Hi,";
  const subject = `[BME MIS] Action needed — ${a.docLabel} ${a.expired ? "expired" : "expiring"}: ${a.staffName}`;
  const text = [
    hi,
    "",
    "A staff document-expiry alert has gone unactioned and is being escalated to you.",
    "",
    `Staff:        ${a.staffName} (Staff No. ${a.staffId})`,
    `Document:     ${a.docLabel}`,
    `Status:       ${a.statusLine}`,
    `Assigned to:  ${a.assigneeName} <${a.assigneeEmail}>`,
    `Reminders:    ${a.cycles} sent without action`,
    "",
    url ? `Review & renew: ${url}` : "Open the staff profile in BME MIS to review and renew the document.",
    "",
    "— BME MIS · Brilliant Minds Events LLC",
  ].join("\n");
  const color = a.expired ? "#b91c1c" : "#b45309";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f2440">
  <div style="background:#184170;padding:16px 20px;border-radius:8px 8px 0 0">
    <div style="color:#fff;font-weight:700;letter-spacing:.06em;font-size:15px">BME MIS</div>
    <div style="color:#c4d5ec;font-size:12px;margin-top:2px">Document Expiry — Escalation Alert</div>
  </div>
  <div style="border:1px solid #dde5ef;border-top:none;border-radius:0 0 8px 8px;padding:20px">
    <p style="margin:0 0 14px;font-size:14px">${esc(hi)} a staff document-expiry alert has gone <strong>unactioned</strong> and is being escalated to you.</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:5px 0;color:#64748b;width:110px">Staff</td><td style="padding:5px 0;font-weight:600">${esc(a.staffName)} · No. ${a.staffId}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Document</td><td style="padding:5px 0;font-weight:600">${esc(a.docLabel)}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Status</td><td style="padding:5px 0;font-weight:700;color:${color}">${esc(a.statusLine)}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Assigned to</td><td style="padding:5px 0">${esc(a.assigneeName)} &lt;${esc(a.assigneeEmail)}&gt;</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Reminders</td><td style="padding:5px 0">${a.cycles} sent without action</td></tr>
    </table>
    ${url ? `<p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;background:#184170;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600">Review &amp; renew</a></p>` : ""}
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Brilliant Minds Events LLC · Management Information System</p>
  </div>
</div>`;
  return { to: a.to, subject, text, html };
}

export async function runExpiryScan(now: Date = new Date()): Promise<ScanSummary> {
  const { expiryWindowDays, reNotifyIntervalDays, escalationThresholdCycles } = await getSettings();

  // Inactive staff never carry alerts — close any lingering ones first (§7).
  const inactiveResolved = await prisma.notification.updateMany({
    where: { state: { not: "RESOLVED" }, staff: { employmentStatus: "INACTIVE" } },
    data: { state: "RESOLVED", resolvedAt: now },
  });

  const staff = await prisma.staff.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: {
      id: true, fullName: true, handledById: true,
      eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true,
    },
  });
  const staffIds = staff.map((s) => s.id);

  // Current-file presence (no file => can't be Expiring/Valid; drives Missing).
  const docRows = staffIds.length
    ? await prisma.staffDocument.findMany({
        where: { staffId: { in: staffIds }, isCurrent: true },
        select: { staffId: true, type: true },
      })
    : [];
  const presence = new Map<number, Set<string>>();
  for (const d of docRows) {
    (presence.get(d.staffId) ?? presence.set(d.staffId, new Set()).get(d.staffId)!).add(d.type);
  }
  const hasFile = (id: number, key: DocKey): boolean => {
    const set = presence.get(id);
    if (!set) return false;
    if (key === "eid") return set.has("EID_FRONT") || set.has("EID_BACK");
    if (key === "ohc") return set.has("OHC");
    if (key === "bfhc") return set.has("BFHC");
    return set.has("PASSPORT");
  };

  // Recipient pools: handled-by Operations user, else Operations Head, else all
  // Operations users, else System Admins (last resort so alerts are never lost).
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true, email: true, name: true, role: true, isOperationsHead: true,
      manager: { select: { email: true, name: true } },
    },
  });
  const usersById = new Map(users.map((u) => [u.id, u]));
  const opsHeads = users.filter((u) => u.isOperationsHead).map((u) => u.id);
  const opsUsers = users.filter((u) => u.role === "OPERATIONS").map((u) => u.id);
  const adminUsers = users.filter((u) => u.role === "SYSTEM_ADMIN").map((u) => u.id);
  const recipientsFor = (handledById: number | null): number[] => {
    if (handledById && usersById.has(handledById)) return [handledById];
    if (opsHeads.length) return opsHeads;
    if (opsUsers.length) return opsUsers;
    return adminUsers;
  };
  // Escalation emails go to EVERY active Operations Head (the "managers" who oversee
  // compliance) — one email per document, to all of them. Falls back to the alert
  // recipient's manager if no Operations Head is flagged.
  const opsHeadEmails = [...new Set(users.filter((u) => u.isOperationsHead && u.email).map((u) => u.email as string))];

  // Open (non-resolved) notifications, keyed by staff|type|recipient.
  const open = await prisma.notification.findMany({
    where: { state: { not: "RESOLVED" }, staffId: { in: staffIds.length ? staffIds : [-1] } },
  });
  const key = (sid: number, t: DocumentType, rid: number) => `${sid}|${t}|${rid}`;
  const openMap = new Map(open.map((n) => [key(n.staffId, n.documentType, n.recipientId), n]));

  let created = 0;
  let renotified = 0;
  let escalated = 0;
  let resolved = inactiveResolved.count;
  const escalatedDocs = new Set<string>(); // staff|docType already emailed this scan (dedupe across recipients)

  for (const s of staff) {
    for (const docKey of Object.keys(DOC_META) as DocKey[]) {
      const meta = DOC_META[docKey];
      const date = s[meta.field] as Date | null;
      const status = statusFromDate(date, expiryWindowDays, hasFile(s.id, docKey), now);
      const recips = recipientsFor(s.handledById);

      for (const rid of recips) {
        const existing = openMap.get(key(s.id, meta.type, rid));
        const alertable = ALERT_STATUSES.includes(status);

        if (alertable) {
          const docStatus = status as DocStatus; // EXPIRED | EXPIRING_SOON
          const message = buildMessage(meta.label, status, date);

          if (!existing) {
            await prisma.notification.create({
              data: {
                staffId: s.id, recipientId: rid, documentType: meta.type,
                docStatus, message, channel: "IN_SYSTEM", state: "UNVIEWED",
                cycleCount: 1, escalated: false, lastNotifiedAt: now,
              },
            });
            created++;
            continue;
          }

          const due =
            now.getTime() - existing.lastNotifiedAt.getTime() >= reNotifyIntervalDays * DAY_MS;
          const nextCycle = due ? existing.cycleCount + 1 : existing.cycleCount;
          const data: Prisma.NotificationUpdateInput = { docStatus, message };
          if (due) {
            data.cycleCount = nextCycle;
            data.lastNotifiedAt = now;
          }

          // Escalate once per document: threshold reached & still unviewed. Emails
          // ALL Operations Heads (one message), not just one manager.
          if (!existing.escalated && existing.state === "UNVIEWED" && nextCycle >= escalationThresholdCycles) {
            const recip = usersById.get(rid);
            const escTo = opsHeadEmails.length ? opsHeadEmails : (recip?.manager?.email ? [recip.manager.email] : []);
            const ek = `${s.id}|${meta.type}`;
            if (escTo.length && !escalatedDocs.has(ek)) {
              await sendMail(buildEscalationEmail({
                to: escTo.join(", "),
                managerName: escTo.length === 1 ? (recip?.manager?.name ?? "") : "",
                staffName: titleCaseName(s.fullName),
                staffId: s.id,
                docLabel: meta.label,
                statusLine: message,
                expired: status === "EXPIRED",
                assigneeName: recip?.name ?? "",
                assigneeEmail: recip?.email ?? "",
                cycles: nextCycle,
              }));
              escalatedDocs.add(ek);
              escalated++;
            }
            data.escalated = true;
          }

          const changed =
            due || data.escalated !== undefined || existing.docStatus !== docStatus || existing.message !== message;
          if (changed) {
            await prisma.notification.update({ where: { id: existing.id }, data });
            if (due) renotified++;
          }
        } else if (existing && status === "VALID") {
          // Renewed — close the alert.
          await prisma.notification.update({
            where: { id: existing.id },
            data: { state: "RESOLVED", resolvedAt: now },
          });
          resolved++;
        }
        // status MISSING with an open alert: left as-is (still a live problem).
      }
    }
  }

  return { scannedStaff: staff.length, created, renotified, escalated, resolved };
}
