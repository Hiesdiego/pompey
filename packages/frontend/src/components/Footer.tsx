import Image from "next/image";
import Link from "next/link";
import { backendUrl } from "../app/api/social/og/_shared";

/**
 * Footer — carries the mandatory "Powered by CoinGecko" attribution
 * (CoinGecko free-tier requirement) plus testnet disclaimer.
 */

type FooterLink = { href: string; label: string; sortAt: number };

async function getDynamicLinks(): Promise<FooterLink[]> {
  const base = backendUrl();
  const options = { next: { revalidate: 300 }, signal: AbortSignal.timeout(3_000) };

  const [fixturesResult, marketsResult] = await Promise.allSettled([
    fetch(`${base}/api/fixtures`, options).then((res) => res.ok ? res.json() : []),
    fetch(`${base}/api/chain/markets`, options).then((res) => res.ok ? res.json() : null),
  ]);

  const links: FooterLink[] = [];
  if (fixturesResult.status === "fulfilled" && Array.isArray(fixturesResult.value)) {
    for (const fixture of fixturesResult.value) {
      if (!fixture || fixture.settled || fixture.voided || !fixture.home?.name || !fixture.away?.name) continue;
      links.push({
        href: `/match/${encodeURIComponent(String(fixture.fixtureId))}`,
        label: `${fixture.home.name} vs ${fixture.away.name}`,
        sortAt: (Date.parse(fixture.kickoff ?? fixture.scheduledKickoff ?? fixture.windowStart ?? "") || Number.MAX_SAFE_INTEGER) / 1000,
      });
    }
  }

  if (marketsResult.status === "fulfilled") {
    const markets = marketsResult.value?.data?.markets;
    if (Array.isArray(markets)) {
      const now = Math.floor(Date.now() / 1000);
      const templateNames = ["Matchday Top Gainer", "Season Champion", "Head-to-Head", "Price Target", "Spread"];
      for (const market of markets) {
        if (!market || market.state !== 0 || Number(market.bettingCloseTime) <= now) continue;
        const templateName = templateNames[market.templateId] ?? "Prediction Market";
        links.push({
          href: `/markets/${encodeURIComponent(String(market.id))}`,
          label: `${templateName} #${market.id}`,
          sortAt: Number(market.bettingCloseTime),
        });
      }
    }
  }

  return links.sort((a, b) => a.sortAt - b.sortAt).slice(0, 5);
}

export async function Footer() {
  const dynamicLinks = await getDynamicLinks();
  return (
    <footer className="mt-16 border-t border-black/8 bg-white/40 backdrop-blur-xl dark:border-white/8 dark:bg-black/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <Image
            src="/tickr-logo/v2-rising-t/tickr-wordmark-dark.svg"
            alt="TICKR"
            width={138}
            height={72}
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/tickr-logo/v2-rising-t/tickr-wordmark-light.svg"
            alt=""
            width={138}
            height={72}
            aria-hidden="true"
            className="hidden h-8 w-auto dark:block"
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-500">
            Crypto price prediction league
          </span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-zinc-500">
          <Link href="/about" className="transition-colors hover:text-[#2E7CF6]">About</Link>
          <Link href="/how-to-play" className="transition-colors hover:text-[#2E7CF6]">How to play</Link>
          <Link href="/roadmap" className="transition-colors hover:text-[#2E7CF6]">Roadmap</Link>
          <Link href="/fixtures" className="transition-colors hover:text-[#2E7CF6]">Fixtures</Link>
          <Link href="/markets" className="transition-colors hover:text-[#2E7CF6]">Markets</Link>
          <Link href="/terms" className="transition-colors hover:text-[#2E7CF6]">Terms</Link>
          <Link href="/privacy" className="transition-colors hover:text-[#2E7CF6]">Privacy</Link>
          <a href="mailto:contact@tickrbase.top" className="transition-colors hover:text-[#2E7CF6]">Contact</a>
          <a href="https://x.com/tickrtop" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[#2E7CF6]">Follow on X</a>
        </nav>
        {dynamicLinks.length > 0 && (
          <nav aria-label="Featured matches and markets" className="flex max-w-4xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
            {dynamicLinks.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-[#2E7CF6]">
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <p className="max-w-xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
          Testnet build. TICK has no monetary value. Match outcomes are derived from
          real cryptocurrency price performance over fixed windows. Price data and
          token logos by CoinGecko.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Price data by{" "}
          <a
            href="https://www.coingecko.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-[#2E7CF6] dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:text-white"
          >
            CoinGecko
          </a>
        </p>
      </div>
    </footer>
  );
}
