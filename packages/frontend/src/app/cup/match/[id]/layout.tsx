import type { Metadata } from "next";
import { cupMatch } from "../../../api/social/og/_cup";
import { siteUrl } from "@/lib/siteUrl";
import { CUP_STATE, cupTeamName } from "@/lib/cup";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const match = await cupMatch(id);
  const settled = match?.state === CUP_STATE.Settled;
  const title = match ? `${cupTeamName(match.teamA)} ${settled ? `${match.goalsA}–${match.goalsB}` : "vs"} ${cupTeamName(match.teamB)} — TICKR World Cup` : "Crypto Price World Cup — TICKR";
  const description = settled ? `Full time. ${cupTeamName(match.winner)} wins. Crypto Price World Cup.` : "Crypto Price World Cup. Back your team. Climb the table.";
  const url = `${siteUrl()}/cup/match/${encodeURIComponent(id)}`;
  const image = `${siteUrl()}/api/social/og/cup/${encodeURIComponent(id)}?v=2`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: "TICKR", type: "website", images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default function CupMatchLayout({ children }: { children: React.ReactNode }) { return children; }
