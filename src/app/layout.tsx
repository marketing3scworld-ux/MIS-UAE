import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import "../styles/glass.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display font for the brand wordmark (BME MIS).
const brandFont = Poppins({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Site identity. The browser-tab / home-screen icons come from the App-Router file
// conventions next to this file (favicon.ico, icon.png, apple-icon.png) — all three
// generated from the BME brand mark by `npm run make:icons`.
export const metadata: Metadata = {
  title: "BME MIS — Staff Profile & Document Repository",
  description:
    "Brilliant Minds Events LLC — Management Information System (Phase 1).",
  applicationName: "BME MIS",
  appleWebApp: { title: "BME MIS" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale + direction come from the cookie-driven next-intl request config (§11).
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla adds
          cz-shortcut-listen) mutate <body> before React hydrates; ignore that
          attribute-only mismatch instead of failing hydration. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {/* Liquid-glass displacement filter — referenced via filter:url(#liquid-lens)
            by the two hero surfaces (dashboard header, login card). Presentational. */}
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          <filter id="liquid-lens">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={2} seed={7} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={14} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {/* True liquid-glass lens (macOS technique): low-frequency fractalNoise,
              lightly smoothed, drives feDisplacementMap so the backdrop RIPPLES
              organically — the watery, rain-on-glass warp. No encoded image. Used by
              .liquid-glass on the login hero. Chromium refracts; others fall to blur.
              `scale` = ripple strength. */}
          <filter id="liquid-glass" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves={2} seed={92} result="noise" />
            <feGaussianBlur in="noise" stdDeviation="0.02" result="blur" />
            <feDisplacementMap in="SourceGraphic" in2="blur" scale={70} xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {/* Layered liquid glass (lucasromerodb dock): low-frequency turbulence
              smoothed hard (stdDeviation 3) → large, soft liquid waves; strong scale.
              Used by .lg-effect on the dashboard renewals hero. `scale` = wave depth. */}
          <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01" numOctaves={1} seed={5} result="turbulence" />
            <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
            <feDisplacementMap in="SourceGraphic" in2="softMap" scale={130} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        {/* Composed background scene + grain — fixed, behind all content. */}
        <div className="app-scene" aria-hidden="true" />
        <div className="app-grain" aria-hidden="true" />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
