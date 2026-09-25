/**
 * Footer — carries the mandatory "Powered by CoinGecko" attribution
 * (CoinGecko free-tier requirement) plus testnet disclaimer.
 */

export function Footer() {
  return (
    <footer className="mt-16 border-t border-black/8 bg-white/40 backdrop-blur-xl dark:border-white/8 dark:bg-black/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="font-display text-sm font-bold text-zinc-800 dark:text-zinc-200">
          TICKR{" "}
          <span className="font-normal text-zinc-500 dark:text-zinc-500">
            — crypto price prediction league
          </span>
        </p>
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
