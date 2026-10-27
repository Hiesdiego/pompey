import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsShell } from "../../components/DocsShell";
import { docs, getDoc } from "../../lib/content";

export function generateStaticParams() { return docs.map(d => ({slug:d.slug})); }
export async function generateMetadata({ params }: { params: Promise<{slug:string}> }): Promise<Metadata> { const doc=getDoc((await params).slug); return doc ? {title:doc.title,description:doc.description,alternates:{canonical:`/${doc.slug}`}} : {}; }
export default async function DocPage({ params }: { params: Promise<{slug:string}> }) {
  const doc=getDoc((await params).slug); if(!doc) notFound();
  const index=docs.findIndex(d=>d.slug===doc.slug);
  return <DocsShell><div className="doc-layout"><article className="article"><div className="breadcrumbs"><Link href="/">Docs</Link><span>›</span><span>{doc.group}</span><span>›</span><span style={{color:"#bdcce0"}}>{doc.title}</span></div><h1>{doc.title}</h1><p className="article-lead">{doc.description}</p><div className="article-meta">{doc.readTime} read · Tickr documentation</div>{doc.sections.map(section=><section id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs.map((p,i)=><p key={i}>{p}</p>)}{section.bullets&&<ul>{section.bullets.map(b=><li key={b}>{b}</li>)}</ul>}{section.code&&<pre className="code">{section.code}</pre>}{section.note&&<div className="callout"><strong>Good to know</strong>{section.note}</div>}</section>)}<div className="doc-footer"><div>{index>0&&<Link href={`/${docs[index-1].slug}`}>← {docs[index-1].title}</Link>}</div><div>{index<docs.length-1&&<Link href={`/${docs[index+1].slug}`}>{docs[index+1].title} →</Link>}</div></div></article><aside className="toc"><h3>On this page</h3>{doc.sections.map(s=><a href={`#${s.id}`} key={s.id}>{s.title}</a>)}</aside></div></DocsShell>;
}
