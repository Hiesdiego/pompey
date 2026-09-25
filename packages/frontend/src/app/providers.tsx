"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { baseSepolia, baseMainnet } from "@tickr/shared/chains";

const queryClient = new QueryClient();

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
 */
export default function Providers({ children }: { children: React.ReactNode }) {
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
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}
