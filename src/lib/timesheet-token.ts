import { createHmac, timingSafeEqual } from "node:crypto";
import type { UploadData } from "@/lib/timesheet-evaluate";

// Reading the files is the slow, paid part (a scan can take a minute), and saving must
// use exactly what was read. So the check returns what it read signed with the server
// secret; "check again" and "record" accept only an untampered token issued to the same
// user within the hour. Matching, permissions and shift status are re-worked out from
// the database every time.

const TTL_MS = 60 * 60 * 1000;

function key(): string {
  const k = process.env.NEXTAUTH_SECRET;
  if (!k) throw new Error("NEXTAUTH_SECRET is not set");
  return k;
}
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export function issueToken(userId: number, data: UploadData): string {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + TTL_MS, d: data })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readToken(token: string, userId: number): UploadData | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.u !== userId || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p.d as UploadData;
  } catch {
    return null;
  }
}
