"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LEGAL_VERSION } from "../lib/legal";
import { SEASON_DISPLAY_NAME } from "../lib/contracts";

type GateState = "checking" | "required" | "accepted" | "error";

export function LegalGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const pathname = usePathname();
  const [state, setState] = useState<GateState>("checking");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [adult, setAdult] = useState(false);
  const [eligibleLocation, setEligibleLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const check = useCallback(async (): Promise<boolean> => {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session could not be verified.");
    const response = await fetch("/api/legal/acceptance", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Could not check your agreement. Try again.");
    const data = await response.json() as { accepted: boolean };
    return data.accepted;
  }, [getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id) { setState("checking"); return; }
    let active = true;
    setState("checking"); setTerms(false); setPrivacy(false); setAdult(false); setEligibleLocation(false); setMessage("");
    void check().then((accepted) => { if (active) setState(accepted ? "accepted" : "required"); })
      .catch(() => { if (active) { setState("error"); setMessage("Could not check your agreement. Try again."); } });
    return () => { active = false; };
  }, [ready, authenticated, user?.id, check]);

  if (!ready) return null;
  if (!authenticated) return children;
  if (pathname === "/terms" || pathname === "/privacy") return children;
  if (state === "accepted") return children;

  const accept = async () => {
    if (!terms || !privacy || !adult || !eligibleLocation || saving) return;
    setSaving(true); setMessage("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session could not be verified.");
      const response = await fetch("/api/legal/acceptance", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ terms, privacy, adult, eligibleLocation, version: LEGAL_VERSION }),
      });
      if (!response.ok) throw new Error("Could not save your agreement. Try again.");
      setState("accepted");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save your agreement."); }
    finally { setSaving(false); }
  };

  return <main className="grid min-h-screen place-items-center bg-[#07132b] px-4 py-10 text-white">
    <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#10234b] p-6 shadow-2xl sm:p-9" aria-labelledby="legal-title">
      <p className="text-xs font-black uppercase tracking-[.2em] text-blue-300">TICKR · {SEASON_DISPLAY_NAME}</p>
      <h1 id="legal-title" className="mt-3 font-display text-3xl font-black">Before you continue</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/70">Please review the current Terms of Use and Privacy Notice. This applies to returning players too.</p>
      {state === "checking" ? <p className="mt-7 text-sm text-white/70">Checking your agreement…</p> : <>
        <div className="mt-6 space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2E7CF6]" /><span>I have read and agree to the <Link href="/terms" target="_blank" className="font-bold text-blue-300 underline">Terms of Use</Link>.</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2E7CF6]" /><span>I have read and acknowledge the <Link href="/privacy" target="_blank" className="font-bold text-blue-300 underline">Privacy Notice</Link>.</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2E7CF6]" /><span>I am at least 18 and meet the minimum age required where I am.</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={eligibleLocation} onChange={(e) => setEligibleLocation(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2E7CF6]" /><span>I am in a location where my participation in fantasy gaming and prediction markets is permitted.</span></label>
        </div>
        {message && <p role="alert" className="mt-4 text-sm text-amber-300">{message}</p>}
        <button type="button" onClick={() => void accept()} disabled={!terms || !privacy || !adult || !eligibleLocation || saving || state === "error"} className="mt-6 w-full rounded-xl bg-[#2E7CF6] px-4 py-3 text-sm font-bold disabled:opacity-40">{saving ? "Saving…" : "Agree and continue"}</button>
        {state === "error" && <button type="button" onClick={() => { setState("checking"); void check().then((accepted) => setState(accepted ? "accepted" : "required")).catch(() => { setState("error"); setMessage("Could not check your agreement. Try again."); }); }} className="mt-3 w-full text-sm font-semibold text-blue-300">Retry check</button>}
        <button type="button" onClick={() => void logout()} className="mt-4 w-full text-sm font-semibold text-white/70 hover:text-white">Decline and sign out</button>
      </>}
    </section>
  </main>;
}
