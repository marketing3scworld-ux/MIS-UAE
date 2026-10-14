// Nightly expiry-scan scheduler (spec §7). Started once from instrumentation.ts
// in the Node.js runtime. node-cron runs in-process, so this only fires while
// the app is running — production would move it to a real scheduler, but for
// Phase 1 the in-process job matches the "runs on the server" requirement.
import cron from "node-cron";
import { runExpiryScan } from "@/lib/notifications";

const g = globalThis as unknown as { __bmeExpiryCron?: boolean };

export function startExpiryCron(): void {
  if (g.__bmeExpiryCron) return; // survive dev HMR / double registration

  const expr = process.env.SCAN_CRON || "0 2 * * *"; // 02:00 daily
  const tz = process.env.SCAN_TZ || "Asia/Dubai";

  try {
    if (typeof cron.validate === "function" && !cron.validate(expr)) {
      console.error(`[cron] invalid SCAN_CRON "${expr}" — expiry scan NOT scheduled`);
      return;
    }
    cron.schedule(
      expr,
      async () => {
        try {
          const summary = await runExpiryScan();
          console.log(`[cron] expiry scan @ ${new Date().toISOString()}`, summary);
        } catch (err) {
          console.error("[cron] expiry scan failed", err);
        }
      },
      { timezone: tz },
    );
    g.__bmeExpiryCron = true;
    console.log(`[cron] expiry scan scheduled "${expr}" (${tz})`);
  } catch (err) {
    // Never let a scheduler quirk take down server startup.
    console.error("[cron] failed to schedule expiry scan", err);
  }
}
