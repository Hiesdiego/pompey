---
name: privy
description: >
  Expert knowledge base for building with Privy's authentication and wallet infrastructure SDK.
  Use this skill whenever a user asks about Privy integration, embedded wallets, Privy authentication,
  the PrivyProvider, Privy React SDK, Privy Node SDK, Privy REST API, login methods (email, SMS,
  OAuth, social login, SIWE, SIWS, Farcaster, Telegram, passkeys), wallet creation/signing/transactions,
  configuring EVM or Solana networks, customizing Privy UI appearance, custodial or non-custodial
  wallets, digital asset accounts, owners/signers, key quorums, authorization keys, authorization
  signatures, policies and policy enforcement, or migrating from older Privy SDK versions. Trigger
  even when the user just mentions "Privy" or shows Privy-related imports.
---

# Privy Skill

Privy builds authentication and wallet infrastructure for crypto-enabled apps. It enables:
- **User onboarding** — Auth via email, SMS, social, wallet, passkeys; embedded wallets provisioned on login
- **Wallet infrastructure** — Create, sign, and transact with non-custodial or custodial wallets on Ethereum (EVM), Solana (SVM), and other chains, from client or server
- **Controls** — Owners, signers, key quorums, and programmable policies that govern who can take which actions with a wallet

---

## Core Architecture

### Client-Side SDKs
| SDK | Package | Use Case |
|-----|---------|----------|
| React | `@privy-io/react-auth` | Web apps |
| React Native | `@privy-io/react-auth` (Expo/RN) | Mobile |
| Swift | Privy Swift SDK | iOS |
| Android | Privy Android SDK | Android (Kotlin) |
| Flutter | Privy Flutter SDK | Cross-platform mobile |
| Unity | Privy Unity SDK | Games |

### Server-Side SDKs
| SDK | Package |
|-----|---------|
| Node.js | `@privy-io/node` |
| Java, Rust, Go, Ruby | Privy server SDKs |

---

## React SDK Setup

### Installation
```bash
npm install @privy-io/react-auth@latest
# For Solana wallets, also install:
# @solana/kit @solana-program/memo @solana-program/system @solana-program/token
```

### PrivyProvider Setup (required — wrap app root)
```tsx
'use client'; // Next.js
import { PrivyProvider } from '@privy-io/react-auth';

export default function Providers({ children }) {
  return (
    <PrivyProvider
      appId="your-privy-app-id"
      clientId="your-app-client-id"  // optional
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          // solana: { createOnLogin: 'users-without-wallets' }
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

### Wait for Ready State
Always check `ready` before consuming Privy state:
```tsx
import { usePrivy } from '@privy-io/react-auth';
const { ready } = usePrivy();
if (!ready) return <div>Loading...</div>;
```

---

## Authentication

### Email Login (OTP)
```tsx
import { useLoginWithEmail } from '@privy-io/react-auth';
const { sendCode, loginWithCode } = useLoginWithEmail();

// Step 1: send OTP
await sendCode({ email: 'user@example.com' });
// Step 2: verify OTP
await loginWithCode({ code: '123456' });
```

### Supported Login Methods
- **Email** — OTP (10 min validity)
- **SMS** — OTP; US/Canada on all plans; international on Scale/Enterprise
- **OAuth** — Google, Twitter/X, Apple, Discord, GitHub, LinkedIn, Instagram, Spotify, TikTok, Twitch, LINE
- **SIWE** — Sign In with Ethereum (any EVM wallet)
- **SIWS** — Sign In with Solana (any SVM wallet)
- **Farcaster** — React and React Native only
- **Telegram** — React only; requires bot token + domain config (tunnel like ngrok needed for local dev)
- **Passkeys** — React, React Native, Swift, Android, Flutter
- **Custom Auth** — Bring your own JWT (Auth0, Stytch, Firebase, etc.)

### OAuth Configuration
Default credentials work out of the box. For production, configure your own:
1. Create OAuth app with provider
2. Set redirect URI: `https://auth.privy.io/api/v1/oauth/callback`
3. Enter credentials in Privy Dashboard → Login Methods → Socials

> ⚠️ Apple, LinkedIn, and TikTok credentials **cannot** be changed once users exist.

---

## Wallets Overview: Non-Custodial vs. Custodial

