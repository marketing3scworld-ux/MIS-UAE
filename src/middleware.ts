import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware built from the Prisma-free config. The `authorized` callback
// protects every matched route; unauthenticated users are sent to /login.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except the auth API, the login page, Next internals, the
  // generated app icons, and any file with an extension (static assets like
  // /bme-logo.png). The icon routes are served extension-less (/icon?<hash>), so
  // they need naming here or the brand mark 401s on the sign-in page.
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\..*).*)",
  ],
};
