// Where to send someone after a successful sign-in.
//
// Auth.js middleware bounces an unauthenticated request to
// `/login?callbackUrl=<the FULL href they asked for>`, e.g.
// `https://bmemisae.3sc.tech/staff/48?tab=docs`. Whatever comes back has to be
// treated as untrusted input, so we keep ONLY the path + query and throw the
// origin away — that makes an injected `https://evil.example/x` collapse to the
// harmless in-app path `/x` instead of redirecting a signed-in user off-site.

export const DEFAULT_AFTER_LOGIN = "/dashboard";

export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_AFTER_LOGIN;

  let path: string;
  try {
    // The base only matters for relative inputs; the origin is discarded either way.
    const u = new URL(raw, "http://internal.invalid");
    path = `${u.pathname}${u.search}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }

  if (!path.startsWith("/") || path.startsWith("//")) return DEFAULT_AFTER_LOGIN;
  // Bouncing back to the sign-in page (or the bare root, which only re-redirects)
  // would leave the user staring at the form they just completed.
  const pathname = path.split("?")[0];
  if (pathname === "/" || pathname === "/login") return DEFAULT_AFTER_LOGIN;

  return path;
}
