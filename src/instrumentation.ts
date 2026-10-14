// Next.js startup hook. Runs once when the server boots. We only start the
// in-process cron in the Node.js runtime (never Edge / build), and load the
// cron module dynamically so its server-only deps (prisma, nodemailer) never
// reach the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startExpiryCron } = await import("@/lib/cron");
  startExpiryCron();
}
