"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Users, Bell, Settings, UserPlus, FileWarning, Upload, ChevronDown, CalendarRange, BarChart3, CalendarPlus, Building2, HelpCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Permission } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const STAFF_CHILDREN: { href: string; key: string; icon: LucideIcon; perm?: Permission }[] = [
  { href: "/staff/new", key: "newProfile", icon: UserPlus, perm: "staff:create" },
  { href: "/documents", key: "documents", icon: FileWarning, perm: "staff:viewAll" },
  { href: "/staff", key: "documentUpload", icon: Upload },
];

// Phase 2. Deployments groups its own sub-pages the same way Staff does.
const DEPLOY_CHILDREN: { href: string; key: string; icon: LucideIcon }[] = [
  { href: "/deployments/new", key: "scheduleStaff", icon: CalendarPlus },
  { href: "/deployments/timesheets", key: "timesheets", icon: Upload },
  { href: "/help", key: "howItWorks", icon: HelpCircle },
];

export function AppSidebar({ role, unread = 0 }: { role: Role; unread?: number }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const inStaff = pathname.startsWith("/staff") || pathname.startsWith("/documents");
  const inDeploy = pathname.startsWith("/deployments");
  const children = STAFF_CHILDREN.filter((c) => !c.perm || can(role, c.perm));

  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const top = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
      active ? "bg-white/[0.1] text-white ring-1 ring-inset ring-white/10" : "text-sidebar-foreground/75 hover:bg-white/[0.06] hover:text-white",
    );
  const childActive = (href: string) =>
    href === "/staff"
      ? pathname === "/staff" || (pathname.startsWith("/staff/") && !pathname.startsWith("/staff/new"))
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="glass-base pipeline-frost sticky top-16 z-20 hidden h-[calc(100dvh-4rem)] w-60 flex-none flex-col self-start border-e border-white/10 text-sidebar-foreground lg:flex">
      <nav className="flex-1 space-y-1 p-4">
        <Link href="/dashboard" className={top(pathname === "/dashboard")}>
          <LayoutDashboard className={cn("h-5 w-5 flex-none", pathname === "/dashboard" ? "text-brand-gold" : "")} />
          <span className="flex-1">{t("dashboard")}</span>
        </Link>

        {/* Staff — expandable section (auto-opens in the staff area) */}
        <div>
          <Link
            href="/staff"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              inStaff ? "text-white" : "text-sidebar-foreground/75 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            <Users className={cn("h-5 w-5 flex-none", inStaff ? "text-brand-gold" : "")} />
            <span className="flex-1">{t("staff")}</span>
            <ChevronDown className={cn("h-4 w-4 flex-none transition-transform duration-200", inStaff ? "rotate-180" : "")} />
          </Link>

          {inStaff ? (
            <div className="mt-1 ms-4 space-y-1 border-s border-white/10 ps-2">
              {children.map(({ href, key, icon: Icon }) => {
                const active = childActive(href);
                return (
                  <Link
                    key={key}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-white/[0.08] font-medium text-white" : "text-sidebar-foreground/70 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 flex-none", active ? "text-brand-gold" : "text-sidebar-foreground/50")} />
                    <span>{t(key)}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        <Link href="/clients" className={top(on("/clients"))}>
          <Building2 className={cn("h-5 w-5 flex-none", on("/clients") ? "text-brand-gold" : "")} />
          <span className="flex-1">{t("clientsProjects")}</span>
        </Link>

        {/* Phase 2 — scheduling, timesheets and the reports built from them. */}
        <div>
          <Link href="/deployments" className={top(inDeploy)}>
            <CalendarRange className={cn("h-5 w-5 flex-none", inDeploy ? "text-brand-gold" : "")} />
            <span className="flex-1">{t("deployments")}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", inDeploy ? "rotate-180" : "")} />
          </Link>
          {inDeploy ? (
            <div className="mt-1 space-y-1 ps-4">
              {DEPLOY_CHILDREN.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    pathname === c.href
                      ? "bg-white/[0.1] text-white"
                      : "text-sidebar-foreground/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <c.icon className="h-4 w-4 flex-none" />
                  <span>{t(c.key)}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <Link href="/reports" className={top(on("/reports"))}>
          <BarChart3 className={cn("h-5 w-5 flex-none", on("/reports") ? "text-brand-gold" : "")} />
          <span className="flex-1">{t("reports")}</span>
        </Link>

        <Link href="/notifications" className={top(on("/notifications"))}>
          <Bell className={cn("h-5 w-5 flex-none", on("/notifications") ? "text-brand-gold" : "")} />
          <span className="flex-1">{t("notifications")}</span>
          {unread > 0 ? (
            <span className="flex-none rounded-full bg-brand-gold px-1.5 py-0.5 text-[10px] font-bold text-brand-navy-deep">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        {can(role, "settings:manage") ? (
          <Link href="/settings" className={top(on("/settings"))}>
            <Settings className={cn("h-5 w-5 flex-none", on("/settings") ? "text-brand-gold" : "")} />
            <span className="flex-1">{t("settings")}</span>
          </Link>
        ) : null}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/50">
      
      </div>
    </aside>
  );
}
