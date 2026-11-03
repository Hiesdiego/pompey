import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommentaryShare } from "@/lib/commentaryShareServer";
import { commentaryPaths } from "@/lib/commentaryShare";
import { siteUrl } from "@/lib/siteUrl";

type Props = { params: Promise<{ matchId: string; lineId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId, lineId } = await params;
  const data = await getCommentaryShare(matchId, lineId);
  if (!data) return { title: "Commentary not found" };
  const paths = commentaryPaths(matchId, lineId);
  const title = `${data.speaker}: ${data.title} | TICKR`;
  const description = `“${data.line.text}” — ${data.speaker}, ${data.line.minute}′. Follow the Crypto Price World Cup on @tickrbase.`;
  const images = [{ url: `${siteUrl()}${paths.image}`, width: 1200, height: 630, alt: `${data.title}. ${data.speaker}: ${data.line.text}` }];
  return { title, description, alternates: { canonical: `${siteUrl()}${paths.page}` }, openGraph: { type: "article", title, description, url: `${siteUrl()}${paths.page}`, images }, twitter: { card: "summary_large_image", site: "@tickrbase", creator: "@tickrbase", title, description, images } };
}

export default async function CommentarySharePage({ params }: Props) {
  const { matchId, lineId } = await params;
  const data = await getCommentaryShare(matchId, lineId);
  if (!data) notFound();
  return <main className="mx-auto max-w-4xl py-8">
    <p className="mb-3 text-xs font-bold uppercase tracking-[.2em] text-amber-600">TICKR World Cup · From the booth</p>
    <h1 className="mb-6 font-display text-2xl font-black">{data.title}</h1>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={commentaryPaths(matchId, lineId).image} width={1200} height={630} alt={`${data.speaker} at ${data.line.minute} minutes: ${data.line.text}`} className="w-full rounded-2xl border border-amber-400/30 shadow-2xl" />
    <blockquote className="my-6 text-lg leading-relaxed">“{data.line.text}”<footer className="mt-2 text-sm text-zinc-500">{data.speaker} · {data.line.minute}′</footer></blockquote>
    <Link href={`/cup/match/${matchId}`} className="inline-flex rounded-xl bg-amber-400 px-6 py-3 font-bold text-black hover:bg-amber-300">Open game →</Link>
  </main>;
}
