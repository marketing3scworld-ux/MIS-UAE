import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

// Edge-safe Auth.js config — NO Prisma/bcrypt here so it can run in the
// middleware (Edge) runtime. The Credentials provider's authorize (which uses
// Prisma) lives in the Node-only auth.ts, which spreads this config.
export const authConfig = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // real provider added in auth.ts
  callbacks: {
    // Gate matched routes (see middleware matcher). Returning false redirects
    // unauthenticated users to pages.signIn.
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
