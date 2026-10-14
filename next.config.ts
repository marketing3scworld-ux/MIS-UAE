import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Server-only Node libraries used by the notification engine / cron job and
  // the document optimiser (sharp is a native module). Keep them out of the
  // bundler so their runtime require()s resolve normally.
  serverExternalPackages: ["nodemailer", "node-cron", "sharp"],

  experimental: {
    // Minimise the browser-side Client Cache.
    //
    // The app previously had no loading.tsx anywhere, so Next prefetched the ENTIRE
    // page for every <Link> in the viewport and held it for `static` = 5 minutes.
    // The sidebar is always on screen, so /dashboard, /staff, /notifications and
    // /settings were permanently pre-cached — add a staff profile, navigate back to
    // the list, and you were served a payload from up to five minutes ago. Only a
    // hard refresh (which clears this cache) or a fresh login showed the new row.
    //
    // src/app/(app)/loading.tsx is the real fix: with a loading boundary, prefetch
    // only covers the shell and the page itself is governed by `dynamic` below.
    // 30 is the lowest `static` Next accepts (0 is rejected at build time).
    //
    // Every page here is `force-dynamic` and reads live data that colleagues edit
    // concurrently, so correctness beats instant navigation: serve fresh.
    staleTimes: { dynamic: 0, static: 30 },

    // Document and timesheet uploads send scans, PDFs and phone photos through a
    // Server Action, which Next caps at 1 MB by default — that cap is what made
    // "heavy files won't upload". 60mb covers a multi-page scan; the browser shrinks
    // large photos before sending (components/file-picker.tsx) and the server shrinks
    // them again on arrival (lib/optimize.ts), so stored files stay small.
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default withNextIntl(nextConfig);
