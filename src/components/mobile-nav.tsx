"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Menu, X, LayoutDashboard, Users, Bell, Settings, Building2, CalendarRange, CalendarPlus,
  BarChart3, HelpCircle, UserPlus, FileWarning, Upload, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Permission } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const STAFF_CHILDREN: { href: string; key: string; icon: LucideIcon; perm?: Permission }[] = [
  { href: "/staff/new", key: "newProfile", icon: UserPlus, perm: "staff:create" },
  { href: "/documents", key: "documents", icon: FileWarning, perm: "staff:viewAll" },
  { href: "/staff", key: "documentUpload", icon: Upload },
];

// Small-screen navigation: a hamburger in the top bar that opens a slide-in
// drawer mirroring the desktop sidebar. Hidden at lg+ (the sidebar takes over).
export function MobileNav({ role, unread = 0 }: { role: Role; unread?: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("nav");
  const close = () => setOpen(false);
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const children = STAFF_CHILDREN.filter((c) => !c.perm || can(role, c.perm));

  const link = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
      active ? "bg-white/[0.1] text-white" : "text-sidebar-foreground/75 hover:bg-white/[0.06] hover:text-white",
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="rounded-md p-2 text-white/80 hover:bg-white/10 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <aside className="app-chrome glass-base pipeline-frost absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-e border-white/10 text-sidebar-foreground">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-base font-bold tracking-wide text-white" style={{ fontFamily: "var(--font-brand)" }}>
                MIS-UAE
              </span>
              <button type="button" onClick={close} aria-label="Close menu" className="rounded-md p-1.5 text-white/70 hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-4 pt-0">
              <Link href="/dashboard" onClick={close} className={link(pathname === "/dashboard")}>
                <LayoutDashboard className="h-5 w-5 flex-none" />
                <span>{t("dashboard")}</span>
              </Link>

              <Link href="/staff" onClick={close} className={link(on("/staff"))}>
                <Users className="h-5 w-5 flex-none" />
                <span>{t("staff")}</span>
              </Link>
              <div className="ms-4 space-y-1 border-s border-white/10 ps-2">
                {children.map(({ href, key, icon: Icon }) => (
                  <Link
                    key={key}
                    href={href}
                    onClick={close}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    <Icon className="h-4 w-4 flex-none text-sidebar-foreground/50" />
                    <span>{t(key)}</span>
                  </Link>
                ))}
              </div>

              <Link href="/clients" onClick={close} className={link(on("/clients"))}>
                <Building2 className="h-5 w-5 flex-none" />
                <span>{t("clientsProjects")}</span>
              </Link>

              <Link href="/deployments" onClick={close} className={link(on("/deployments"))}>
                <CalendarRange className="h-5 w-5 flex-none" />
                <span>{t("deployments")}</span>
              </Link>
              <div className="ms-4 space-y-1 border-s border-white/10 ps-2">
                {[
                  { href: "/deployments/new", key: "scheduleStaff", Icon: CalendarPlus },
                  { href: "/deployments/timesheets", key: "timesheets", Icon: Upload },
                  { href: "/help", key: "howItWorks", Icon: HelpCircle },
                ].map(({ href, key, Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={close}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    <Icon className="h-4 w-4 flex-none text-sidebar-foreground/50" />
                    <span>{t(key)}</span>
                  </Link>
                ))}
              </div>

              <Link href="/reports" onClick={close} className={link(on("/reports"))}>
                <BarChart3 className="h-5 w-5 flex-none" />
                <span>{t("reports")}</span>
              </Link>

              <Link href="/notifications" onClick={close} className={link(on("/notifications"))}>
                <Bell className="h-5 w-5 flex-none" />
                <span className="flex-1">{t("notifications")}</span>
                {unread > 0 ? (
                  <span className="flex-none rounded-full bg-brand-gold px-1.5 py-0.5 text-[10px] font-bold text-brand-navy-deep">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </Link>

              {can(role, "settings:manage") ? (
                <Link href="/settings" onClick={close} className={link(on("/settings"))}>
                  <Settings className="h-5 w-5 flex-none" />
                  <span>{t("settings")}</span>
                </Link>
              ) : null}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