Privy wallets can be **non-custodial** (default; only the user, via key-splitting and secure enclaves, can reconstitute the private key) or **custodial** (Enterprise plan; managed through a licensed custody partner, currently **Bridge**). Both support the full owners/signers/policy control model.

| | Non-custodial | Custodial |
|---|---|---|
| Key export | Owner can export | **Never** exportable — owner cannot export or unilaterally transact |
| Custody partner | None | e.g. Bridge (KYC'd beneficiary required) |
| Chains | Any EVM/SVM/other Tier chain | Ethereum (creates on **Base**), Solana (mainnet) |
| Owner meaning | Full control incl. export | Authorized controller of policies/signers/operations only — **not** export |
| Transfers | Any transaction type | `/transfer` endpoint only; USDC, USDB, EURC on Base/Solana |

### Digital asset accounts
**Accounts** (gated feature — contact sales@privy.io) group multiple wallets (custodial + non-custodial, multiple chain types) into a single balance unit — e.g., one account per end user, customer, or your treasury. Built on top of wallets; use wallets directly for full API access, or account-level abstractions for balances, DeFi yield, buy/sell/hold, stablecoin orchestration, and webhooks.

```bash
POST https://api.privy.io/v1/accounts
{
  "display_name": "<name>",
  "wallets_configuration": [
    { "chain_type": "ethereum" },
    { "chain_type": "ethereum", "custody": { "provider": "bridge", "provider_user_id": "<id>" } },
    { "chain_type": "solana" }
  ]
  // OR: "wallet_ids": ["<existing-wallet-id>", ...]  (max 5 wallets/account)
}
```
`GET /v1/accounts/{id}` and `PATCH /v1/accounts/{id}` (add wallets / update display name; wallets cannot be removed) are also available. Update wallet-level owners/signers/policies directly via the wallets API.

### Creating a custodial wallet (setup required first)
1. Onboard with custodian (Bridge) and KYC the wallet beneficiary → get their `customerId`.
2. Share your Privy app ID with the Privy team; register Bridge API keys in Dashboard → Integrations → Bridge.
3. Enable the **Custodial wallets** toggle in Dashboard → Wallets → Advanced, select Bridge.

```bash
POST https://api.privy.io/v1/custodial_wallets
{
  "chain_type": "ethereum",       // or "solana"
  "provider": "bridge",
  "provider_user_id": "user_xxxxx", // Bridge customerId post-KYC
  "owner": { "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" },
  "policy_ids": []
}
```

### Sending funds from a custodial wallet
```ts
// Node SDK
const transfer = await privy.wallets().transfer('wallet-id', {
  amount: '10.0',
  source: { asset: 'usdc', chain: 'base' },
  destination: { address: '0xRecipientAddress...' }
});
// transfer.id (wallet action id), transfer.status ('pending' | 'succeeded' | 'rejected' | 'failed')
```
Custodial transfers go through a `custodian_transaction` step (`preparing → custodian_reviewing → pending → confirmed`, or `→ rejected`/`failed`). Poll `GET /v1/wallets/{id}/actions/{action_id}?include=steps` or subscribe to `wallet_action.transfer.*` webhooks. Custodial wallets with an owner/signer require an authorization signature on `/transfer` just like any other wallet action.

---

## Controls: Owners, Signers, Key Quorums, Policies

Privy's control model defines **who can approve actions** (owners/signers/key quorums) and **what actions are allowed** (policies). Enforcement happens inside a secure enclave (TEE) so it can't be bypassed by any single party; some checks (e.g. transaction-amount limits requiring simulation) are enforced at the API layer.

### Owners vs. signers — permission matrix
| Capability | Owner | Signer |
|---|---|---|
| Sign messages / send transactions | ✅ | ✅ (within its policy scope) |
| Update policies | ✅ | ❌ |
| Update owners | ✅ | ❌ |
| Update signers | ✅ | ❌ |
| Export wallet | ✅ | ❌ |
| Can be scoped with policies | ✅ | ✅ |

Rule of thumb for delegation: if **third parties act on behalf of your business**, make your business the owner and each third party a signer. If **your business acts on behalf of a user/third party**, make them the owner and your business a signer.

### Types of owners/signers
1. **Users** — a Privy user ID; owns/acts on wallets on their own behalf. Creating a wallet client-side defaults to a user owner.
2. **Authorization keys** — P-256 keypairs; any holder of the private key can sign requests. Common uses: an app-server key, or a passkey/WebAuthn-based key.
3. **Key quorums** — a mix of users and/or authorization keys (and, one level deep, other key quorums) with an *m-of-n* authorization threshold. A nested quorum counts as a single member of its parent once its own threshold is met. Advanced — used for distributed/multi-party approval.

### Assigning owners/signers (REST)
- `owner`: `{ user_id: '...' }` | `{ public_key: '...' }` (raw authorization key) | pass a key quorum's `id` as `owner_id`.
- `additional_signers`: array of `{ signer_id: <key-quorum-id>, override_policy_ids: [...] }` — lets different signers have different policy scopes on the same wallet.
- Include `\n` for newlines when passing a `public_key` string.
- Once an owner is set, **the owner must sign all updates/deletions of the resource**, and (for wallets) all signature/transaction requests, subject to the wallet's policies.

### Common configuration patterns (non-custodial user wallets)
| Goal | Pattern |
|---|---|
| Fully user-controlled wallet | User owner (default via client SDKs) |
| Offline actions (limit orders, agentic trading, rebalancing) | User owner + an app authorization key as **additional signer**, scoped to a policy |
| Require both user *and* server approval | Wallet owned by an *m-of-k* (m≥2) key quorum containing a user + a server authorization key; both must sign |
| Send transactions from your server by default | User owner; user signs the request client-side (or via a requested user key), then your server relays the signed request to Privy's API |
| Server can export wallet (e.g. self-hosted recovery) | Wallet owned by a *1-of-k* key quorum incl. a user + a server authorization key — the server key alone satisfies the quorum and can export |

### Adding a signer end-to-end (quickstart)
1. Generate an app authorization key: `openssl ecparam -name prime256v1 -genkey -noout -out private.pem && openssl ec -in private.pem -pubout -out public.pem`.
2. Register the public key as a 1-of-1 key quorum in Dashboard → Authorization keys → New key → "Register key quorum instead" (or via `POST /v1/key_quorums`). Save the quorum `id`.
3. Configure `embeddedWallets.ethereum.createOnLogin: 'all-users'` so every user gets a wallet.
4. (Optional) Create a policy for the signer (e.g. time-bound, amount-limited, contract-restricted). Save the policy `id`.
5. Add the signer to the user's wallet:
```tsx
import { useSigners } from '@privy-io/react-auth';
const { addSigners } = useSigners();
await addSigners({
  address: 'user-embedded-wallet-address',
  signers: [{ signerId: 'key-quorum-id', policyIds: ['policy-id-1'] }] // [] = full permission
});
```
6. Your server can now sign/send transactions from the wallet even while the user is offline, by signing requests with the app authorization key's private key and including the signature in the `privy-authorization-signature` header (or via the Node SDK's `authorization_context`).

