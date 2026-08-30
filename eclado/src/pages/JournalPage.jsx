import React, { useEffect } from 'react';
import { JOURNAL_ARTICLES } from '../data/journalArticles.js';
import useDocumentMeta from '../hooks/useDocumentMeta.js';

export default function JournalPage({ onOpenArticle }) {
  useDocumentMeta('保養專欄｜ECLADO', 'ECLADO 保養專欄，從成分、清潔、安瓶應用到院線級保養觀念，提供清楚而實用的專業保養知識。');

  useEffect(() => { window.scrollTo({ top:0, left:0, behavior:'auto' }); }, []);

  return (
    <main style={{ background:'var(--white)', minHeight:'100vh', padding:'124px 0 100px' }}>
      <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
        <header style={{ maxWidth:760, marginBottom:54 }}>
          <p style={{ fontSize:10, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:14 }}>ECLADO Journal</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(36px,6vw,72px)', fontWeight:300, lineHeight:1.05, color:'var(--black)', marginBottom:20 }}>保養專欄</h1>
          <p style={{ fontSize:14, lineHeight:1.9, color:'var(--dark)', maxWidth:620 }}>從膚況判斷、成分理解到院線保養邏輯，整理能實際帶回日常使用的專業保養觀點。</p>
        </header>

        <div className="journal-list-grid">
          {JOURNAL_ARTICLES.map(article => (
            <a
              key={article.slug}
              href={`/journal/${article.slug}`}
              onClick={event => { event.preventDefault(); onOpenArticle(article); }}
              style={{ color:'inherit', textDecoration:'none', border:'1px solid var(--light)', background:'var(--off-white)', display:'flex', flexDirection:'column', minWidth:0 }}
            >
              <img src={article.img} alt="" style={{ width:'100%', aspectRatio:'16 / 10', objectFit:'cover', display:'block' }} />
              <div style={{ padding:'20px 20px 24px', display:'flex', flexDirection:'column', gap:10, flex:1 }}>
                <span style={{ fontSize:10, letterSpacing:'0.16em', color:'var(--gold)' }}>{article.category}</span>
                <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, lineHeight:1.45, fontWeight:300, color:'var(--black)' }}>{article.title}</h2>
                <p style={{ fontSize:13, lineHeight:1.8, color:'var(--dark)' }}>{article.excerpt}</p>
                <span style={{ marginTop:'auto', paddingTop:8, fontSize:11, color:'var(--dark)', letterSpacing:'0.08em' }}>閱讀文章&nbsp; ↗</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
