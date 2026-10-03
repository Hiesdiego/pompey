"use client";

import { useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { QueryClientProvider } from "@tanstack/react-query";
import { baseSepolia, baseMainnet } from "@tickr/shared/chains";
import { queryClient } from "../lib/query/queryClient";
import { LoginModalProvider } from "../components/LoginModal";
import { initMatchDuration } from "../lib/matchConfig";

/**
 * TICKR v0.1 Privy setup.
 *
 * As of the current @privy-io/react-auth SDK, smart wallets are NOT
 * configured via a `smartWallets` key on PrivyProvider's config — that
 * pattern is from an older SDK version. Instead:
 *
 * 1. Smart wallets (which chain type, Safe vs Kernel, etc.) are configured
 *    entirely in the Privy Dashboard, per-app.
 * 2. The gas sponsorship policy (which contracts/txs are sponsored, budget,
 *    which chain — Base Sepolia) is also configured in the Dashboard.
 * 3. On the client, `<SmartWalletsProvider>` just needs to wrap the app;
 *    its only prop is an optional `paymasterContext` override. Once the
 *    dashboard policy is on, `useSmartWallets().client.sendTransaction(...)`
 *    is automatically sponsored — see `hooks/useSponsoredTransaction.ts`.
 *
 * No app-side "enabled: true" flag exists anymore — this is intentionally
 * simpler than earlier docs describe.
 *
 * One-tap UX (improvement C): embedded-wallet signing passes
 * uiOptions: { showWalletUIs: false } so Privy's confirmation modal never
 * pops — the user-facing "Confirm in wallet…" step is the app's own stake
 * sheet + toasts. Also disable confirmation modals in the Privy Dashboard
 * (Embedded Wallets settings) so the server-side default matches.
 * Stakes < CONFIRM_THRESHOLD_TICK (QuickStake.tsx) submit on a single tap
 * and surface feedback through the Toast system at broadcast time.
 *
 * Data layer: the QueryClientProvider below uses the tuned shared
 * `queryClient` (lib/query/queryClient.ts) — 10s staleTime, 5min gcTime,
 * 2x exponential retries, refetch on window focus/reconnect. All market,
 * odds-history and balance queries go through it.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  // Fetch the on-chain match duration once — fixture "live" windows everywhere
  // (FixtureCard, match page) use it instead of a hardcoded constant.
  useEffect(() => {
    initMatchDuration();
  }, []);

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#2E7CF6",
          landingHeader: "Welcome to TICKR",
          loginMessage: "Predict. Stake. Climb the table.",
          showWalletLoginFirst: false,
        },
        loginMethods: ["email", "google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, baseMainnet],
      }}
    >
      <SmartWalletsProvider>
        <QueryClientProvider client={queryClient}>
          <LoginModalProvider>{children}</LoginModalProvider>
        </QueryClientProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}