### Removing signers
```tsx
import { useSigners } from '@privy-io/react-auth'; // or '@privy-io/expo'
const { removeSigners } = useSigners();
await removeSigners({ address: 'wallet-address' }); // removes ALL signers; only user can transact after
```
Swift/Android/Flutter: `wallet.removeSigner(signerId)` or `wallet.removeAllSigners()`. Server-side: `PATCH` the wallet with the updated `additional_signers` array, signed by the owner.

### Authorization keys (creating)
- **Dashboard**: Wallets → Authorization keys → New key. Privy shows the private key once and never stores it — save it securely.
- **Node SDK**: `const { privateKey, publicKey } = await generateP256KeyPair();` (DER format, no headers/footers) — usable directly as an `owner.public_key` or in an authorization context.
- **REST/openssl**: `openssl ecparam -name prime256v1 -genkey -noout -out private.pem && openssl ec -in private.pem -pubout -out public.pem`, then base64-encode the DER public key: `openssl ec -pubin -in public.pem -outform DER | base64`.
- **Passkeys**: register via Dashboard/REST the same way, using the passkey's public key.

### Key quorums (creating and signing)
```ts
// Node SDK — 2-of-2 quorum: an authorization key + a user
const keyQuorum = await privy.keyQuorums().create({
  public_keys: ['authorization-key'],
  user_ids: ['user-id'],
  key_quorum_ids: ['nested-quorum-id'],   // optional, one level deep
  display_name: '2 of 2 Test Key Quorum',
  authorization_threshold: 2
});
```
To **sign with a key quorum**: collect private keys / user JWTs for at least the threshold number of members, sign the request payload with each individually, and pass all signatures **comma-delimited** in the `privy-authorization-signature` header (or via `authorization_context.authorization_private_keys` / `user_jwts` on server SDKs, which signs automatically). Nested-quorum members sign the same way; once their sub-threshold is met, the nested quorum counts as one approval toward the parent.

