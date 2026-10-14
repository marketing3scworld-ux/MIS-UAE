import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { NewProfileWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function NewStaffPage() {
  const session = await auth();
  const role = session!.user.role;
  if (!can(role, "staff:create")) redirect("/staff");

  const [cats, locs, residences, nats, banks] = await Promise.all([
    prisma.categoryOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.residenceOption.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { value: "asc" }], select: { value: true } }),
    prisma.nationalityOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.bankOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);

  // Data-Entry creates PENDING (needs approval); roles with approve rights create APPROVED.
  const willApprove = can(role, "staff:approve");

  return (
    <div className="max-w-4xl">
      <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to staff
      </Link>
      <h1 className="mt-3 text-xl font-semibold text-foreground">New Staff Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload the Emirates ID to auto-fill, verify the details, then attach documents.
      </p>

      <div className="mt-5">
        <NewProfileWizard
          options={{
            categories: cats.map((c) => c.value),
            locations: locs.map((l) => l.value),
            residences: residences.map((r) => r.value),
            nationalities: nats.map((n) => n.value),
            banks: banks.map((b) => b.value),
          }}
          willApprove={willApprove}
        />
      </div>
    </div>
  );
}
