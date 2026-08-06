import React, { useEffect, useState } from 'react';
import KnowledgeJournal from '../components/home/KnowledgeJournal.jsx';
import TopProductsCarousel from '../components/home/TopProductsCarousel.jsx';
import { NAV_LINKS } from '../app/navigation.js';
import TrustBadges from '../components/common/TrustBadges.jsx';
import ProductCard from '../components/product/ProductCard.jsx';
import PromoSection from '../components/product/PromoSection.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import { HERO_SLIDES } from '../data/homeContent.js';
import {
  PRODUCTS,
  getCartKey,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import { emptySalesStats, getPopularProducts } from '../domain/sales.js';
import { isPromotionLive } from '../domain/promotions.js';
import { goProfessionalApply } from '../services/membership.js';

export default function HomePage({ setPage, onSelectProduct, user, cart, setCart, promotions = [], products = PRODUCTS, salesStats = emptySalesStats() }) {
  const [slide, setSlide] = useState(0);
  const [animating, setAnimating] = useState(false);
  const isMobile = useIsMobile();
  const livePromos = promotions.filter(isPromotionLive);
  const topProducts = getPopularProducts(products, salesStats);

  useEffect(() => {
    const t = setInterval(() => {
      setAnimating(true);
      setTimeout(() => { setSlide(s => (s + 1) % HERO_SLIDES.length); setAnimating(false); }, 450);
    }, 7500);
    return () => clearInterval(t);
  }, []);

  const featured = products.filter(p => !p.isProOnly).slice(0, 4);

  function addToCart(product) {
    if (product.isProOnly && !isProfessionalMember(user)) return;
    setCart(prev => {
      const cartKey = getCartKey(product);
      const ex = prev.find(i => getCartKey(i) === cartKey);
      if (ex) return prev.map(i => getCartKey(i) === cartKey ? { ...i, qty: i.qty+1 } : i);
      return [...prev, { ...product, cartKey, qty:1 }];
    });
  }

  const heroPad = isMobile ? '0 6vw' : '0 10vw';

  return (
    <div>
      {/* HERO */}
      <section style={{ height:'100vh', position:'relative', overflow:'hidden', background:'#1a1a18' }}>
        {HERO_SLIDES.map((s,i) => (
          <img key={i} src={s.img} alt="" style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover', objectPosition: isMobile ? (s.mobilePosition || 'center') : (s.position || 'center'), opacity: i===slide ? 1 : 0, transition:'opacity 0.9s ease', pointerEvents:'none' }} />
        ))}

        {/* Layout 1: left */}
        {HERO_SLIDES[slide].layout === 'left' && (
          <>
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right, rgba(14,14,12,0.88) 45%, rgba(14,14,12,0.15))' }} />
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', justifyContent:'center', padding:heroPad, maxWidth: isMobile ? '92vw' : 780, opacity: animating?0:1, transition:'opacity 0.45s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                <div style={{ width:28, height:1, background:'var(--gold)' }} />
                <span style={{ fontSize:10, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase', fontFamily:'var(--font-body)' }}>{HERO_SLIDES[slide].accent}</span>
              </div>
              <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 'clamp(34px,10vw,44px)' : 'clamp(40px,7.5vw,104px)', fontWeight:300, color:'var(--white)', lineHeight:1.0, whiteSpace:'pre-line', marginBottom:20 }}>{HERO_SLIDES[slide].headline}</h1>
              <p style={{ fontSize:15, color:'rgba(255,255,255,0.65)', letterSpacing:'0.06em', marginBottom:36, fontWeight:300, lineHeight:1.8, maxWidth:560 }}>{HERO_SLIDES[slide].sub}</p>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                <button onClick={() => setPage('shop')} style={{ background:'var(--white)', color:'var(--black)', border:'none', padding:'13px 28px', fontSize:11, letterSpacing:'0.12em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500, whiteSpace:'nowrap' }}
                  onMouseEnter={e=>{e.target.style.background='var(--gold)';e.target.style.color='var(--white)';}}
                  onMouseLeave={e=>{e.target.style.background='var(--white)';e.target.style.color='var(--black)';}}
                >{HERO_SLIDES[slide].cta}</button>
              </div>
            </div>
          </>
        )}

        {/* Layout 2: center */}
        {HERO_SLIDES[slide].layout === 'center' && (
          <>
            <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center, rgba(14,14,12,0.5) 0%, rgba(14,14,12,0.82) 100%)' }} />
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', textAlign:'center', padding: isMobile ? '0 6vw' : '0 8vw', opacity: animating?0:1, transition:'opacity 0.45s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
                <div style={{ width:20, height:1, background:'var(--gold)' }} />
                <span style={{ fontSize:10, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase' }}>{HERO_SLIDES[slide].accent}</span>
                <div style={{ width:20, height:1, background:'var(--gold)' }} />
              </div>
              <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 'clamp(34px,10vw,46px)' : 'clamp(38px,8vw,112px)', fontWeight:300, color:'var(--white)', lineHeight:1.0, whiteSpace:'pre-line', marginBottom:20 }}>{HERO_SLIDES[slide].headline}</h1>
              <p style={{ fontSize:15, color:'rgba(255,255,255,0.6)', letterSpacing:'0.06em', marginBottom:40, fontWeight:300, maxWidth:520, lineHeight:1.8 }}>{HERO_SLIDES[slide].sub}</p>
              <button onClick={() => setPage('shop')} style={{ background:'transparent', color:'var(--white)', border:'1px solid rgba(255,255,255,0.6)', padding:'14px 40px', fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', whiteSpace:'nowrap' }}
                onMouseEnter={e=>{e.target.style.background='var(--white)';e.target.style.color='var(--black)';}}
                onMouseLeave={e=>{e.target.style.background='transparent';e.target.style.color='var(--white)';}}
              >{HERO_SLIDES[slide].cta}</button>
            </div>
          </>
        )}

        {/* Layout 3: split */}
        {HERO_SLIDES[slide].layout === 'split' && (
          <>
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(to left, rgba(14,14,12,0.1) 40%, rgba(14,14,12,0.92) 70%)' }} />
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', justifyContent:'center', alignItems: isMobile ? 'flex-start' : 'flex-end', padding:heroPad, opacity: animating?0:1, transition:'opacity 0.45s' }}>
              <div style={{ maxWidth:520, textAlign: isMobile ? 'left' : 'right' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent: isMobile ? 'flex-start' : 'flex-end', gap:12, marginBottom:16 }}>
                  <span style={{ fontSize:10, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase' }}>{HERO_SLIDES[slide].accent}</span>
                  <div style={{ width:28, height:1, background:'var(--gold)' }} />
                </div>
                <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 'clamp(34px,10vw,44px)' : 'clamp(36px,6.5vw,92px)', fontWeight:300, color:'var(--white)', lineHeight:1.05, whiteSpace:'pre-line', marginBottom:20 }}>{HERO_SLIDES[slide].headline}</h1>
                <p style={{ fontSize:15, color:'rgba(255,255,255,0.6)', letterSpacing:'0.06em', marginBottom:36, fontWeight:300, lineHeight:1.8 }}>{HERO_SLIDES[slide].sub}</p>
                <button onClick={() => setPage('login')} style={{ background:'var(--gold)', color:'var(--white)', border:'none', padding:'13px 28px', fontSize:11, letterSpacing:'0.12em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500, whiteSpace:'nowrap' }}
                  onMouseEnter={e=>e.target.style.opacity='0.85'}
                  onMouseLeave={e=>e.target.style.opacity='1'}
                >{HERO_SLIDES[slide].cta}</button>
              </div>
            </div>
          </>
        )}

        {/* Slide dots */}
        <div style={{ position:'absolute', bottom:32, left: isMobile ? '6vw' : '10vw', display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ display:'flex', gap:8 }}>
            {HERO_SLIDES.map((_,i) => (
              <div key={i} onClick={() => { setAnimating(true); setTimeout(()=>{setSlide(i);setAnimating(false);},300); }} style={{ width: i===slide?24:8, height:2, background: i===slide?'var(--white)':'rgba(255,255,255,0.3)', cursor:'pointer', transition:'all 0.35s' }} />
            ))}
          </div>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.35)', letterSpacing:'0.1em' }}>
            {String(slide+1).padStart(2,'0')} / {String(HERO_SLIDES.length).padStart(2,'0')}
          </span>
        </div>

        {/* Scroll hint — hide on mobile */}
        {!isMobile && (
          <div style={{ position:'absolute', right:40, bottom:40, display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:9, letterSpacing:'0.2em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', writingMode:'vertical-rl' }}>Scroll</span>
            <div style={{ width:1, height:40, background:'rgba(255,255,255,0.18)' }} />
          </div>
        )}

      </section>

      {/* BRAND STRIP */}
      <section style={{ background:'var(--black)', padding:'18px 0' }}>
        <TrustBadges isMobile={isMobile} />
      </section>

      {/* LIVE PROMOTIONS */}
      <div id="eclado-promotions">
        {livePromos.map(promo => (
          <PromoSection key={promo.id} promo={promo} user={user} addToCart={addToCart} onSelect={onSelectProduct} isMobile={isMobile} promotions={promotions} products={products} />
        ))}
      </div>

      <TopProductsCarousel products={topProducts} user={user} onAdd={addToCart} onSelect={onSelectProduct} isMobile={isMobile} setPage={setPage} promotions={promotions} />

      {/* FEATURED PRODUCTS */}
      <section style={{ padding: isMobile ? '60px 0' : '100px 0', background:'var(--white)' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom: isMobile ? 36 : 56 }}>
            <div>
              <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Featured</p>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.6vw,46px)', fontWeight:300, lineHeight:1.1, color:'var(--black)' }}>精選商品</h2>
            </div>
            <button onClick={() => setPage('shop')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--dark)', fontFamily:'var(--font-body)', borderBottom:'1px solid var(--dark)', paddingBottom:2, whiteSpace:'nowrap' }}>全部商品 →</button>
          </div>
          <div className="g4">
            {featured.map(p => <ProductCard key={p.id} product={p} user={user} onAdd={() => addToCart(p)} onSelect={() => onSelectProduct(p)} promotions={promotions} />)}
          </div>
        </div>
      </section>

      {/* ABOUT STRIP */}
      <section style={{ background:'var(--off-white)', padding: isMobile ? '60px 0' : '100px 0' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <div className="g2">
            <div>
              <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--dark)', textTransform:'uppercase', marginBottom:14 }}>About ECLADO</p>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(22px,3.2vw,42px)', fontWeight:300, lineHeight:1.2, marginBottom:24, color:'var(--black)' }}>
                源自韓國醫美診所<br />
                <span style={{ fontWeight:300 }}>的專業配方</span>
              </h2>
              <p style={{ fontSize:14, lineHeight:1.9, color:'#666', maxWidth:480, marginBottom:28 }}>
                ECLADO 是源自韓國醫美院線的頂級保養品牌，每一款產品皆由皮膚科醫師與研究團隊共同研發，以臨床驗證的有效成分，帶給您診所級的保養體驗。
              </p>
              <div className="gstats" style={{ maxWidth: isMobile ? '100%' : 520, gap: isMobile ? '18px 20px' : '24px 32px', marginTop: isMobile ? 28 : 34 }}>
                {[
                  ['8,000+', '家皮膚管理中心御用'],
                  ['150', '所韓國美容學院指定品牌'],
                  ['23', '個國家據點遍佈全球'],
                  ['28', '年品牌歷史'],
                ].map(([num,label]) => (
                  <div key={label} style={{ borderTop:'1px solid rgba(0,0,0,0.12)', paddingTop:14 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontSize:'clamp(28px,3vw,42px)', fontWeight:300, color:'var(--black)', lineHeight:1 }}>{num}</div>
                    <div style={{ fontSize:12, color:'var(--dark)', letterSpacing:'0.06em', lineHeight:1.6, marginTop:8 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <img src="assets/images/about-eclado-clinic.jpg" alt="" style={{ width:'100%', height: isMobile ? 280 : 480, objectFit:'cover', display:'block' }} />
          </div>
        </div>
      </section>

      <KnowledgeJournal isMobile={isMobile} />

      {/* PRO SECTION */}
      <section style={{ background:'var(--dark)', padding: isMobile ? '60px 0' : '100px 0' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px', textAlign:'center' }} className="px-page">
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:14 }}>Professional</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.6vw,48px)', fontWeight:300, color:'var(--white)', marginBottom:18, lineHeight:1.1 }}>美容師專業會員</h2>
          <p style={{ fontSize:14, color:'rgba(255,255,255,0.5)', maxWidth:480, margin:'0 auto 36px', lineHeight:1.8 }}>
            申請成為認證美容師會員，享有院線保養品購買資格<br />及專業折扣價格，共同提升客戶的保養體驗。
          </p>
          <div style={{ display:'flex', gap: isMobile ? 16 : 32, justifyContent:'center', marginBottom:40, flexWrap:'wrap' }}>
            {['院線保養品購買資格','專業折扣優惠價','產品操作培訓','優先新品體驗'].map(item => (
              <div key={item} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:1, height:12, background:'var(--gold)', flexShrink:0 }} />
                <span style={{ fontSize:13, color:'rgba(255,255,255,0.7)', letterSpacing:'0.06em' }}>{item}</span>
              </div>
            ))}
          </div>
          <button onClick={() => goProfessionalApply(user, setPage)} style={{ background:'transparent', border:'1px solid var(--gold)', color:'var(--gold)', padding:'13px 40px', fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', transition:'all 0.25s' }}
            onMouseEnter={e=>{e.target.style.background='var(--gold)';e.target.style.color='var(--black)';}}
            onMouseLeave={e=>{e.target.style.background='transparent';e.target.style.color='var(--gold)';}}
          >申請美容師會員</button>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ fontFamily:'"Open Sans", var(--font-body), sans-serif', background:'var(--black)', borderTop:'1px solid rgba(255,255,255,0.08)', padding: isMobile ? '48px 0 28px' : '60px 0 32px' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <div className="gfooter">
            <div>
              <img src="/assets/images/ECLADO LOGO with CI_WHITE.png" alt="ECLADO Laboratory" style={{ width:100, height:'auto', display:'block', marginBottom:16 }} />
              <p style={{ fontSize:13, color:'rgba(255,255,255,0.35)', lineHeight:1.8, marginBottom:24 }}>韓國醫美院線保養品<br />台灣專業代理</p>
              {!isMobile && (
                <p style={{ fontSize:11, color:'rgba(255,255,255,0.3)', lineHeight:1.9 }}>
                  昭澄國際貿易有限公司<br />
                  Zhao Cheng International Trading Co., Ltd.<br />
                  統一編號：60490580<br />
                  桃園市中壢區石頭里中正路82號10樓<br />
                  © 2026 ECLADO. All rights reserved.
                </p>
              )}
            </div>
            <div style={{ display: isMobile ? 'grid' : 'contents', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : undefined, gap: isMobile ? 12 : undefined }}>
              {[
                { title:'產品系列', links:NAV_LINKS },
                { title:'服務', links:['關於我們','美容師專區','常見問題'] },
                { title:'購物說明', links:['訂單查詢','配送說明','退換貨政策','隱私政策'] },
              ].map(col => (
                <div key={col.title}>
                  <div style={{ fontSize: isMobile ? 10 : 11, letterSpacing:'0.18em', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', marginBottom: isMobile ? 10 : 16 }}>{col.title}</div>
                  <div style={{ display:'flex', flexDirection:'column', gap: isMobile ? 8 : 10 }}>
                    {col.links.map(link => {
                      const href = link === '隱私政策' ? '/privacy' : link === '退換貨政策' ? '/info' : '#';
                      return <a key={link} href={href} style={{ fontSize: isMobile ? 12 : 13, color:'rgba(255,255,255,0.4)', textDecoration:'none', letterSpacing:'0.04em', transition:'color 0.2s', cursor:'pointer' }}
                        onMouseEnter={e=>e.target.style.color='var(--white)'}
                        onMouseLeave={e=>e.target.style.color='rgba(255,255,255,0.4)'}
                      >{link}</a>;
                    })}
                    {col.title === '服務' && (
                      <a href="/contact" style={{ fontSize: isMobile ? 12 : 13, color:'rgba(255,255,255,0.4)', textDecoration:'none', letterSpacing:'0.04em', transition:'color 0.2s' }}
                        onMouseEnter={e=>e.target.style.color='var(--white)'}
                        onMouseLeave={e=>e.target.style.color='rgba(255,255,255,0.4)'}>聯絡我們</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {isMobile && (
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)', marginTop:4, paddingTop:16 }}>
              <p style={{ fontSize:11, color:'rgba(255,255,255,0.3)', lineHeight:2 }}>
                昭澄國際貿易有限公司<br />
                Zhao Cheng International Trading Co., Ltd.<br />
                統一編號：60490580<br />
                桃園市中壢區石頭里中正路82號10樓<br />
                © 2026 ECLADO. All rights reserved.
              </p>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── PRODUCT DETAIL PAGE ──────────────────────────────────────────────────────