### Signing requests (authorization signatures)
Any create/update/delete on a Privy resource (wallet, policy, key quorum) — and any signature/transaction request from an owned wallet — must be signed by the owner/signer and passed in the `privy-authorization-signature` header.

**Abstraction levels** (prefer higher levels):
1. **Automatic signing** — client SDKs sign automatically for user-owned wallets (fetches an ephemeral user signing key under the hood; no extra code needed). Server SDKs use an `AuthorizationContext`:
```ts
import { PrivyClient, type AuthorizationContext } from '@privy-io/node';
const privy = new PrivyClient({ appId: '...', appSecret: '...' });
const authorization_context: AuthorizationContext = {
  authorization_private_keys: ['authorization-key'], // and/or
  user_jwts: ['user-jwt'],                           // and/or
  sign_functions: [myKmsSignFn],                     // and/or
  signatures: ['already-computed-signature']
};
const { signature } = await privy.wallets().ethereum().signMessage('wallet-id', {
  message: 'Hello, Ethereum.',
  authorization_context
});
```
2. **Utility functions** — `formatRequestForAuthorizationSignature(input)` serializes a request into canonical bytes (server), and `generateAuthorizationSignature({ input, authorizationPrivateKey })` signs a payload directly — useful when keys live in an external KMS, or for client-side signing of a server-formatted binary payload via `useAuthorizationSignature()`'s `generateAuthorizationSignature`.
3. **Direct implementation** — construct the JSON payload yourself and sign it (RFC 8785 canonicalization); advanced/last resort.

**Signature payload fields**: `version` (`1`), `method` (`POST`/`PUT`/`PATCH`/`DELETE` — GET needs no signature), `url` (no trailing slash), `body`, `headers` (only `privy-`-prefixed headers: `privy-app-id` required, `privy-idempotency-key`/`privy-request-expiry` optional).

### Programmable policies
Policies are enforced primarily inside the secure enclave (some, like simulated transfer-amount limits, at the API layer) and can restrict:
- **Transaction limits** — max transferable amount
- **Approved destinations** — allow-listed recipients
- **Contract interactions** — which contracts/calldata are permitted
- **Action parameters** — which specific operations are allowed, expiry/time-bounds, etc.

Attach via a wallet's `policy_ids` (owner-level) or a signer's `override_policy_ids` (signer-specific scope, set in `additional_signers`). See `/controls/policies/overview` and example policies for Ethereum/Solana/time-bound configs for full syntax.

### Custodial-wallet-specific authorization notes
- The `owner` on a custodial wallet can configure policies/signers and initiate operations, but **cannot export the key or bypass the custodian**; all transactions are still mediated by the custody provider.
- Once an owner/signer exists on a custodial wallet, all `/wallets/{id}/rpc` (and `/transfer`) calls require a `privy-authorization-signature`.
- Custodial wallets support the same policy engine as non-custodial wallets.

---

## Embedded Wallets (Client Usage)

### Create Wallets
**Automatically on login** (via `PrivyProvider` config):
```tsx
embeddedWallets: {
  ethereum: { createOnLogin: 'users-without-wallets' }, // or 'all-users' | 'off'
  solana:   { createOnLogin: 'users-without-wallets' }
}
```

**Manually** via hooks: use `useCreateWallet` from `@privy-io/react-auth` (EVM) or `@privy-io/react-auth/solana` (Solana), or `@privy-io/react-auth/extended-chains` for chains like Cosmos/Stellar/Sui.

### Send Ethereum Transaction
```tsx
import { useSendTransaction } from '@privy-io/react-auth';
const { sendTransaction } = useSendTransaction();

await sendTransaction({
  to: '0xRecipientAddress',
  value: 100000  // in wei
});
```

### Send Solana Transaction
```tsx
import { useSignAndSendTransaction } from '@privy-io/react-auth/solana';
const { signAndSendTransaction } = useSignAndSendTransaction();

await signAndSendTransaction({
  wallet,
  transaction,  // Uint8Array
  chain: 'solana:devnet'
});
```

