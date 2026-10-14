import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

// Authenticated application shell: labelled sidebar (left) + top bar + light
// content. Middleware already guards these routes; this is the belt-and-braces
// server-side check.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const scope = can(session.user.role, "staff:viewAll") ? {} : { recipientId: Number(session.user.id) };
  const unread = await prisma.notification.count({ where: { ...scope, state: "UNVIEWED" } });

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopbar user={session.user} unread={unread} />
      <div className="flex flex-1">
        <AppSidebar role={session.user.role} unread={unread} />
        <main className="app-light min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
