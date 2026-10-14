"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizeLocale } from "@/i18n/request";

// Persist the chosen UI language in a cookie and re-render the whole app so the
// new locale + direction (LTR/RTL) take effect (spec §11).
export async function setLocale(value: string): Promise<void> {
  const locale = normalizeLocale(value);
  const store = await cookies();
  store.set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
