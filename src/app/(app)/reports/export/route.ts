import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSeePay } from "@/lib/deployment";
import { parseDeploymentParams, loadDeployments } from "@/lib/deployment-query";
import { buildReport, REPORTS, type ReportKey } from "@/lib/reports";
import { exportResponse } from "@/lib/report-export";

const KEYS = REPORTS.map((r) => r.key) as string[];

// Excel / PDF for any of the four reports. Builds the SAME document object the page
// renders, so an export can never show different numbers from the screen.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  if (!me) return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const key = (KEYS.includes(sp.r) ? sp.r : "actual") as ReportKey;

  if ((key === "payroll" || key === "billing") &&
      !canSeePay({ role: me.role, isOperationsHead: me.isOperationsHead })) {
    return new Response("Forbidden", { status: 403 });
  }

  const p = parseDeploymentParams(sp);
  const rows = await loadDeployments(p);
  return exportResponse(buildReport(key, p, rows), sp.format ?? "xlsx");
}
