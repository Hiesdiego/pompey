import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { OnboardingGate } from "../components/OnboardingGate";

export const metadata: Metadata = {
  title: "TICKR — Crypto Price Prediction League",
  description:
    "Stake TICK on crypto teams. Match outcomes come from real price performance over 20-minute windows.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0b0d] text-zinc-100 antialiased">
        <Providers>
          <Header />
          <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-6">{children}</main>
          <Footer />
          <OnboardingGate />
        </Providers>
      </body>
    </html>
  );
}
