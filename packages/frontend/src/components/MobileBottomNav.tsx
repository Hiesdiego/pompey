"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, House, Plus, Trophy, UserRound } from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useMyProfile } from "../hooks/useMyProfile";
import { cn } from "../lib/cn";

const items = [
  { href: "/", label: "Home", icon: House },
  { href: "/standings", label: "League", icon: Trophy },
  { href: "/markets", label: "Markets", icon: ChartNoAxesCombined },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { authenticated, login } = useTickr();
  const { profile } = useMyProfile();
  const profileHref = profile?.username ? `/${encodeURIComponent(profile.username)}` : null;
  const profileActive = profileHref ? pathname === profileHref : false;
  const linkClass = (active: boolean) => cn(
    "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] font-semibold transition-colors active:scale-95",
    active ? "text-[#1D4ED8] dark:text-[#7db3ff]" : "text-zinc-500 dark:text-zinc-400"
  );

  return (
    <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl md:hidden dark:border-white/10 dark:bg-[#101722]/95">
      <div className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-5 items-center px-2">
        {items.slice(0, 2).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname === href;
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={linkClass(active)}><Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} /><span>{label}</span></Link>;
        })}
        <Link href="/markets/create" aria-label="Create market" aria-current={pathname === "/markets/create" ? "page" : undefined} className="relative -mt-5 flex flex-col items-center gap-1 text-[10px] font-bold text-[#1D4ED8] dark:text-[#7db3ff]">
          <span className="grid h-14 w-14 place-items-center rounded-full border-4 border-white bg-gradient-to-b from-[#4B93FF] to-[#1D4ED8] text-white shadow-[0_8px_22px_rgba(46,124,246,0.45)] transition-transform active:scale-95 dark:border-[#101722]"><Plus className="h-7 w-7" strokeWidth={2.5} /></span>
          <span>Create</span>
        </Link>
        {items.slice(2).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (pathname.startsWith(`${href}/`) && pathname !== "/markets/create");
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={linkClass(active)}><Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} /><span>{label}</span></Link>;
        })}
        {profileHref ? (
          <Link href={profileHref} aria-current={profileActive ? "page" : undefined} className={linkClass(profileActive)}><UserRound className="h-5 w-5" strokeWidth={profileActive ? 2.5 : 2} /><span>Profile</span></Link>
        ) : (
          <button type="button" onClick={authenticated ? () => window.dispatchEvent(new Event("tickr:open-account-menu")) : login} className={linkClass(false)}><UserRound className="h-5 w-5" /><span>Profile</span></button>
        )}
      </div>
    </nav>
  );
}
