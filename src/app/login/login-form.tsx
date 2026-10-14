"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { authenticate } from "./actions";
import { LocaleToggle } from "@/components/locale-toggle";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [error, formAction, pending] = useActionState(authenticate, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const t = useTranslations("login");

  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-[#0a1626] bg-cover bg-center px-4"
      style={{
        // Drop the ballroom photo in at public/login-bg.jpg. Until then, the dark
        // gradient over the base colour is the fallback.
        backgroundImage:
          "linear-gradient(rgba(8,14,26,0.5), rgba(8,14,26,0.68)), url('/login-bg.jpg')",
      }}
    >
      <div className="absolute end-4 top-4 z-10">
        <LocaleToggle />
      </div>

      <div className="login-panel w-full max-w-sm rounded-2xl border border-white/20 bg-slate-900/30 p-8 shadow-2xl backdrop-blur-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image
            src="/bme-logo-white.png"
            alt="BME — Brilliant Minds"
            width={200}
            height={120}
            priority
            className="h-24 w-auto object-contain drop-shadow-lg"
          />
          <p className="text-sm text-brand-gold">{t("subtitle")}</p>
        </div>

        <form action={formAction} className="space-y-4">
          {/* Where to land after sign-in — set by the middleware when it bounced
              an unauthenticated request here. Sanitised server-side. */}
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <div>
            <label htmlFor="email" className="sr-only">{t("email")}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder={t("email")}
              className="w-full rounded-full px-4 py-2.5 text-sm outline-none"
            />
          </div>
          <div className="relative">
            <label htmlFor="password" className="sr-only">{t("password")}</label>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder={t("password")}
              // Extra end-padding keeps typed text clear of the reveal button.
              className="w-full rounded-full px-4 py-2.5 pe-11 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("hidePassword") : t("showPassword")}
              aria-pressed={showPassword}
              title={showPassword ? t("hidePassword") : t("showPassword")}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-slate-500 transition-colors hover:text-slate-800"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error ? (
            <p className="rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-100 ring-1 ring-inset ring-rose-400/30">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-white py-2.5 text-sm font-semibold text-slate-900 shadow transition-colors hover:bg-white/90 disabled:opacity-60"
          >
            {pending ? t("signingIn") : t("signIn")}
          </button>
        </form>
      </div>
    </main>
  );
}
