import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { ThemeProvider } from "../components/ThemeProvider";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { OnboardingGate } from "../components/OnboardingGate";
import { PwaRegister } from "../components/PwaRegister";
import { ToastViewport } from "../components/Toast";
import { WatchAlertMonitor } from "../components/WatchAlertMonitor";
import { Analytics } from "@vercel/analytics/next";
import { siteUrl } from "../lib/siteUrl";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

// Absolute origin for metadataBase — without it Next emits relative og:image
// URLs, which crawlers can't resolve. Mirrors siteUrl() in api/social/og/_shared.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: "TICKR",
  title: {
    default: "TICKR | Crypto Price Prediction League on Base",
    template: "%s | TICKR",
  },
  description:
    "TICKR is a crypto price prediction league on Base. Follow coin fixtures, compare real price performance, and predict outcomes with TICK.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        url: "/tickr-logo/v2-rising-t/tickr-icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TICKR",
  },
  openGraph: {
    type: "website",
    siteName: "TICKR",
    title: "TICKR | Crypto Price Prediction League on Base",
    description:
      "Follow coin fixtures, compare real price performance, and predict outcomes with TICK on Base.",
    images: [
      {
        url: "/tickr-hero.png",
        width: 1774,
        height: 887,
        alt: "TICKR - Crypto Price Prediction League",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TICKR | Crypto Price Prediction League on Base",
    description:
      "Follow coin fixtures, compare real price performance, and predict outcomes with TICK on Base.",
    images: ["/tickr-hero.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the standalone app paint under the notch/home indicator; the market
  // sheets already pad with env(safe-area-inset-bottom).
  viewportFit: "cover",
  // Match the manifest's theme_color, and follow the app theme so the mobile
  // browser chrome doesn't sit in navy above a light page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0B1B3D" },
    { media: "(prefers-color-scheme: dark)", color: "#050B18" },
  ],
  colorScheme: "dark light",
};

// Runs before paint: applies the persisted theme so there's no flash.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tickr-theme');document.documentElement.classList.toggle('dark',t!=='light');}catch(e){document.documentElement.classList.add('dark');}})();`;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "TICKR", url: siteUrl() },
    { "@type": "Organization", name: "TICKR", url: siteUrl(), logo: `${siteUrl()}/icons/icon-512.png`, email: "contact@tickrbase.top" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} min-h-screen bg-white font-sans text-zinc-900 antialiased transition-colors duration-300 dark:bg-black dark:text-zinc-100`}
      >
        <ThemeProvider>
          <PwaRegister />
          <Providers>
            <Header />
            <main className="app-page-shell mx-auto min-h-[70vh] max-w-6xl animate-page-in px-4 py-6">
              {children}
            </main>
            <Footer />
            <OnboardingGate />
            <ToastViewport />
            <WatchAlertMonitor />
          </Providers>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
