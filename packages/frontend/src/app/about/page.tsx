import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — TICKR",
  description:
    "What TICKR is, how scoring and private predictor ranks work, how to audit results, and why it's decentralized.",
};

function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-black/[.06] py-12 dark:border-white/[.07]">
      <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
        {kicker}
      </p>
      <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">
        {title}
      </h2>
      <div className="prose-tickr mt-5">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
      {children}
    </p>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-black/[.06] bg-black/[.02] px-5 py-4 dark:border-white/[.07] dark:bg-white/[.025]">
      <code className="whitespace-nowrap font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
        {children}
      </code>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-10">
      <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#2E7CF6]">
        About TICKR
      </p>
      <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-zinc-950 dark:text-white sm:text-5xl">
        The crypto price prediction league.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
        Twenty cryptocurrencies compete as football teams. Their “goals” are real
        price moves. You stake TICK on the outcomes — and everything, from the
        scoreline to the payout, is verifiable on-chain.
      </p>

      <nav
        aria-label="About sections"
        className="mt-8 flex flex-wrap gap-2"
      >
        {[
          ["what", "What is TICKR"],
          ["scoring", "Match scoring"],
          ["leaderboards", "Rankings"],
          ["audit", "Private audits"],
          ["decentralized", "Decentralization"],
          ["difference", "Why TICKR"],
        ].map(([id, label]) => (
          <Link
            key={id}
            href={`#${id}`}
            className="rounded-full border border-black/[.08] px-4 py-2 text-xs font-bold text-zinc-600 transition-colors hover:border-[#2E7CF6]/40 hover:text-[#2E7CF6] dark:border-white/[.1] dark:text-zinc-400"
          >
            {label}
          </Link>
        ))}
      </nav>

      <Section id="what" kicker="01 — Concept" title="What is TICKR?">
        <P>
          TICKR is a prediction league where <strong className="text-zinc-900 dark:text-white">20 cryptocurrencies play a football season against each other</strong>.
          Each “fixture” pits two coins head-to-head — say SOL vs NEAR — over a
          fixed time window. Whichever coin’s price performs better during that
          window “scores more goals” and wins the match.
        </P>
        <P>
          You participate by <strong className="text-zinc-900 dark:text-white">staking TICK</strong>, the league’s native token,
          on match outcomes (home win, draw, away win) or on community-created
          prediction markets. Winners split the losing side’s stakes, minus a
          small treasury fee. Everything settles on-chain — no bookmaker, no
          custodian, no trust required.
        </P>
        <P>
          A season runs 38 matchdays with 380 fixtures. The league table uses
          standard football scoring — 3 points for a win, 1 for a draw — and the
          team with the most points at the end of the season is champion.
        </P>
        <P>
          Beyond the main league, anyone can create <strong className="text-zinc-900 dark:text-white">permissionless prediction markets</strong> on
          anything: which coin gains the most on a matchday, head-to-head
          outperformances, price targets, or fixture spreads. If you can define
          the resolution rule, you can list the market.
        </P>
      </Section>

      <Section id="scoring" kicker="02 — Rules" title="How match scoring works">
        <P>
          A fixture’s scoreline is derived entirely from the two coins’ price
          performance between kickoff and full time. Here is the exact math the
          smart contracts use — the same math you can run yourself to audit any
          result (see <Link href="#audit" className="font-semibold text-[#2E7CF6] hover:underline">Private audits</Link>).
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Step 1 — Percentage move to goals
        </h3>
        <P>
          Each coin’s price change over the match window is converted to basis
          points (1% = 100 bps), then to goals at <strong className="text-zinc-900 dark:text-white">1 goal = 50 bps (0.5%)</strong>,
          rounded half-up:
        </P>
        <Formula>
          {`goals = round_half_up(bps / 50)`}
        </Formula>
        <P>
          So a +1.0% move scores 2 goals, +0.4% scores 1 goal, and anything under
          ±0.25% scores 0. The 0.5%-per-goal unit keeps the rounding dead zone
          tiny — roughly a quarter of a percent — so narrow wins still count.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Step 2 — No negative scorelines
        </h3>
        <P>
          Raw goals can be negative (a coin that drops 1% scores −2). TICKR never
          shows negative scorelines: each side’s negative goals are transferred
          to the opponent as plus-goals. Equal negatives cancel out.
        </P>
        <Formula>
          {`G_home = max(0, r_home) + max(0, -r_away)`}<br />
          {`G_away = max(0, r_away) + max(0, -r_home)`}
        </Formula>
        <P>
          Examples: <code className="font-mono text-[13px]">0 : −1</code> becomes{" "}
          <code className="font-mono text-[13px]">1–0</code>;{" "}
          <code className="font-mono text-[13px]">−2 : −2</code> becomes{" "}
          <code className="font-mono text-[13px]">2–2</code>;{" "}
          <code className="font-mono text-[13px]">−3 : −1</code> becomes{" "}
          <code className="font-mono text-[13px]">1–3</code>. This is
          margin-preserving — outcomes, points, and goal differences are
          identical to the raw computation; only the presentation changes.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Step 3 — Outcome and table
        </h3>
        <P>
          More goals wins. Equal goals is a draw. The league table awards{" "}
          <strong className="text-zinc-900 dark:text-white">3 points for a win, 1 for a draw, 0 for a loss</strong>,
          with goal difference as the tiebreaker — exactly like real football.
        </P>
      </Section>

      <Section id="leaderboards" kicker="03 — Rankings" title="How rankings work">
        <P>
          The coin league table is public. Each predictor sees their own private rank on their profile.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Main league table
        </h3>
        <P>
          The 20 coins ranked by the season’s results: played, won, drawn, lost,
          goals for/against, and points (3/1/0). This table lives{" "}
          <strong className="text-zinc-900 dark:text-white">on-chain</strong> in the ResultEngine contract —
          it is written by the settlement transaction itself, so it can never
          disagree with the official results.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Your predictor rank
        </h3>
        <P>
          Correct picks in resolved markets earn 3 points. A market counts once even if you backed it repeatedly or chose multiple outcomes. Open and voided markets do not count. Ties share a rank; only you can see your rank.
        </P>
        <P>
          Profiles show public market activity. Your rank and financial analytics are visible only when viewing your own account.
        </P>
      </Section>

      <Section id="audit" kicker="04 — Trustless" title="Run your own private audit">
        <P>
          You don’t have to trust TICKR’s backend, frontend, or operators. Every
          settlement is independently reproducible from public on-chain data:
        </P>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="text-zinc-900 dark:text-white">Read the settlement event.</strong> Each fixture’s
            settlement emits <code className="font-mono text-[13px]">EndPriceSubmitted</code> on the
            PriceOracle, containing the exact start/end prices, the computed
            goals, and the outcome the contract recorded.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Recompute the scoreline.</strong> Apply the scoring
            math from the section above to the emitted prices, using integer
            arithmetic (basis points, 50 bps per goal, half-up rounding, then
            the no-negative normalization). Any spreadsheet or ten lines of
            Python will do.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Compare.</strong> Your computed goals and outcome must
            exactly match the event’s. If they ever don’t, the settlement is
            provably wrong — and the evidence is permanently on-chain for
            everyone to see.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Check the payouts.</strong> The PredictionPool’s{" "}
            <code className="font-mono text-[13px]">winningOutcome</code> must equal the event’s outcome,
            and winners’ claims must match their proportional share of the pool
            minus the treasury fee.
          </li>
        </ol>
        <P>
          The backend itself runs this verification before every settlement —
          simulating the transaction and aborting if its independent computation
          disagrees. But the design doesn’t require you to trust that it does:
          the audit path above works with nothing but a block explorer and the
          published scoring rules.
        </P>
      </Section>

      <Section id="decentralized" kicker="05 — Architecture" title="The decentralized nature of TICKR">
        <P>
          “Decentralized” is an overused word. Here is what it concretely means
          for TICKR, layer by layer:
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Settlement is on-chain and permissionless to verify
        </h3>
        <P>
          Match results, the league table, market outcomes, and payouts are all
          computed and stored by smart contracts on Base. The backend is an{" "}
          <strong className="text-zinc-900 dark:text-white">operator, not an authority</strong>: it submits price
          snapshots and triggers settlement, but it cannot invent a result —
          the contracts enforce the scoring math, and every input it submits is
          emitted as a public event anyone can re-derive the outcome from.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Funds are never custodied
        </h3>
        <P>
          Your TICK never leaves your control until the moment you stake, and
          stakes go directly into the PredictionPool contract — not a company
          wallet. Payouts are claimed from the contract by you, for you. There
          is no withdrawal queue, no approval department, no “contact support to
          release your funds.”
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          Market creation is permissionless
        </h3>
        <P>
          Anyone can list a prediction market by calling the MarketFactory —
          no listing committee, no gatekeeper. The contract enforces the
          economics (creation fee becomes seed liquidity, duplicate terms are
          rejected, resolution follows the template’s rules), but the{" "}
          <em>decision</em> of what deserves a market belongs to the community.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          The frontend is a view, not the system
        </h3>
        <P>
          The website you’re reading is one interface among many possible ones.
          Every action it offers — staking, claiming, creating markets — is a
          direct contract call you could equally make from a script, a different
          frontend, or a block explorer. If this site disappeared tomorrow, your
          stakes, your claims, and the league itself would be untouched on-chain.
        </P>
        <h3 className="mt-6 font-display text-lg font-bold text-zinc-900 dark:text-white">
          What’s still centralized (honestly)
        </h3>
        <P>
          The price feed operator (the backend submitting oracle snapshots) and
          the domain/hosting of this frontend are currently run by the TICKR
          team. The mitigation is transparency, not pretense: every submitted
          price is on-chain and auditable (see above), and the contracts are
          designed so that a malicious or faulty operator can be{" "}
          <em>detected</em> by anyone — which is the practical meaning of
          trustlessness here.
        </P>
      </Section>

      <Section id="difference" kicker="06 — Edge" title="What TICKR offers that no one else does">
        <ul className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="text-zinc-900 dark:text-white">A league, not a casino.</strong> Polymarket and Kalshi
            sell you isolated binary bets. TICKR gives you a <em>season</em> —
            a table, rivalries, form, a championship race. Your SOL isn’t just a
            ticker; it’s a team you follow for 38 matchdays.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Football-native scoring on real price action.</strong>{" "}
            Goals, goal difference, 3-points-for-a-win — the entire emotional
            grammar of football, driven by verifiable market data instead of
            someone kicking a ball.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Provably fair settlement.</strong> Every result can be
            recomputed by anyone from on-chain events with published integer
            math. No “official data provider” whose feed you must take on faith.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Permissionless markets with on-chain resolution.</strong>{" "}
            Five market templates (top gainer, champion, head-to-head, price
            target, fixture spread) that anyone can list and that resolve
            without human judges.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-white">Social prediction graph.</strong> Public profiles,
            shareable pick cards, and private predictor ranks turn staking into
            a social game — your record is your reputation.
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/how-to-play"
            className="rounded-2xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-3 font-display text-sm font-extrabold text-white shadow-[0_0_24px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_36px_rgba(46,124,246,.55)]"
          >
            Learn how to play
          </Link>
          <Link
            href="/roadmap"
            className="rounded-2xl border border-black/[.1] px-6 py-3 font-display text-sm font-extrabold text-zinc-700 transition-colors hover:border-[#2E7CF6]/40 hover:text-[#2E7CF6] dark:border-white/[.12] dark:text-zinc-300"
          >
            Read the roadmap
          </Link>
        </div>
      </Section>
    </div>
  );
}
