"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Menu, Search, X } from "lucide-react";
import { docs, groups } from "../lib/content";

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { setMobileOpen(false); setSearchOpen(false); }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const results = docs.filter(d => `${d.title} ${d.description} ${d.group} ${d.sections.map(s => `${s.title} ${s.paragraphs.join(" ")}`).join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  return <div className="shell">
    <header className="topbar">
      <div style={{display:"flex",alignItems:"center",gap:12}}><button className="mobile-nav" aria-label="Open navigation" onClick={() => setMobileOpen(v => !v)}>{mobileOpen ? <X size={20}/> : <Menu size={20}/>}</button><Link href="/" className="brand"><img className="brand-mark" src="/tickr-icon.svg" alt=""/><span>TICKR</span><span className="brand-separator"/><span className="brand-docs">Docs</span></Link></div>
      <div className="top-actions"><button className="search-trigger" onClick={() => {setQuery("");setSearchOpen(true)}} aria-label="Search documentation"><Search size={15}/><span>Search documentation...</span><kbd>⌘ K</kbd></button><a className="top-link" href="https://tickrbase.top/roadmap">Roadmap</a><a className="top-cta" href="https://tickrbase.top">Open app <ArrowUpRight size={14} style={{verticalAlign:"middle"}}/></a></div>
    </header>
    <div className={`mobile-overlay ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)}/>
    <div className="layout"><aside className={`sidebar ${mobileOpen ? "open" : ""}`}><p className="sidebar-label">Documentation</p>{groups.map(group => <div className="nav-group" key={group}><div className="nav-heading">{group}</div>{docs.filter(doc => doc.group === group).map(doc => <Link className={`nav-item ${pathname === `/${doc.slug}` ? "active" : ""}`} key={doc.slug} href={`/${doc.slug}`}>{doc.title}</Link>)}</div>)}<div className="sidebar-bottom">Built for curious players and independent verifiers.<br/>Tickr is currently on Base Sepolia.</div></aside><main className="main">{children}</main></div>
    {searchOpen && <div className="search-backdrop" onMouseDown={e => {if(e.target === e.currentTarget) setSearchOpen(false)}}><div className="search-modal" role="dialog" aria-modal="true" aria-label="Search documentation"><input autoFocus className="search-input" placeholder="Search rules, prices, contracts..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {if(e.key === "Enter" && results[0]) router.push(`/${results[0].slug}`)}}/><div className="search-results">{results.length ? results.map(doc => <Link className="search-result" href={`/${doc.slug}`} key={doc.slug}><strong>{doc.title}</strong><small>{doc.description}</small></Link>) : <div className="search-empty">No results. Try “price”, “payout”, or “contract”.</div>}</div></div></div>}
  </div>;
}
