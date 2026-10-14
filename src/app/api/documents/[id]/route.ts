import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { storage } from "@/lib/storage";

// Serve an uploaded document file. Gated by auth + docs:download (spec §9).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!can(session.user.role, "docs:download")) return new Response("Forbidden", { status: 403 });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return new Response("Bad request", { status: 400 });

  const doc = await prisma.staffDocument.findUnique({ where: { id } });
  if (!doc) return new Response("Not found", { status: 404 });

  // ?dl=1 forces a download; otherwise the file is served inline for viewing.
  const download = _req.nextUrl.searchParams.get("dl") === "1";
  const safeName = doc.fileName.replace(/[\r\n"]/g, "");

  try {
    const buf = await storage.read(doc.filePath);
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new Response("File missing on disk", { status: 404 });
  }
}
