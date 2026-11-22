import type { Metadata } from "next";
import { backendUrl, isNumericId, siteUrl } from "../../../api/social/og/_shared";

export const revalidate = 60;

// One clash as served by GET /api/arena/clashes/:id, the detail
// endpoint in the backend arena router (api/arenaRoutes.ts). The
// route answers { ok: true, data: { clash, userPosition? } }, the
// same envelope as the stock market detail, and the clash itself is
// the ArenaClashSummary from services/arenaClashReader.ts. Only the
// fields the metadata needs are declared here.
interface ArenaClashMetadata {
  memeSymbol?: string;
  opponentSymbol?: string;
  windowDuration?: number;
}

// The clash question, verbatim shape from the locked Arena spec and
// arenaClashQuestion in lib/arenaContracts.ts: "Will [MEME]
// outperform [OPPONENT] over the next 24 hours?", with blitz windows
// reading "in the next hour". The formatter is mirrored here rather
// than imported because this layout, like the stock match layout,
// stays on the _shared helpers alone and never pulls the client API
// layer into metadata generation. Symbols are trimmed and upper
// cased, exactly as arenaDisplaySymbol does.
function clashQuestion(clash: ArenaClashMetadata): string | null {
  const meme = clash.memeSymbol?.trim().toUpperCase();
  const opponent = clash.opponentSymbol?.trim().toUpperCase();
  if (!meme || !opponent) return null;
  if (clash.windowDuration === 3600) {
    return `Will ${meme} outperform ${opponent} in the next hour?`;
  }
  return `Will ${meme} outperform ${opponent} over the next 24 hours?`;
}

// Mirrors marketQuestion in app/markets/[id]/layout.tsx and the
// fetch in app/stocks/match/[id]/layout.tsx: a server side backend
// read via backendUrl() from app/api/social/og/_shared, guarded by
// isNumericId, with the same try/catch fallback to null, which keeps
// the generic metadata fallback below intact when the backend is
// unavailable or the clash does not exist.
async function clashQuestionFor(id: string): Promise<string | null> {
  try {
    if (!isNumericId(id)) return null;
    const response = await fetch(`${backendUrl()}/api/arena/clashes/${id}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as
      | { data?: { clash?: ArenaClashMetadata } }
      | { clash?: ArenaClashMetadata }
      | ArenaClashMetadata;
    const clash =
      "data" in payload && payload.data
        ? payload.data.clash
        : "clash" in payload
          ? payload.clash
          : (payload as ArenaClashMetadata);
    if (!clash) return null;
    return clashQuestion(clash);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  const question = await clashQuestionFor(id);
  const title = question ? `${question} — TICKR` : `Clash ${id} — TICKR`;
  const description = question
    ? `${question} Predict meme prices on TICKR.`
    : "Stock Meme Arena on TICKR.";

  const safeId = encodeURIComponent(id);
  const ogImage = `${site}/api/social/og/clash/${safeId}?v=2&title=${encodeURIComponent(question ?? "TICKR prediction market")}`;
  const url = `${site}/arena/clash/${safeId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "TICKR",
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    alternates: { canonical: url },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function ArenaClashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
