/**
 * Footer — carries the mandatory "Powered by CoinGecko" attribution
 * (CoinGecko free-tier requirement) plus testnet disclaimer.
 */

export function Footer() {
  return (
    <footer className="mt-16 border-t border-zinc-800/80 bg-[#0b0b0d]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-sm font-bold text-zinc-300">
          TICKR <span className="font-normal text-zinc-500">— crypto price prediction league</span>
        </p>
        <p className="max-w-xl text-xs leading-relaxed text-zinc-500">
          Testnet build. TICK has no monetary value. Match outcomes are derived from
          real cryptocurrency price performance over fixed windows. Price data and
          token logos by CoinGecko.
        </p>
        <p className="text-xs text-zinc-500">
          Price data by{" "}
          <a
            href="https://www.coingecko.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white"
          >
            CoinGecko
          </a>
        </p>
      </div>
    </footer>
  );
}
