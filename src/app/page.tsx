import { redirect } from "next/navigation";

// Root: send everyone to the dashboard. Middleware bounces unauthenticated
// users to /login from there.
export default function RootPage() {
  redirect("/dashboard");
}
