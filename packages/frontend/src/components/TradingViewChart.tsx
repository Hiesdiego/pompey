"use client";

import { useEffect, useRef } from "react";
import { getTeamById } from "@tickr/shared/teams";
import { cupChartSymbol, cupTeamName } from "../lib/cup";
import { CUP_TARGET_ORACLE_OFFSET, targetCoinById } from "../lib/targetCoins";

export function TradingViewChart({ teamId, height = 220, cup = false }: { teamId: number; height?: number; cup?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const team = getTeamById(teamId);
  const targetCupTeamId = teamId >= CUP_TARGET_ORACLE_OFFSET ? targetCoinById(teamId)?.cupTeamId : undefined;
  const symbol = cup ? cupChartSymbol(teamId) : targetCupTeamId !== undefined ? cupChartSymbol(targetCupTeamId) : team ? `BINANCE:${team.binanceSymbol}` : null;
  const name = cup ? cupTeamName(teamId) : targetCupTeamId !== undefined ? cupTeamName(targetCupTeamId) : team?.name;

  useEffect(() => {
    const root = container.current;
    if (!root || !symbol) return;
    root.replaceChildren();
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval: "5",
      range: "1D",
      timezone: "Etc/UTC",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      style: "3",
      locale: "en",
      hide_top_toolbar: true,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    root.appendChild(script);
    return () => root.replaceChildren();
  }, [symbol]);

  if (!name || !symbol) return null;
  return <div>
    <div className="overflow-hidden rounded-xl" style={{ height }} aria-label={`${name} TradingView price chart`}>
      <div ref={container} className="h-full w-full" />
    </div>
    <a className="mt-1 inline-block text-[11px] text-[#2E7CF6] hover:underline" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer">Open chart in TradingView</a>
  </div>;
}
