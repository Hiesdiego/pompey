import type { ReactNode } from "react";
import { tickrWordmark } from "./_wordmark";
import { OG_WIDTH, OG_HEIGHT } from "./_shared";

export function Card({ children, gold = false }: { children: ReactNode; gold?: boolean }) {
  return <div style={{ width: OG_WIDTH, height: OG_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 52, color: "#fff", fontFamily: "system-ui, sans-serif", background: gold ? "radial-gradient(ellipse at 90% 10%, #73501b 0%, #231d12 45%, #090b10 100%)" : "radial-gradient(ellipse at 90% 10%, #174c91 0%, #101e3a 45%, #070c18 100%)", border: `2px solid ${gold ? "#a88138" : "#294d7b"}`, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", right: -110, top: 100, width: 560, height: 560, borderRadius: 999, border: `1px solid ${gold ? "#a8813855" : "#589aff33"}`, display: "flex" }} />
    <div style={{ position: "absolute", right: -50, top: 160, width: 440, height: 440, borderRadius: 999, border: `1px solid ${gold ? "#a8813855" : "#589aff33"}`, display: "flex" }} />
    {children}
  </div>;
}

export function Brand({ gold = false }: { gold?: boolean }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
    <img src={tickrWordmark} width={154} height={81} alt="TICKR" />
    <div style={{ display: "flex", flexDirection: "column", gap: 7, color: gold ? "#f5d58a" : "#9ac2ff", fontSize: 18, letterSpacing: 2 }}><span>CRYPTO PRICE</span><span>PREDICTION LEAGUE</span></div>
  </div>;
}

export type CoinArt = { symbol: string; logo: string | null; detail?: string };
export function Coins({ coins, gold = false }: { coins: CoinArt[]; gold?: boolean }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
    {coins.map((coin, i) => <div key={`${coin.symbol}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: coins.length === 1 ? 190 : 100, height: coins.length === 1 ? 190 : 100, borderRadius: 999, background: gold ? "#302511" : "#152c50", border: `2px solid ${gold ? "#b18b42" : "#5487bb"}`, fontSize: 34 }}>
        {coin.logo ? <img src={coin.logo} width={coins.length === 1 ? 170 : 88} height={coins.length === 1 ? 170 : 88} style={{ borderRadius: 999 }} alt={coin.symbol} /> : <span>{coin.symbol.slice(0, 5)}</span>}
      </div>
      <span style={{ fontSize: 23, fontWeight: 800 }}>{coin.symbol}</span>
      {coin.detail && <span style={{ fontSize: 18, color: "#9ac2ff" }}>{coin.detail}</span>}
    </div>)}
  </div>;
}
