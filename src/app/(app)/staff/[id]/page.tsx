import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { computeDocStatuses, statusFromDate } from "@/lib/doc-status";
import { StatusBadge } from "@/components/status-badge";
import { formatDateUTC, toDateInputValue, titleCaseName, titleCaseLabel } from "@/lib/format";
import { can } from "@/lib/rbac";
import { effectiveStatus, isActiveFromDocStatuses } from "@/lib/staff-query";
import { EditForm, type StaffFormValues } from "./edit-form";
import { approveStaff } from "./actions";
import { DocumentGallery } from "./document-gallery";
import { StaffPhoto } from "./staff-photo";
import { BlacklistControl } from "./blacklist-control";
import { StatusControl } from "./status-control";
import { DeleteProfile } from "./delete-profile";
import type { DocumentType } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) notFound();

  const session = await auth();
  const role = session!.user.role;
  const userId = Number(session!.user.id);

  const staff = await prisma.staff.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      handledBy: { select: { name: true } },
    },
  });
  if (!staff) notFound();
  if (!can(role, "staff:viewAll") && staff.createdById !== userId) notFound();

  const { expiryWindowDays } = await getSettings();
  const currentDocs = await prisma.staffDocument.findMany({
    where: { staffId: id, isCurrent: true },
  });
  const has = (t: DocumentType) => currentDocs.some((d) => d.type === t);
  const photoDoc = currentDocs.find((d) => d.type === "PHOTO");
  const initials = staff.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const docs = computeDocStatuses(staff, expiryWindowDays, new Date(), {
    eid: has("EID_FRONT") || has("EID_BACK"),
    ohc: has("OHC"),
    bfhc: has("BFHC"),
    passport: has("PASSPORT"),
  });
  const status = effectiveStatus(staff, docs);
  const galleryDocs = currentDocs.map((d) => ({
    id: d.id,
    type: d.type,
    fileName: d.fileName,
    mimeType: d.mimeType,
    expiryDate: toDateInputValue(d.expiryDate),
    handlingStatus: d.handlingStatus,
    version: d.version,
  }));

  const canEditProfile =
    can(role, "staff:editAll") ||
    (role === "DATA_ENTRY" && staff.approvalStatus === "PENDING" && staff.createdById === userId);
  const canEditBank = can(role, "staff:editBank");
  const canApprove = can(role, "staff:approve") && staff.approvalStatus === "PENDING";

  const [cats, locs, residences, nats, banks] = await Promise.all([
    prisma.categoryOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.residenceOption.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { value: "asc" }], select: { value: true } }),
    prisma.nationalityOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.bankOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);

  const initial: StaffFormValues = {
    id: staff.id,
    fullName: staff.fullName,
    arabicName: staff.arabicName ?? "",
    eidNumber: staff.eidNumber ?? "",
    category: staff.category ?? "",
    mobileNumber: staff.mobileNumber ?? "",
    eidExpiry: toDateInputValue(staff.eidExpiry),
    ohcExpiry: toDateInputValue(staff.ohcExpiry),
    bfhcExpiry: toDateInputValue(staff.bfhcExpiry),
    passportNumber: staff.passportNumber ?? "",
    passportExpiry: toDateInputValue(staff.passportExpiry),
    visaExpiry: toDateInputValue(staff.visaExpiry),
    gender: staff.gender ?? "",
    nationality: staff.nationality ?? "",
    location: staff.location ?? "",
    residenceLocation: staff.residenceLocation ?? "",
    // Read-only on the form: the documents decide, unless an admin has overridden it.
    employmentStatus: status.status,
    bankAccountTitle: staff.bankAccountTitle ?? "",
    iban: staff.iban ?? "",
    bankName: staff.bankName ?? "",
  };

  // Visa status is computed locally for this profile only — it is deliberately not
  // part of the dashboard/documents aggregate (buildExpiryReport) so the org-wide
  // "missing/expiring" KPIs stay on the four core documents.
  const visaStatus = statusFromDate(staff.visaExpiry, expiryWindowDays, has("VISA"), new Date());

  const docCards = [
    { label: "EID", date: staff.eidExpiry, status: docs.eid },
    { label: "OHC", date: staff.ohcExpiry, status: docs.ohc },
    { label: "BFHC", date: staff.bfhcExpiry, status: docs.bfhc },
    { label: "Passport", date: staff.passportExpiry, status: docs.passport },
    { label: "Visa", date: staff.visaExpiry, status: visaStatus },
  ];

  return (
    <div className="max-w-[1400px]">
      <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to staff
      </Link>

      {staff.blacklisted ? (
        <div className="mt-3">
          <BlacklistControl
            staffId={staff.id}
            blacklisted={true}
            reason={staff.blacklistReason}
            canManage={can(role, "staff:editAll")}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          <StaffPhoto
            staffId={staff.id}
            photoId={photoDoc?.id ?? null}
            initials={initials}
            canView={can(role, "docs:download")}
            canEdit={canEditProfile}
          />
          <div>
          <h1 className="text-xl font-semibold text-foreground">{titleCaseName(staff.fullName)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff No. {staff.id} · {titleCaseLabel(staff.category) || "—"} · {titleCaseLabel(staff.location) || "—"} ·{" "}
            <span className={staff.approvalStatus === "APPROVED" ? "font-semibold text-[#2f6bd8]" : "font-semibold text-amber-600"}>
              {staff.approvalStatus === "APPROVED" ? "Approved" : "Pending approval"}
            </span>
            {!staff.eidNumber ? <span className="font-semibold text-slate-500"> · No EID on file</span> : null}
            {staff.blacklisted ? <span className="font-semibold text-rose-600"> · Blacklisted</span> : null}
          </p>
          </div>
        </div>
        {canApprove ? (
          <form action={approveStaff.bind(null, staff.id)}>
            <button
              type="submit"
              className="rounded-md bg-brand-gold px-3 py-2 text-sm font-medium text-brand-navy-deep hover:bg-brand-gold/90"
            >
              Approve
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {docCards.map((d) => (
          <div key={d.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{d.label}</span>
              <StatusBadge status={d.status} />
            </div>
            <div className="mt-2 text-sm text-foreground">{formatDateUTC(d.date)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-end gap-x-4 gap-y-2">
        <StatusControl
          staffId={staff.id}
          status={status.status}
          overridden={status.overridden}
          note={staff.statusNote}
          derived={isActiveFromDocStatuses(docs) ? "ACTIVE" : "INACTIVE"}
          canManage={can(role, "staff:editAll")}
        />
        {!staff.blacklisted && can(role, "staff:editAll") ? (
          <BlacklistControl staffId={staff.id} blacklisted={false} reason={null} canManage={true} />
        ) : null}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <EditForm
            initial={initial}
            options={{
              categories: cats.map((c) => c.value),
              locations: locs.map((l) => l.value),
              residences: residences.map((r) => r.value),
              nationalities: nats.map((n) => n.value),
              banks: banks.map((b) => b.value),
            }}
            canEditProfile={canEditProfile}
            canEditBank={canEditBank}
          />
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground">Documents</h2>
          <div className="mt-3">
            <DocumentGallery
              staffId={staff.id}
              documents={galleryDocs}
              canEditProfile={canEditProfile}
              canEditBank={canEditBank}
              canView={can(role, "docs:download")}
              gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
        <span>Created by {staff.createdBy?.name ?? "import"} · {formatDateUTC(staff.createdAt)}</span>
        <span>Updated by {staff.updatedBy?.name ?? "—"} · {formatDateUTC(staff.updatedAt)}</span>
        {staff.handledBy ? <span>Handled by {staff.handledBy.name}</span> : null}
      </div>

      {can(role, "staff:delete") ? (
        <div className="mt-6 border-t border-border pt-5">
          <DeleteProfile staffId={staff.id} fullName={titleCaseName(staff.fullName)} />
        </div>
      ) : null}
    </div>
  );
}
