"use client";
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function CupXShare({ walletAddress, marketKind, marketId }: { walletAddress: string; marketKind: "match" | "spread" | "outright"; marketId: number }) {
  const { getAccessToken } = usePrivy();
  const [postUrl, setPostUrl] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setStatus("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to submit your post.");
      const response = await fetch("/api/social/cup-share", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ walletAddress, marketKind, marketId, postUrl }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error === "prediction_not_indexed" ? "Your prediction is still being indexed. Try again shortly." : body.error === "post_already_used" ? "That X post was already used for another Cup prediction." : "Could not record the X post. Check the post URL and try again.");
      }
      setStatus("X post recorded. Your WC point will update shortly.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not record the X post."); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 rounded-xl border border-amber-400/20 p-4 text-sm"><p className="font-bold">Share your Cup pick on X · +1 TP</p><p className="mt-1 text-xs text-zinc-500">After posting, paste the public X post URL. One link counts per Cup market.</p><div className="mt-3 flex flex-wrap gap-2"><input aria-label="X post URL" type="url" value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://x.com/you/status/…" className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/15" /><button type="button" onClick={() => void save()} disabled={saving || !postUrl} className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-black disabled:opacity-50">{saving ? "Saving…" : "Record post"}</button></div>{status && <p role="status" className="mt-2 text-xs">{status}</p>}</div>;
}
