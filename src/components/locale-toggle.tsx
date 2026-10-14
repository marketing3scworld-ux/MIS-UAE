"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { Languages } from "lucide-react";
import { setLocale } from "@/lib/locale-actions";

// EN ⇄ AR language switch. Shows the language it will switch TO.
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  const label = locale === "ar" ? "English" : "العربية";

  return (
    <button
      type="button"
      onClick={() => start(() => setLocale(next))}
      disabled={pending}
      aria-label={`Switch language to ${label}`}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-60"
      }
    >
      <Languages className="h-4 w-4" />
      {label}
    </button>
  );
}
