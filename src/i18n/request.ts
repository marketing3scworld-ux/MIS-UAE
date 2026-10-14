// next-intl request config (spec §11). "Without i18n routing" mode: the locale
// comes from a cookie, so there is no [locale] path segment and the NextAuth
// middleware is untouched. Default English; Arabic switches the app to RTL.
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function normalizeLocale(value: string | undefined): Locale {
  return value === "ar" ? "ar" : "en";
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = normalizeLocale(store.get("locale")?.value);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
