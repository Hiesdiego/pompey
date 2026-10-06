import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_VERSION } from "../../lib/legal";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return <article className="mx-auto max-w-3xl space-y-8 py-10 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
    <header><p className="text-xs font-bold uppercase tracking-widest text-[#2E7CF6]">Effective {LEGAL_VERSION}</p><h1 className="mt-2 font-display text-4xl font-black text-zinc-950 dark:text-white">TICKR Terms of Use</h1><p className="mt-3">These terms apply when you sign in to or use TICKR, operated by the TICKR team. Please read the <Link href="/privacy" className="text-[#2E7CF6] underline">Privacy Notice</Link> too.</p></header>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Using TICKR</h2><p>TICKR is a crypto price prediction game. The current build operates on a test network. TICK tokens used here have no monetary value and are not redeemable for cash through TICKR. You must use the service lawfully and must not exploit, automate abuse of, or interfere with the app, its contracts, or other players.</p></section>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Wallets and transactions</h2><p>When you confirm a stake, claim, or other blockchain action, it may be recorded on a public network and cannot normally be reversed. Check the transaction details before confirming. You are responsible for access to your account and wallet. TICKR may sponsor transaction fees, but sponsorship may change or be unavailable.</p></section>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Results and availability</h2><p>Match and market outcomes follow the deployed smart contracts and their price inputs. Quotes, odds, schedules, and displayed estimates can change. Network congestion, third party services, or software faults can delay or interrupt the app. We may fix errors, pause features, or change the game as needed.</p></section>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Profiles and conduct</h2><p>Your username, bio, market activity, and onchain transactions may be public. Do not impersonate others, post unlawful or abusive material, or use the service to harm others. We may restrict access for misuse, subject to applicable law.</p></section>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Changes and stopping use</h2><p>We may update these terms and ask you to accept a new version before continuing. You can decline or stop using TICKR and sign out. Onchain records remain on the network even after you stop using the app.</p></section>
    <section><h2 className="text-xl font-bold text-zinc-950 dark:text-white">Contact</h2><p>Contact the TICKR team at <a href="https://x.com/tickrtop" target="_blank" rel="noopener noreferrer" className="text-[#2E7CF6] underline">@tickrtop on X</a> with questions about these terms.</p></section>
  </article>;
}
