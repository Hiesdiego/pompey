"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Link2, LoaderCircle, Share2, X } from "lucide-react";
import { commentaryPaths, commentator, type CommentaryLine } from "@/lib/commentaryShare";
import { siteUrl } from "@/lib/siteUrl";

function XLogo() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.4-8.5L.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" /></svg>;
}

export function CupCommentaryShare({ matchId, line }: { matchId: number; line: CommentaryLine }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label={`Share ${commentator(line.voice)} commentary at ${line.minute} minutes`} onClick={() => setOpen(true)} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-400/30 bg-gradient-to-br from-amber-300/20 to-amber-500/5 px-3 text-[11px] font-bold text-amber-800 shadow-sm transition-all hover:border-amber-400 hover:bg-amber-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:text-amber-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
      <Share2 className="h-3.5 w-3.5" /> Share
    </button>
    {open && createPortal(<ShareDialog matchId={matchId} line={line} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function ShareDialog({ matchId, line, onClose }: { matchId: number; line: CommentaryLine; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const paths = commentaryPaths(matchId, line.id);
  const url = `${siteUrl()}${paths.page}`;
  const speaker = commentator(line.voice);
  const excerpt = Array.from(line.text);
  const text = `${speaker} ${line.minute}′: “${excerpt.slice(0, 160).join("")}${excerpt.length > 160 ? "…" : ""}”\n\nFrom the @tickrbase World Cup booth.`;
  const intent = `https://x.com/intent/tweet?${new URLSearchParams({ text, url })}`;
  const canShareFile = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30000);
    let disposed = false;
    let objectUrl: string | undefined;
    setError(false); setImage(null); setFile(null);
    void (async () => {
      try {
        const response = await fetch(paths.image, { signal: controller.signal });
        if (!response.ok || !response.headers.get("Content-Type")?.includes("image/png")) throw new Error("Card unavailable");
        const blob = await response.blob();
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
        setFile(new File([blob], `tickr-${speaker.toLowerCase()}-${matchId}-${line.minute}.png`, { type: "image/png" }));
      } catch { if (!disposed) setError(true); }
      finally { window.clearTimeout(timer); }
    })();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [paths.image, attempt, speaker, matchId, line.minute]);

  async function shareImage() {
    if (!file) return;
    setSharing(true); setMessage("");
    try { await navigator.share({ files: [file], title: "TICKR World Cup commentary", text, url }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setMessage("Sharing is unavailable here. Save the PNG or use Share on X."); }
    finally { setSharing(false); }
  }

  return <dialog ref={dialog} aria-labelledby="commentary-share-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl border border-amber-400/30 bg-[#14120e] p-0 text-white shadow-[0_32px_120px_#0009] backdrop:bg-black/75 backdrop:backdrop-blur-sm">
    <div className="h-1 bg-gradient-to-r from-amber-700 via-amber-200 to-amber-700" />
    <div className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.24em] text-amber-300">Straight from the booth</p><h2 id="commentary-share-title" className="mt-1 font-display text-2xl font-black">A moment worth sharing.</h2><p className="mt-2 text-sm text-zinc-400">{speaker} · {line.minute}′ · TICKR World Cup</p></div><button autoFocus type="button" onClick={onClose} aria-label="Close share preview" className="rounded-full p-2 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-300"><X className="h-5 w-5" /></button></div>
      <div className="overflow-hidden rounded-xl border border-amber-400/20 bg-black/20">
        {image ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} width={1200} height={630} alt={`${speaker}: ${line.text}`} className="h-auto w-full" /></> : <div className="flex aspect-[1200/630] flex-col items-center justify-center gap-3 px-5 text-center" role="status">{error ? <><p className="text-sm text-amber-100">The card couldn’t be created. Please try again.</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-bold text-amber-300">Try again</button></> : <><LoaderCircle className="h-7 w-7 animate-spin text-amber-300" /><p className="text-sm text-zinc-400">Creating your match-day card…</p></>}</div>}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={!image || !file} onClick={() => { if (!image || !file) return; const anchor = document.createElement("a"); anchor.href = image; anchor.download = file.name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-3 text-sm font-extrabold text-black transition hover:brightness-110 disabled:opacity-40"><Download className="h-4 w-4" /> Save PNG</button>
        <a href={intent} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-bold hover:bg-white/10"><XLogo /> Share on X</a>
        {canShareFile && <button type="button" disabled={sharing} onClick={() => void shareImage()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-sm font-bold hover:bg-white/10 disabled:opacity-40"><Share2 className="h-4 w-4" /> Share image</button>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4"><p className="max-w-lg text-xs leading-relaxed text-zinc-400">X shares a link with this card and a way to open the game. To attach the picture directly, save the PNG and add it to your post.</p><button type="button" aria-label="Copy commentary link" onClick={async () => { try { await navigator.clipboard.writeText(url); setMessage("Link copied."); } catch { setMessage("Could not copy the link. Use Share on X instead."); } }} className="shrink-0 rounded-lg p-2 text-amber-300 hover:bg-white/10"><Link2 className="h-4 w-4" /></button></div>
      <p role="status" className="mt-2 text-xs text-amber-200">{message}</p>
    </div>
  </dialog>;
}
