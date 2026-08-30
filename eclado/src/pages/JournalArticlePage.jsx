import React, { useEffect } from 'react';
import { JOURNAL_ARTICLES, JOURNAL_DISCLAIMER, getJournalArticle } from '../data/journalArticles.js';
import useDocumentMeta from '../hooks/useDocumentMeta.js';

export default function JournalArticlePage({ articleSlug, onBack, onOpenArticle }) {
  const article = getJournalArticle(articleSlug);
  useDocumentMeta(article ? `${article.title}｜ECLADO 保養專欄` : '找不到文章｜ECLADO', article?.seoDescription || 'ECLADO 保養專欄');

  useEffect(() => { window.scrollTo({ top:0, left:0, behavior:'auto' }); }, [articleSlug]);

  if (!article) {
    return (
      <main style={{ minHeight:'70vh', padding:'150px 24px 100px', textAlign:'center' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:38, fontWeight:300, marginBottom:20 }}>找不到此文章</h1>
        <button onClick={onBack} style={{ border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', padding:'12px 24px', cursor:'pointer' }}>返回保養專欄</button>
      </main>
    );
  }

  const currentIndex = JOURNAL_ARTICLES.findIndex(item => item.slug === article.slug);
  const previous = currentIndex > 0 ? JOURNAL_ARTICLES[currentIndex - 1] : null;
  const next = currentIndex < JOURNAL_ARTICLES.length - 1 ? JOURNAL_ARTICLES[currentIndex + 1] : null;
  const related = JOURNAL_ARTICLES.filter(item => item.slug !== article.slug).slice(0, 3);

  return (
    <main style={{ background:'var(--white)', minHeight:'100vh', paddingTop:68 }}>
      <article>
        <header style={{ maxWidth:900, margin:'0 auto', padding:'70px 24px 48px', textAlign:'center' }}>
          <button onClick={onBack} style={{ background:'none', border:'none', borderBottom:'1px solid var(--mid)', color:'var(--dark)', padding:'0 0 4px', cursor:'pointer', fontSize:11, letterSpacing:'0.08em', marginBottom:34 }}>← 返回保養專欄</button>
          <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--gold)', marginBottom:18 }}>{article.category}</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(34px,5.4vw,68px)', fontWeight:300, lineHeight:1.18, color:'var(--black)', marginBottom:24 }}>{article.title}</h1>
          <p style={{ maxWidth:650, margin:'0 auto', fontSize:15, lineHeight:1.9, color:'var(--dark)' }}>{article.excerpt}</p>
        </header>

        <div style={{ maxWidth:1120, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <img src={article.img} alt="" style={{ width:'100%', maxHeight:620, aspectRatio:'16 / 9', objectFit:'cover', display:'block' }} />
        </div>

        <div className="journal-article-body">
          {article.sections.map(section => (
            <section key={section.heading} className={section.callout ? 'journal-callout' : undefined}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}

          <aside className="journal-disclaimer">
            <span>閱讀提醒</span>
            <p>{JOURNAL_DISCLAIMER}</p>
          </aside>
        </div>
      </article>

      <nav aria-label="文章導覽" className="journal-prev-next">
        <div>
          {previous && <button onClick={() => onOpenArticle(previous)}><span>上一篇</span>{previous.title}</button>}
        </div>
        <div style={{ textAlign:'right' }}>
          {next && <button onClick={() => onOpenArticle(next)}><span>下一篇</span>{next.title}</button>}
        </div>
      </nav>

      <section style={{ background:'var(--off-white)', padding:'72px 0 88px', borderTop:'1px solid var(--light)' }}>
        <div style={{ maxWidth:1120, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <p style={{ fontSize:10, letterSpacing:'0.22em', color:'var(--gold)', marginBottom:10 }}>RELATED JOURNAL</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, marginBottom:32 }}>延伸閱讀</h2>
          <div className="journal-related-grid">
            {related.map(item => (
              <a key={item.slug} href={`/journal/${item.slug}`} onClick={event => { event.preventDefault(); onOpenArticle(item); }} style={{ color:'inherit', textDecoration:'none' }}>
                <img src={item.img} alt="" style={{ width:'100%', aspectRatio:'16 / 9', objectFit:'cover', display:'block', marginBottom:14 }} />
                <span style={{ fontSize:10, color:'var(--gold)', letterSpacing:'0.12em' }}>{item.category}</span>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:19, fontWeight:300, lineHeight:1.45, marginTop:8 }}>{item.title}</h3>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