### Whitelabel (hide Privy's default confirmation UI)
Pass `uiOptions: { showWalletUIs: false }` to `signMessage`/`sendTransaction` calls (or set `embeddedWallets.showWalletUIs: false` globally in `PrivyProvider`) to build fully custom signing/transaction UIs instead of Privy's built-in modals.

### Key React Hooks (v3)
| Hook | Import | Purpose |
|------|--------|---------|
| `usePrivy` | `@privy-io/react-auth` | Auth state, `ready`, `authenticated` |
| `useWallets` | `@privy-io/react-auth` | EVM wallets |
| `useWallets` | `@privy-io/react-auth/solana` | Solana wallets |
| `useSendTransaction` | `@privy-io/react-auth` | Send EVM tx |
| `useSignAndSendTransaction` | `@privy-io/react-auth/solana` | Send Solana tx |
| `useCreateWallet` | per chain entrypoint | Create wallet |
| `useExportWallet` | per chain entrypoint | Export wallet key (non-custodial only) |
| `useSigners` | `@privy-io/react-auth` / `/expo` | `addSigners` / `removeSigners` |
| `useAuthorizationSignature` | `@privy-io/react-auth` / `/expo` | `generateAuthorizationSignature` |
| `useLoginWithEmail` | `@privy-io/react-auth` | Email OTP login |
| `useLoginWithSiws` | `@privy-io/react-auth` | Solana wallet login |

---

## Network Configuration

### EVM Networks
```tsx
import { base, polygon, arbitrum } from 'viem/chains';

<PrivyProvider config={{
  defaultChain: base,
  supportedChains: [base, polygon, arbitrum]
}}>
```

Custom chains via `defineChain` from `viem`. Override RPC with `addRpcUrlOverrideToChain` from `@privy-io/chains`.

**Default supported chains** include: Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Celo, Linea, Zora, and their testnets.

### Solana Networks
```tsx
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

<PrivyProvider config={{
  solana: {
    rpcs: {
      'solana:mainnet': {
        rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
        rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')
      }
    }
  }
}}>
```

