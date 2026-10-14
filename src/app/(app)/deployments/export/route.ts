import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { parseDeploymentParams, loadDeployments } from "@/lib/deployment-query";
import { varianceReport } from "@/lib/reports";
import { exportResponse } from "@/lib/report-export";

// Export of the deployment worklist itself. Uses the scheduled-vs-actual shape
// because that is the view with every operational column on it.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const p = parseDeploymentParams(sp);
  const rows = await loadDeployments(p);
  const doc = varianceReport(p, rows);
  doc.title = "Deployment Report";
  doc.filename = `bme-deployments-${p.from}_${p.to}`;
  return exportResponse(doc, sp.format ?? "xlsx");
}
