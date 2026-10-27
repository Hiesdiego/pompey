import { ImageResponse } from "next/og";

export const alt = "Tickr Docs — Every rule. Every price. Every result.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, color: "#f4f7fb", background: "linear-gradient(135deg, #080b12 0%, #102346 65%, #173d7b 100%)", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 34, fontWeight: 800, letterSpacing: -2 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#3b82f6", display: "flex", justifyContent: "center", alignItems: "center", fontSize: 32 }}>T</div>TICKR <span style={{ color: "#9ab6dc", fontWeight: 400 }}>/ Docs</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}><div style={{ color: "#82b5ff", fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>The official guide</div><div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 800, lineHeight: 1.1, letterSpacing: -4 }}><span>Every rule. Every price.</span><span>Every result.</span></div></div>
      <div style={{ color: "#b7c8e2", fontSize: 24 }}>Learn the game · Verify the outcome · Explore the contracts</div>
    </div>,
    size
  );
}
