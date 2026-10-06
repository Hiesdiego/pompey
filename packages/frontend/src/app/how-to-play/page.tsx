import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to play — TICKR",
  description:
    "From your first login to your first payout: the complete guide to playing TICKR.",
};

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-5 border-b border-black/[.06] py-8 dark:border-white/[.07]">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#2E7CF6]/10 font-display text-lg font-black text-[#2E7CF6]">
        {n}
      </div>
      <div>
        <h3 className="font-display text-xl font-extrabold text-zinc-950 dark:text-white">
          {title}
        </h3>
        <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {children}
        </div>
      </div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#2E7CF6]/20 bg-[#2E7CF6]/[.05] px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      <span className="font-extrabold text-[#2E7CF6]">Tip — </span>
      {children}
    </div>
  );
}

export default function HowToPlayPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-10">
      <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
        Guide
      </p>
      <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-zinc-950 dark:text-white sm:text-5xl">
        How to play TICKR.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
        Six steps from zero to your first payout. No crypto experience needed —
        if you can follow a football league, you can play TICKR.
      </p>

      <div className="mt-6">
        <Step n="1" title="Log in — your wallet is created for you">
          <P>
            Hit <strong className="text-zinc-900 dark:text-white">Log in</strong> and
            sign in with email or Google. TICKR automatically creates a{" "}
            <strong className="text-zinc-900 dark:text-white">smart wallet</strong> for
            you — a real on-chain wallet, no seed phrase to lose, no extension
            to install.
          </P>
          <P>
            Pick a username and a favourite team. Your username can only be
            changed once per season, so choose well.
          </P>
        </Step>

        <Step n="2" title="Get TICK">
          <P>
            <strong className="text-zinc-900 dark:text-white">TICK</strong> is the
            league’s staking token. You need it to play. On testnet, claim from
            the faucet; on mainnet, you’ll acquire it through the listed venues.
          </P>
          <Tip>
            TICK has no price feed and is never pegged to anything — it’s purely
            the league’s staking currency. 1 TICK staked is 1 TICK of exposure,
            nothing more.
          </Tip>
        </Step>

        <Step n="3" title="Pick a fixture">
          <P>
            Browse <Link href="/fixtures" className="font-semibold text-[#2E7CF6] hover:underline">Fixtures</Link> or
            the home page. Each card shows the two coins, kickoff countdown, and
            the current live score once underway. Tap any fixture for its match
            page: head-to-head form, live price moves, and the stake panel.
          </P>
          <P>
            You can stake on any fixture until betting closes —{" "}
            <strong className="text-zinc-900 dark:text-white">5 minutes before full time</strong> for
            in-play matches. No last-second sniping.
          </P>
        </Step>

        <Step n="4" title="Stake on an outcome">
          <P>
            Choose <strong className="text-zinc-900 dark:text-white">Home win</strong>,{" "}
            <strong className="text-zinc-900 dark:text-white">Draw</strong>, or{" "}
            <strong className="text-zinc-900 dark:text-white">Away win</strong>, enter
            your TICK amount, and confirm. Your stake goes straight into the
            on-chain pool — the app never holds your funds.
          </P>
          <P>
            Your potential payout is proportional: your share of the winning
            outcome’s stakes determines your share of the whole pool (minus the
            treasury fee). The more lopsided the pool is against your pick, the
            bigger your multiple.
          </P>
          <Tip>
            Quick-stake chips on any card let you stake in two taps. Stakes below
            the confirmation threshold go through instantly; larger ones ask you
            to confirm first.
          </Tip>
        </Step>

        <Step n="5" title="Watch it play out">
          <P>
            During the match window, the score updates live from real price
            feeds: every 0.5% move is a goal. Follow the league table as results
            come in — 3 points for a win, 1 for a draw.
          </P>
          <P>
            When the window ends, the oracle submits the final prices, the
            contract computes the official scoreline, and the fixture settles.
            This usually finalizes within minutes of full time.
          </P>
        </Step>

        <Step n="6" title="Claim your payout">
          <P>
            If your outcome won, a <strong className="text-zinc-900 dark:text-white">Claim payout</strong> button
            appears on the match page. One tap sends your winnings — stake plus
            your share of the losers’ pool, minus the treasury fee — to your
            wallet. Gas is sponsored, so claiming costs you nothing.
          </P>
          <P>
            If you lost, you’ll see <strong className="text-zinc-900 dark:text-white">Record result</strong> instead —
            an honest receipt, not a fake payout button. Your pick is still
            recorded on your public profile.
          </P>
        </Step>
      </div>

      <section className="py-12">
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
          Beyond the basics
        </p>
        <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white">
          More ways to play
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            {
              t: "Prediction markets",
              d: "Five templates — top gainer, season champion, head-to-head, price target, fixture spread. Anyone can create one and back an outcome.",
              href: "/markets",
            },
            {
              t: "In-play staking",
              d: "Stakes stay open while the match is live, closing 5 minutes before full time. Read the momentum, time your entry.",
              href: "/fixtures",
            },
            {
              t: "Share your picks",
              d: "Every match and market has a share card for X, Telegram, and WhatsApp. Put your record on the line publicly.",
              href: "/markets",
            },
            {
              t: "Track your private rank",
              d: "Each correct resolved market earns 3 points. Your rank appears only on your own profile.",
              href: "/markets",
            },
          ].map((c) => (
            <Link
              key={c.t}
              href={c.href}
              className="group rounded-3xl border border-black/[.06] bg-white/60 p-5 transition-all hover:-translate-y-0.5 hover:border-[#2E7CF6]/40 dark:border-white/[.07] dark:bg-white/[.025]"
            >
              <h3 className="font-display text-base font-extrabold text-zinc-900 group-hover:text-[#2E7CF6] dark:text-white">
                {c.t}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {c.d}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-black/[.06] py-12 dark:border-white/[.07]">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white">
          The fine print
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <li>Testnet build — TICK has no monetary value.</li>
          <li>Stakes are locked once the betting window closes; there are no refunds for losing picks.</li>
          <li>If a winning outcome has no stakers, the entire pool goes to the treasury (no refunds) — this is by design.</li>
          <li>Markets can be voided only under the conditions encoded in their template; voided stakes are reclaimable.</li>
          <li>Outcomes are derived from real price feeds and settled on-chain — <Link href="/about#audit" className="font-semibold text-[#2E7CF6] hover:underline">auditable by anyone</Link>.</li>
        </ul>
        <div className="mt-8">
          <Link
            href="/fixtures"
            className="rounded-2xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-3 font-display text-sm font-extrabold text-white shadow-[0_0_24px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_36px_rgba(46,124,246,.55)]"
          >
            Pick your first fixture
          </Link>
        </div>
      </section>
    </div>
  );
}
