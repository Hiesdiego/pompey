import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsShell } from "../../components/DocsShell";
import { docs, getDoc } from "../../lib/content";

const docsUrl = (process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.tickrbase.top").replace(/\/$/, "");

export function generateStaticParams() { return docs.map(d => ({ slug: d.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  if (!doc) return {};
  const title = `${doc.title} | Tickr Docs`;
  const url = `${docsUrl}/${doc.slug}`;
  const description = `${doc.description} Explore ${doc.sections.slice(0, 2).map(section => section.title.toLowerCase()).join(" and ")} in the official Tickr guide.`;
  return {
    title: doc.title,
    description,
    keywords: ["Tickr", "Tickr docs", doc.title, doc.group, ...doc.sections.map(section => section.title)],
    alternates: { canonical: url },
    openGraph: { type: "article", url, siteName: "Tickr Docs", title, description, images: [{ url: `${docsUrl}/opengraph-image`, width: 1200, height: 630, alt: "Tickr documentation" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${docsUrl}/opengraph-image`] },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = getDoc((await params).slug);
  if (!doc) notFound();
  const index = docs.findIndex(d => d.slug === doc.slug);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: doc.title,
    description: doc.description,
    mainEntityOfPage: `${docsUrl}/${doc.slug}`,
    inLanguage: "en",
    author: { "@type": "Organization", name: "Tickr" },
    publisher: { "@type": "Organization", name: "Tickr", url: "https://tickrbase.top" },
  };
  return <DocsShell><div className="doc-layout"><article className="article">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <div className="breadcrumbs"><Link href="/">Docs</Link><span>›</span><span>{doc.group}</span><span>›</span><span style={{ color: "#bdcce0" }}>{doc.title}</span></div>
    <h1>{doc.title}</h1><p className="article-lead">{doc.description}</p><div className="article-meta">{doc.readTime} read · Tickr documentation</div>
    {doc.sections.map(section => <section id={section.id} key={section.id}><h2>{section.title}</h2>
      {section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {section.bullets && <ul>{section.bullets.map(b => <li key={b}>{b}</li>)}</ul>}
      {section.links && <div className="contract-list">{section.links.map(link => <a className="contract-link" href={`https://sepolia.basescan.org/address/${link.address}`} target="_blank" rel="noopener noreferrer" key={link.address}><strong>{link.label} ↗</strong><span>{link.description}</span><code>{link.address}</code></a>)}</div>}
      {section.code && <pre className="code">{section.code}</pre>}
      {section.note && <div className="callout"><strong>Good to know</strong>{section.note}</div>}
    </section>)}
    <div className="doc-footer"><div>{index > 0 && <Link href={`/${docs[index - 1].slug}`}>← {docs[index - 1].title}</Link>}</div><div>{index < docs.length - 1 && <Link href={`/${docs[index + 1].slug}`}>{docs[index + 1].title} →</Link>}</div></div>
  </article><aside className="toc"><h3>On this page</h3>{doc.sections.map(s => <a href={`#${s.id}`} key={s.id}>{s.title}</a>)}</aside></div></DocsShell>;
}
