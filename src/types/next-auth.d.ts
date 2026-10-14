import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// Augment the session/JWT so `session.user.id` and `session.user.role` are typed.
declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
