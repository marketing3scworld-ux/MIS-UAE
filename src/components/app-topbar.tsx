import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { Bell, LogOut } from "lucide-react";
import { ROLE_LABELS } from "@/lib/rbac";
import { LocaleToggle } from "@/components/locale-toggle";
import { TopbarSearch } from "@/components/topbar-search";
import { MobileNav } from "@/components/mobile-nav";
import type { Role } from "@prisma/client";

export async function AppTopbar({
  user,
  unread = 0,
}: {
  user: { name?: string | null; email?: string | null; role: Role };
  unread?: number;
}) {
  const t = await getTranslations("topbar");
  const tApp = await getTranslations("app");
  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="app-chrome glass-base pipeline-frost sticky top-0 z-30 flex h-16 flex-none items-center gap-2 border-b border-white/10 px-3 sm:gap-4 sm:px-4">
      <MobileNav role={user.role} unread={unread} />

      <Link href="/dashboard" className="flex min-w-0 flex-none items-center gap-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-white p-0.5 shadow ring-1 ring-white/25">
          <Image src="/bme-logo.webp" alt="BME MIS-UAE" width={34} height={34} className="h-full w-full rounded-full object-contain" />
        </span>
        {/* The name is dropped on the narrowest phones so the bar's controls still fit. */}
        <span className="hidden truncate text-lg font-bold tracking-wide text-white sm:inline" style={{ fontFamily: "var(--font-brand)" }}>
          {tApp("name")}
        </span>
      </Link>
      <div className="min-w-0 flex-1" />

      <div className="hidden sm:block">
        <TopbarSearch placeholder={t("searchPlaceholder")} />
      </div>

      <LocaleToggle />

      <Link
        href="/notifications"
        aria-label={unread > 0 ? `${t("notifications")} (${unread})` : t("notifications")}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-secondary"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-yellow px-1 text-[10px] font-bold text-brand-navy">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Link>

      <div className="flex flex-none items-center gap-1.5 sm:gap-3">
        <span className="hidden h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-navy text-xs font-semibold text-white sm:flex">
          {initials}
        </span>
        <div className="hidden leading-tight sm:block">
          <div className="text-sm font-medium text-foreground">{user.name}</div>
          <div className="text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            aria-label={t("signOut")}
            title={t("signOut")}
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-status-expired"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      </div>
    </header>
  );
}
