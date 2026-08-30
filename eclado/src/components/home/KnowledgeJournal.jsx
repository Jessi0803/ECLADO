import React from 'react';
import { JOURNAL_ARTICLES } from '../../data/journalArticles.js';

export default function KnowledgeJournal({ isMobile, onOpenArticle, onOpenJournal }) {
  const leadArticle = JOURNAL_ARTICLES[0];
  const supportingArticles = JOURNAL_ARTICLES.slice(1);

  return (
    <section style={{ background:'var(--white)', padding: isMobile ? '64px 0 72px' : '104px 0 112px', borderTop:'1px solid var(--light)' }}>
      <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
        <div style={{ display:'flex', justifyContent:'space-between', gap:24, alignItems:'flex-end', flexWrap:'wrap', marginBottom: isMobile ? 28 : 42 }}>
          <div style={{ maxWidth:560 }}>
            <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:12 }}>Journal</p>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.6vw,46px)', fontWeight:300, lineHeight:1.1, color:'var(--black)', marginBottom:18 }}>保養專欄</h2>
          </div>
          <button onClick={onOpenJournal} style={{ background:'none', border:'none', borderBottom:'1px solid var(--dark)', color:'var(--dark)', padding:'0 0 4px', cursor:'pointer', fontSize:12, letterSpacing:'0.06em' }}>瀏覽全部專欄 →</button>
        </div>

        {isMobile ? (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {JOURNAL_ARTICLES.map(article => (
              <a key={article.title} href={`/journal/${article.slug}`} onClick={event => { event.preventDefault(); onOpenArticle(article); }} style={{ color:'inherit', textDecoration:'none', border:'1px solid var(--light)', background:'var(--off-white)', display:'flex', flexDirection:'column' }}>
                <img src={article.img} alt="" style={{ width:'100%', aspectRatio:'4 / 3', objectFit:'cover', display:'block' }} />
                <div style={{ padding:'12px 10px 14px', display:'flex', flexDirection:'column', gap:6 }}>
                  <span style={{ fontSize:10, letterSpacing:'0.14em', color:'var(--gold)', textTransform:'uppercase' }}>{article.category}</span>
                  <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, lineHeight:1.4, fontWeight:300, color:'var(--black)' }}>{article.title}</h3>
                  <p style={{ fontSize:11, lineHeight:1.7, color:'var(--dark)' }}>{article.excerpt}</p>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'minmax(360px, 1.05fr) minmax(0, 1fr)', gap:24, alignItems:'stretch', marginBottom:24 }}>
              <a href={`/journal/${leadArticle.slug}`} onClick={event => { event.preventDefault(); onOpenArticle(leadArticle); }} style={{ color:'inherit', textDecoration:'none', border:'1px solid var(--light)', background:'var(--off-white)', display:'grid', gridTemplateRows:'auto 1fr' }}>
                <img src={leadArticle.img} alt="" style={{ width:'100%', aspectRatio:'16 / 10', objectFit:'cover', display:'block' }} />
                <div style={{ padding:'24px 24px 26px', display:'flex', flexDirection:'column', gap:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', fontSize:11, color:'var(--mid)' }}>
                    <span style={{ letterSpacing:'0.16em', color:'var(--gold)', textTransform:'uppercase' }}>{leadArticle.category}</span>
                  </div>
                  <h3 style={{ fontFamily:'var(--font-display)', fontSize:30, lineHeight:1.3, fontWeight:300, color:'var(--black)' }}>{leadArticle.title}</h3>
                  <p style={{ fontSize:14, lineHeight:1.9, color:'var(--dark)' }}>{leadArticle.excerpt}</p>
                  <span style={{ marginTop:'auto', width:'fit-content', borderBottom:'1px solid var(--dark)', color:'var(--dark)', fontSize:12, padding:'0 0 4px' }}>精選文章</span>
                </div>
              </a>
              <div style={{ display:'grid', gridTemplateRows:'repeat(2, minmax(0, 1fr))', gap:18 }}>
                {supportingArticles.slice(0, 2).map(article => (
                  <a key={article.title} href={`/journal/${article.slug}`} onClick={event => { event.preventDefault(); onOpenArticle(article); }} style={{ color:'inherit', textDecoration:'none', border:'1px solid var(--light)', background:'var(--white)', display:'grid', gridTemplateColumns:'180px minmax(0, 1fr)' }}>
                    <img src={article.img} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                    <div style={{ padding:'18px 18px 20px', display:'flex', flexDirection:'column', gap:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', fontSize:11, color:'var(--mid)' }}>
                        <span style={{ letterSpacing:'0.16em', color:'var(--gold)', textTransform:'uppercase' }}>{article.category}</span>
                      </div>
                      <h3 style={{ fontFamily:'var(--font-display)', fontSize:22, lineHeight:1.35, fontWeight:300, color:'var(--black)' }}>{article.title}</h3>
                      <p style={{ fontSize:13, lineHeight:1.8, color:'var(--dark)' }}>{article.excerpt}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
            <div style={{ overflowX:'auto', paddingBottom:4 }}>
              <div style={{ display:'grid', gridAutoFlow:'column', gridAutoColumns:'minmax(280px, 1fr)', gap:18, minWidth: supportingArticles.length > 3 ? 1180 : 'auto' }}>
                {supportingArticles.slice(2).map(article => (
                  <a key={article.title} href={`/journal/${article.slug}`} onClick={event => { event.preventDefault(); onOpenArticle(article); }} style={{ color:'inherit', textDecoration:'none', border:'1px solid var(--light)', background:'var(--off-white)', minHeight:300, display:'flex', flexDirection:'column' }}>
                    <img src={article.img} alt="" style={{ width:'100%', aspectRatio:'16 / 9', objectFit:'cover', display:'block' }} />
                    <div style={{ padding:'16px 16px 18px', display:'flex', flexDirection:'column', gap:10, flex:1 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', fontSize:11, color:'var(--mid)' }}>
                        <span style={{ letterSpacing:'0.16em', color:'var(--gold)', textTransform:'uppercase' }}>{article.category}</span>
                      </div>
                      <h3 style={{ fontFamily:'var(--font-display)', fontSize:21, lineHeight:1.35, fontWeight:300, color:'var(--black)' }}>{article.title}</h3>
                      <p style={{ fontSize:13, lineHeight:1.8, color:'var(--dark)' }}>{article.excerpt}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