### Smart Wallets (EVM account abstraction)
Enable in Dashboard → Smart Wallets (choose Alchemy/Kernel/Biconomy/Safe/Thirdweb/Coinbase Smart Wallet) and configure networks with optional bundler/paymaster URLs (Privy's default bundler is rate-limited — set your own for production).
```tsx
import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';

<PrivyProvider appId="your-privy-app-id">
  <SmartWalletsProvider>{children}</SmartWalletsProvider>
</PrivyProvider>
```
Smart wallets are **lazily deployed** on first transaction by default; the user's embedded wallet is the signer.

---

## UI Appearance Customization

All via `config.appearance` in `PrivyProvider`:

```tsx
<PrivyProvider config={{
  appearance: {
    theme: 'dark',              // 'light' | 'dark' | '#hexcolor'
    logo: 'https://...',        // override dashboard logo
    landingHeader: 'Welcome',   // ≤35 chars
    loginMessage: 'Sign in to continue', // ≤100 chars
    showWalletLoginFirst: false,
  }
}}>
```

**CSS variable overrides** (in `body` CSS):
```css
body {
  --privy-color-accent: #your-brand-color;
  --privy-border-radius-md: 8px;
  --privy-color-background: #ffffff;
  /* see docs for full list */
}
```

Sign-message and send-transaction default UIs also accept `uiOptions` (`title`, `description`, `buttonText`, `transactionInfo`, `successHeader`/`successDescription`, `isCancellable`) to customize copy per call.

---

## Node.js Server SDK

### Setup
```bash
npm install @privy-io/node@latest
```

```ts
import { PrivyClient } from '@privy-io/node';
const privy = new PrivyClient({
  appId: 'your-app-id',
  appSecret: 'your-app-secret'
});
```

### Create Wallet
```ts
const wallet = await privy.wallets().create({ chain_type: 'ethereum' }); // or 'solana'
const walletId = wallet.id;
```

### Sign Message
```ts
// Ethereum
const { signature } = await privy.wallets().ethereum().signMessage(walletId, { message: 'Hello' });

// Solana (base64 encoded)
const base64Msg = Buffer.from('Hello', 'utf8').toString('base64');
const { signature } = await privy.wallets().solana().signMessage(walletId, { message: base64Msg });
```

### Send Transaction
```ts
// Ethereum
const { hash } = await privy.wallets().ethereum().sendTransaction(walletId, {
  caip2: 'eip155:11155111',  // Sepolia
  params: { transaction: { to: recipientAddress, value: '0x1', chain_id: 11155111 } }
});

// Solana
const { hash } = await privy.wallets().solana().signAndSendTransaction(walletId, {
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  transaction: base64EncodedTx
});
```

### Create User
```ts
const user = await privy.users().create({
  linked_accounts: [
    { type: 'email', address: 'user@example.com' },
    { type: 'custom_auth', custom_user_id: 'external-id' }
  ]
});
```

### Error Handling
```ts
import { APIError, PrivyAPIError } from '@privy-io/node';
try {
  // ...
} catch (error) {
  if (error instanceof APIError) {
    console.log(error.status, error.name); // HTTP error
  } else if (error instanceof PrivyAPIError) {
    console.log(error.message); // Privy SDK error
  }
}
```

---

## Migration: v2 → v3 (React SDK)

Key breaking changes:
- `useSolanaWallets` → `useWallets` + `useCreateWallet` + `useExportWallet` from `/solana` entrypoint
- `useSendTransaction` (Solana) → `useSignAndSendTransaction`
- `solanaClusters` config → `config.solana.rpcs` with `createSolanaRpc`
- `embeddedWallets.createOnLogin` → `embeddedWallets.ethereum.createOnLogin` or `embeddedWallets.solana.createOnLogin`
- `detected_wallets` → `detected_ethereum_wallets` / `detected_solana_wallets`
- `useSignAuthorization` → `useSign7702Authorization`
- `useSetWalletPassword` → `useSetWalletRecovery`
- `useLoginToFrame` → `useLoginToMiniApp`
- `verifiedAt` on linked accounts → `firstVerifiedAt` / `latestVerifiedAt`

## Migration: `@privy-io/server-auth` → `@privy-io/node`

```ts
// Old
import { PrivyClient } from '@privy-io/server-auth';
const privy = new PrivyClient('app-id', 'app-secret');
privy.walletApi.createWallet(...)

// New
import { PrivyClient } from '@privy-io/node';
const privy = new PrivyClient({ appId: 'app-id', appSecret: 'app-secret' });
privy.wallets().create(...)
privy.users().create(...)
privy.policies().create(...)
```

---

## Dashboard Quick Reference

- **App ID & Secret**: Dashboard → App Settings
- **Login Methods**: Dashboard → Authentication
- **UI Customization**: Dashboard → UI Components → Branding
- **Authorization keys / key quorums**: Dashboard → Wallets → Authorization keys
- **Custodial wallets**: Dashboard → Wallets → Advanced (toggle + provider)
- **Smart wallets**: Dashboard → Smart Wallets
- **Wallets/Users/Accounts**: Scoped per app
- **Team Roles**: Admin, Developer, Viewer

---

## Common Patterns & Gotchas

1. **`PrivyProvider` must wrap all components** using Privy hooks — put it as close to the root as possible.
2. **Check `ready` before using Privy state** — avoids stale/incorrect state on initial render.
3. **Google OAuth may fail in in-app browsers** (IABs) due to Google restrictions; other providers unaffected.
4. **For production OAuth**, always configure your own credentials (not Privy defaults).
5. **Solana messages must be base64-encoded** when using the Node SDK.
6. **`defaultChain` must be in `supportedChains`** or PrivyProvider throws.
7. **Custom RPC recommended at scale** — Privy's default RPCs (and default bundler for smart wallets) have rate limits suited for development.
8. **Telegram login requires tunneling** (ngrok/Cloudflare) for local dev since domain must be set on the bot.
9. **SMS pricing**: US/Canada included; international requires Scale/Enterprise plan; Twilio costs passed through.
10. **Once an owner is set on a wallet, all writes need a signature** in `privy-authorization-signature` — GET requests are the only exception.
11. **A custodial wallet's `owner` can never export the key or transact unilaterally** — all custodial transactions are mediated by the custody provider (e.g. Bridge) and only support `/transfer` (USDC/USDB/EURC on Base/Solana).
12. **Key quorums**: signatures for a quorum are comma-delimited in one `privy-authorization-signature` header; you need signatures from at least the quorum's authorization threshold.
13. **Digital asset accounts and custodial wallets are gated features** — require Privy sales approval (sales@privy.io) before use.
