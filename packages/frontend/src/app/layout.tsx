import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { ThemeProvider } from "../components/ThemeProvider";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { OnboardingGate } from "../components/OnboardingGate";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TICKR — Crypto Price Prediction League",
  description:
    "Stake TICK on crypto teams. Match outcomes come from real price performance over 20-minute windows.",
};

// Runs before paint: applies the persisted theme so there's no flash.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tickr-theme');document.documentElement.classList.toggle('dark',t!=='light');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} min-h-screen bg-white font-sans text-zinc-900 antialiased transition-colors duration-300 dark:bg-black dark:text-zinc-100`}
      >
        <ThemeProvider>
          <Providers>
            <Header />
            <main className="mx-auto min-h-[70vh] max-w-6xl animate-page-in px-4 py-6">
              {children}
            </main>
            <Footer />
            <OnboardingGate />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
