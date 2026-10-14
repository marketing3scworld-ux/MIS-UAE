"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { safeCallbackUrl } from "@/lib/redirects";

export async function authenticate(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      // Return the user to the page they originally asked for. The middleware put
      // it in ?callbackUrl=; the login form forwards it in this hidden field.
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    throw error; // let the NEXT_REDIRECT from a successful sign-in propagate
  }
  return undefined;
}
