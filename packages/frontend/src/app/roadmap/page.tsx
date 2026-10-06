import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Roadmap — TICKR",
  description:
    "The TICKR whitepaper roadmap: from testnet beta to stable mainnet, TICK tokenomics, and the features that get us there.",
};

function Phase({
  n,
  title,
  status,
  children,
}: {
  n: string;
  title: string;
  status: "live" | "current" | "upcoming";
  children: React.ReactNode;
}) {
  const badge =
    status === "live"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "current"
        ? "bg-[#2E7CF6]/10 text-[#2E7CF6]"
        : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400";
  const label =
    status === "live" ? "Complete" : status === "current" ? "In progress" : "Planned";
  return (
    <div className="border-b border-black/[.06] py-10 dark:border-white/[.07]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#2E7CF6]/10 font-display text-lg font-black text-[#2E7CF6]">
          {n}
        </span>
        <div>
          <h3 className="font-display text-xl font-extrabold text-zinc-950 dark:text-white">
            {title}
          </h3>
        </div>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider ${badge}`}
        >
          {label}
        </span>
      </div>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E7CF6]" />
      <span>{children}</span>
    </li>
  );
}

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-10">
      <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
        Whitepaper
      </p>
      <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-zinc-950 dark:text-white sm:text-5xl">
        The road to mainnet.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
        TICKR is being built in the open, in four phases — from today’s testnet
        beta to a stable mainnet league economy with real tokenomics,
        governance, and an ecosystem of leagues. This page is the living plan.
      </p>

      <section className="border-b border-black/[.06] py-12 dark:border-white/[.07]">
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
          Vision
        </p>
        <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">
          The thesis
        </h2>
        <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <P>
            Prediction markets today are casinos with charts. TICKR’s bet is
            different: <strong className="text-zinc-900 dark:text-white">people don’t want to bet — they want to
            belong to a season.</strong> The table, the rivalries, the
            championship race, the agony of a 90th-minute goal — that emotional
            grammar is what keeps hundreds of millions watching football every
            week. TICKR ports it, intact, onto verifiable crypto price action.
          </P>
          <P>
            If the league format wins, the endgame is an open ecosystem: anyone
            can run a league (any assets, any cadence, sponsored or community),
            creators earn from the markets they list, and TICK — the staking
            token — becomes the settlement currency of on-chain sports
            entertainment. This roadmap is how we get there without skipping the
            hard parts: correct settlement, real decentralization, and an economy
            that survives contact with mainnet.
          </P>
        </div>
      </section>

      <section className="py-4">
        <p className="pt-8 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
          Phases
        </p>

        <Phase n="1" title="Beta launch — testnet phase" status="live">
          <P>
            The league goes live on Base Sepolia: 20 coins, 380 fixtures, the
            full settlement pipeline (oracle → engine → table → payouts), five
            permissionless market templates, social layer with profiles and
            private player ranks.
          </P>
          <ul className="space-y-2">
            <Li>Core contracts deployed, audited internally, battle-tested with real fixtures</Li>
            <Li>Smart-wallet onboarding — no seed phrases, gasless transactions</Li>
            <Li>Public beta: anyone can play, stake, create markets, and audit settlements</Li>
          </ul>
        </Phase>

        <Phase n="2" title="Testnet hardening" status="current">
          <P>
            Where we are now. Every lesson from the beta becomes a guardrail
            before real value is at stake:
          </P>
          <ul className="space-y-2">
            <Li>Settlement verification — dual-source price checks and pre-submit simulation on every fixture</Li>
            <Li>Full auditability — anyone can recompute any result from on-chain events</Li>
            <Li>UX at Polymarket-beating bar: instant staking, live scores, shareable pick cards</Li>
            <Li>Load and resilience — RPC failover, backend redundancy, settlement monitoring</Li>
          </ul>
          <P>
            Nothing ships to mainnet until the testnet runs a full season with
            zero settlement disputes.
          </P>
        </Phase>

        <Phase n="3" title="Mainnet Alpha — H1 2027" status="upcoming">
          <P>
            TICKR launches on Base mainnet alongside the real{" "}
            <strong className="text-zinc-900 dark:text-white">TICK token</strong>:
          </P>
          <ul className="space-y-2">
            <Li><strong className="text-zinc-900 dark:text-white">TICK token launch</strong> — the staking currency goes live with real value; distribution rewards early testnet participants and league contributors</Li>
            <Li><strong className="text-zinc-900 dark:text-white">Flexible staking</strong> — TICK remains the primary staking token, with support planned for Base-native tokens and wrapped coins as alternative stake currencies</Li>
            <Li>Mainnet season one: the first real-money championship</Li>
            <Li>Creator revenue share — market creators earn a cut of their markets’ treasury fees</Li>
          </ul>
        </Phase>

        <Phase n="4" title="Stable mainnet" status="upcoming">
          <P>The league becomes an ecosystem:</P>
          <ul className="space-y-2">
            <Li><strong className="text-zinc-900 dark:text-white">More leagues</strong> — beyond the 20-coin format: community-run leagues, different asset universes, custom cadences</Li>
            <Li><strong className="text-zinc-900 dark:text-white">Sponsored league campaigns</strong> — brands and protocols sponsor seasons, prize pools, and branded markets</Li>
            <Li><strong className="text-zinc-900 dark:text-white">Mobile app</strong> — native iOS/Android with push notifications for kickoffs, goals, and payouts</Li>
            <Li><strong className="text-zinc-900 dark:text-white">Governance</strong> — TICK holders vote on league parameters, new templates, fee structures, and treasury use</Li>
          </ul>
        </Phase>
      </section>

      <section className="border-b border-black/[.06] py-12 dark:border-white/[.07]">
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
          Tokenomics
        </p>
        <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">
          The TICK token
        </h2>
        <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <P>
            <strong className="text-zinc-900 dark:text-white">TICK is the staking currency of the league.</strong> Every
            fixture stake, every market position, every payout is denominated in
            TICK. Demand for TICK is demand to play — it scales with seasons,
            fixtures, and markets, not speculation.
          </P>
          <P>
            <strong className="text-zinc-900 dark:text-white">Value accrual.</strong> Treasury fees from every pool
            (a cut of winners’ payouts, plus entire pools where a winning
            outcome had no stakers) flow to the protocol treasury. On mainnet,
            governance decides the split between buyback-and-burn, staker
            rewards, and ecosystem funding.
          </P>
          <P>
            <strong className="text-zinc-900 dark:text-white">Flexible staking.</strong> TICK remains the primary
            staking token, but the protocol is being designed so leagues can
            optionally accept Base-native tokens and wrapped coins — widening
            the funnel without fragmenting liquidity.
          </P>
          <P>
            <strong className="text-zinc-900 dark:text-white">Distribution.</strong> Full tokenomics — supply,
            allocation, vesting — will be published ahead of the Phase 3 launch.
            Testnet participants and early contributors are first in line.
          </P>
        </div>
      </section>

      <section className="py-12">
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
          Principles
        </p>
        <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">
          What won’t change
        </h2>
        <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <Li><strong className="text-zinc-900 dark:text-white">Settlement stays verifiable.</strong> No phase introduces a result you can’t recompute yourself.</Li>
          <Li><strong className="text-zinc-900 dark:text-white">Funds stay non-custodial.</strong> Stakes live in contracts, never in company wallets.</Li>
          <Li><strong className="text-zinc-900 dark:text-white">Market creation stays permissionless.</strong> Growth comes from the community listing markets, not a central calendar.</Li>
          <Li><strong className="text-zinc-900 dark:text-white">Testnet first, always.</strong> Every mainnet feature ships on testnet first and earns its way over.</Li>
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/about"
            className="rounded-2xl border border-black/[.1] px-6 py-3 font-display text-sm font-extrabold text-zinc-700 transition-colors hover:border-[#2E7CF6]/40 hover:text-[#2E7CF6] dark:border-white/[.12] dark:text-zinc-300"
          >
            How TICKR works
          </Link>
          <Link
            href="/how-to-play"
            className="rounded-2xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-3 font-display text-sm font-extrabold text-white shadow-[0_0_24px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_36px_rgba(46,124,246,.55)]"
          >
            Start playing
          </Link>
        </div>
      </section>
    </div>
  );
}
