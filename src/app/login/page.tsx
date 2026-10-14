import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { safeCallbackUrl } from "@/lib/redirects";
import { LoginForm } from "./login-form";

// Server wrapper around the sign-in form. Two jobs:
//  1. Anyone who reaches /login with a live session is sent straight on — without
//     this, using the browser's Back button after signing in parks you on the
//     sign-in form again even though you're already authenticated.
//  2. Hand the middleware's ?callbackUrl= down to the form so a deep link
//     (/staff/48, /documents?status=expired, …) survives the login round-trip
//     instead of everyone always landing on /dashboard.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.callbackUrl) ? sp.callbackUrl[0] : sp.callbackUrl;
  const target = safeCallbackUrl(raw);

  const session = await auth();
  if (session?.user) redirect(target);

  return <LoginForm callbackUrl={target} />;
}
