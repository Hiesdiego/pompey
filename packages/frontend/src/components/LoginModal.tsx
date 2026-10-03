/**
 * LoginModal — TICKR's fully-custom, on-brand login experience (spec P3.1).
 *
 * "Zero modal" Privy: we never call Privy's own `login()` (which would pop
 * Privy's prebuilt modal). Instead this component drives Privy's headless
 * hooks directly —
 *   • email    → useLoginWithEmail (sendCode / loginWithCode + OTP UI here)
 *   • Google/X → useLoginWithOAuth (initOAuth, a full-page redirect)
 *   • wallet   → usePrivy().connectWallet (Privy's wallet picker)
 *
 * `useTickr().login` is wired to `useLoginModal().open`, so every existing
 * "Sign in" call site opens THIS modal with no further changes.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { usePrivy, useLoginWithEmail, useLoginWithOAuth } from "@privy-io/react-auth";
import { ArrowLeft, Loader2, Mail, Wallet, X } from "lucide-react";
import { cn } from "../lib/cn";

/* ───────────────────────── context ───────────────────────── */

interface LoginModalContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const LoginModalContext = createContext<LoginModalContextValue | null>(null);

export function useLoginModal(): LoginModalContextValue {
  const ctx = useContext(LoginModalContext);
  if (!ctx) throw new Error("useLoginModal must be used within <LoginModalProvider>");
  return ctx;
}

export function LoginModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { authenticated } = usePrivy();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Once Privy reports the user is authenticated, dismiss automatically.
  useEffect(() => {
    if (authenticated) setIsOpen(false);
  }, [authenticated]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <LoginModalContext.Provider value={value}>
      {children}
      {isOpen && <LoginModalView onClose={close} />}
    </LoginModalContext.Provider>
  );
}

/* ───────────────────────── brand provider glyphs ───────────────────────── */

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/* ───────────────────────── modal ───────────────────────── */

function LoginModalView({ onClose }: { onClose: () => void }) {
  const { connectWallet } = usePrivy();
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();

  const [view, setView] = useState<"methods" | "email">("methods");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<"google" | "twitter" | null>(null);
  const [mounted, setMounted] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const status = emailState.status;
  const awaitingCode = status === "awaiting-code-input" || status === "submitting-code";
  const sendingCode = status === "sending-code";
  const verifying = status === "submitting-code";

  // Focus the OTP field as soon as the code has been sent.
  useEffect(() => {
    if (awaitingCode) codeRef.current?.focus();
  }, [awaitingCode]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid || sendingCode) return;
    setErr(null);
    try {
      await sendCode({ email: email.trim() });
    } catch (e) {
      setErr((e as Error)?.message || "Couldn't send the code. Try again.");
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6 || verifying) return;
    setErr(null);
    try {
      await loginWithCode({ code: code.trim() });
    } catch (e) {
      setErr((e as Error)?.message || "That code didn't match. Try again.");
    }
  };

  const handleOAuth = async (provider: "google" | "twitter") => {
    if (oauthPending) return;
    setErr(null);
    setOauthPending(provider);
    try {
      await initOAuth({ provider }); // full-page redirect
    } catch (e) {
      setErr((e as Error)?.message || "Couldn't start sign-in. Try again.");
      setOauthPending(null);
    }
  };

  const handleWallet = () => {
    onClose();
    connectWallet();
  };

  const backToMethods = () => {
    setView("methods");
    setCode("");
    setErr(null);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to TICKR"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-strong animate-page-in relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-6 shadow-2xl sm:rounded-3xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/tickr-logo/v2-rising-t/tickr-token.svg"
            alt="TICKR"
            width={56}
            height={56}
            priority
            className="h-12 w-12 drop-shadow-[0_0_18px_rgba(46,124,246,.4)]"
          />
          {view === "methods" ? (
            <>
              <h2 className="mt-3 font-display text-xl font-bold text-zinc-900 dark:text-white">
                Welcome to <span className="text-gradient">TICKR</span>
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Predict. Stake. Climb the table.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-3 font-display text-xl font-bold text-zinc-900 dark:text-white">
                Check your inbox
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {awaitingCode ? (
                  <>
                    We sent a 6-digit code to{" "}
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200">{email}</span>
                  </>
                ) : (
                  "Enter your email and we'll send you a one-time code."
                )}
              </p>
            </>
          )}
        </div>

        {err && (
          <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-600 dark:text-red-400">
            {err}
          </p>
        )}

        {/* ── Method selection ── */}
        {view === "methods" && (
          <div className="space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setView("email");
              }}
            >
              <label htmlFor="login-email" className="sr-only">
                Email address
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white/60 py-2.5 pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#2E7CF6]/60 focus:ring-2 focus:ring-[#2E7CF6]/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!emailValid}
                  className="gradient-cta shrink-0 rounded-xl px-4 py-2.5 font-display text-sm font-bold disabled:opacity-40"
                >
                  Continue
                </button>
              </div>
            </form>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">or</span>
              <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
            </div>

            <button
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={!!oauthPending}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-black/10 bg-white/60 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-[#2E7CF6]/40 hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              {oauthPending === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => handleOAuth("twitter")}
              disabled={!!oauthPending}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-black/10 bg-white/60 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-[#2E7CF6]/40 hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              {oauthPending === "twitter" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XIcon />}
              Continue with X
            </button>

            <button
              type="button"
              onClick={handleWallet}
              disabled={!!oauthPending}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-black/10 bg-white/60 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-[#2E7CF6]/40 hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              <Wallet className="h-4 w-4" />
              Continue with a wallet
            </button>
          </div>
        )}

        {/* ── Email OTP ── */}
        {view === "email" && (
          <div className="space-y-3">
            {!awaitingCode ? (
              <form onSubmit={handleSendCode} className="space-y-3">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white/60 py-2.5 pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#2E7CF6]/60 focus:ring-2 focus:ring-[#2E7CF6]/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!emailValid || sendingCode}
                  className="gradient-cta flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-display text-sm font-bold disabled:opacity-40"
                >
                  {sendingCode && <Loader2 className="h-4 w-4 animate-spin" />}
                  {sendingCode ? "Sending code…" : "Send code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerify} className="space-y-3">
                <label htmlFor="login-code" className="sr-only">
                  6-digit code
                </label>
                <input
                  id="login-code"
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="······"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-black/10 bg-white/60 py-3 text-center font-display text-2xl font-bold tracking-[0.5em] text-zinc-900 outline-none transition-colors placeholder:text-zinc-300 focus:border-[#2E7CF6]/60 focus:ring-2 focus:ring-[#2E7CF6]/20 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600"
                />
                <button
                  type="submit"
                  disabled={code.trim().length < 6 || verifying}
                  className="gradient-cta flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-display text-sm font-bold disabled:opacity-40"
                >
                  {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {verifying ? "Verifying…" : "Verify & sign in"}
                </button>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode}
                  className="w-full text-center text-xs font-medium text-zinc-500 transition-colors hover:text-[#2E7CF6] disabled:opacity-50 dark:text-zinc-400"
                >
                  {sendingCode ? "Resending…" : "Resend code"}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={backToMethods}
              className="flex w-full items-center justify-center gap-1.5 text-center text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Other sign-in options
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          By continuing you agree to TICKR&apos;s Terms and acknowledge our Privacy Policy.
        </p>
      </div>
    </div>,
    document.body
  );
}
