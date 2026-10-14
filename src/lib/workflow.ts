import type { DeploymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDeploymentWhere, type DeploymentParams } from "@/lib/deployment-query";

// How many shifts sit at each stage of the Phase-2 workflow for the filters in force.
// Deliberately ignores the status filter: the point of the strip is to show the whole
// journey, including the stages you are not currently looking at.

export const STAGES: DeploymentStatus[] = [
  "SCHEDULED", "DEPLOYED", "TIMESHEET_SUBMITTED", "TIMESHEET_VERIFIED", "APPROVED",
];

/** One line per stage, telling the reader what that stage means and who moves it on. */
export const STAGE_HELP: Record<DeploymentStatus, { short: string; next: string }> = {
  SCHEDULED: { short: "Staff rostered onto an event", next: "Waiting for the event and its timesheet" },
  DEPLOYED: { short: "Marked as turned up", next: "Waiting for the timesheet" },
  TIMESHEET_SUBMITTED: { short: "Hours entered, not checked", next: "Needs verifying" },
  TIMESHEET_VERIFIED: { short: "Hours checked by a supervisor", next: "Needs approving" },
  APPROVED: { short: "Signed off — in payroll and billing", next: "Nothing further" },
  CANCELLED: { short: "Did not happen", next: "Excluded from every report" },
};

export type StageCounts = Record<DeploymentStatus, number>;

export async function stageCounts(p: DeploymentParams): Promise<StageCounts> {
  const grouped = await prisma.deployment.groupBy({
    by: ["status"],
    where: buildDeploymentWhere({ ...p, status: "" }),
    _count: { _all: true },
  });
  const out = {
    SCHEDULED: 0, DEPLOYED: 0, TIMESHEET_SUBMITTED: 0, TIMESHEET_VERIFIED: 0, APPROVED: 0, CANCELLED: 0,
  } as StageCounts;
  for (const g of grouped) out[g.status] = g._count._all;
  return out;
}

/** The stage the person looking at the screen can actually move on right now. */
export function stageNeedingMe(
  counts: StageCounts,
  can: { verify: boolean; approve: boolean },
): DeploymentStatus | null {
  if (can.verify && counts.TIMESHEET_SUBMITTED > 0) return "TIMESHEET_SUBMITTED";
  if (can.approve && counts.TIMESHEET_VERIFIED > 0) return "TIMESHEET_VERIFIED";
  return null;
}
