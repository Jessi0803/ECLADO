import React from 'react';
import useIsMobile from '../hooks/useIsMobile.js';

// ─── ABOUT PAGE ───────────────────────────────────────────────────────────────
export default function AboutPage() {
  const isMobile = useIsMobile();
  return (
    <div style={{ paddingTop:68 }}>
      <div style={{ position:'relative', height: isMobile ? 220 : 300, overflow:'hidden' }}>
        <img src="assets/images/about-cover.jpg" alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }} />
        <div style={{ position:'absolute', inset:0, background:'rgba(12,12,10,0.62)' }} />
        <div style={{ position:'relative', height:'100%', maxWidth:1100, margin:'0 auto', padding: isMobile ? '0 24px' : '0 32px', display:'flex', flexDirection:'column', justifyContent:'flex-end', paddingBottom: isMobile ? 32 : 48 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
            <div style={{ width:28, height:1, background:'var(--gold)' }} />
            <p style={{ fontSize:10, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase', margin:0 }}>Our Story</p>
          </div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(28px,4.5vw,56px)', fontWeight:300, color:'var(--white)', lineHeight:1.1, margin:0 }}>品牌故事</h1>
        </div>
      </div>
      <div style={{ maxWidth:1100, margin:'0 auto', padding: isMobile ? '48px 20px' : '80px 32px' }}>

        {/* 品牌起源 */}
        <div className="gabout">
          <div>
            <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--dark)', textTransform:'uppercase', marginBottom:14 }}>Since 1998</p>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.5vw,40px)', fontWeight:300, lineHeight:1.2, marginBottom:24, color:'var(--black)' }}>深耕28年<br />韓國院線的選擇</h2>
            <p style={{ fontSize:14, lineHeight:2, color:'#666', marginBottom:16 }}>ECLADO 創立於1998年，是韓國美容產業中具代表性的專業皮膚管理院線品牌。28年來不以流行趨勢為導向，而是以系統化產品設計與實驗室研發技術為核心，持續陪伴臨床與美容專業人士成長。</p>
            <p style={{ fontSize:14, lineHeight:2, color:'#666' }}>如今品牌足跡遍佈全球23個國家，韓國超過8,000家皮膚管理中心御用，並成為150所韓國美容學院的指定品牌。</p>
          </div>
          <img src="assets/images/about-eclado-clinic.jpg" alt="" style={{ width:'100%', height: isMobile ? 240 : 460, objectFit:'cover' }} />
        </div>

        {/* 數字 */}
        <div className="g3">
          {[
            { num:'28', label:'年品牌歷史', desc:'1998年創立，專注專業皮膚管理至今' },
            { num:'8,000+', label:'韓國合作院所', desc:'韓國超過8,000家皮膚管理中心御用' },
            { num:'147', label:'支完整系列', desc:'從問題肌修復到抗老管理一應俱全' },
          ].map(item => (
            <div key={item.label} style={{ textAlign:'center', padding:'36px 20px', border:'1px solid var(--light)' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:48, fontWeight:300, color:'var(--black)', lineHeight:1, marginBottom:8 }}>{item.num}</div>
              <div style={{ fontSize:13, fontWeight:500, letterSpacing:'0.08em', marginBottom:10 }}>{item.label}</div>
              <div style={{ fontSize:13, color:'var(--dark)' }}>{item.desc}</div>
            </div>
          ))}
        </div>

        {/* 品牌哲學 */}
        <div className="gabout" style={{ marginTop: isMobile ? 56 : 96 }}>
          <img src="assets/images/philosophy-subimage-1.png" alt="" style={{ width:'100%', height: isMobile ? 240 : 420, objectFit:'cover' }} />
          <div>
            <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--dark)', textTransform:'uppercase', marginBottom:14 }}>Our Philosophy</p>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.5vw,40px)', fontWeight:300, lineHeight:1.2, marginBottom:24, color:'var(--black)' }}>為專業人士設計<br />的完整療程系統</h2>
            <p style={{ fontSize:14, lineHeight:2, color:'#666', marginBottom:16 }}>ECLADO 的147支產品涵蓋問題肌修復、敏弱調理、光澤養膚到抗老管理，以完整療程邏輯建構，而非單一明星產品。每一套系列由專屬實驗室研發，從居家保養、院所療程到教育培訓全面支援皮膚管理師。</p>
            <p style={{ fontSize:14, lineHeight:2, color:'#666' }}>ECLADO 在韓國美容業中擁有最多的人體實驗研究，每一款產品皆通過人體臨床測試，無一例外，以科學力量為每一片肌膚負責。</p>
          </div>
        </div>

        {/* 品牌標語 */}
        <div style={{ textAlign:'center', padding: isMobile ? '56px 0' : '96px 0', borderTop:'1px solid var(--light)', marginTop: isMobile ? 56 : 96 }}>
          <p style={{ fontSize:11, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase', marginBottom:20 }}>ECLADO LABORATORY</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(32px,5vw,64px)', fontWeight:300, color:'var(--black)', lineHeight:1.1, marginBottom:24 }}>Glow Beyond Limits.</h2>
          <p style={{ fontSize:14, lineHeight:2, color:'#888', maxWidth:540, margin:'0 auto' }}>持續研發符合時代需求的新產品，讓專業線美容隨著環境型態進化，是 ECLADO 28年來從未改變的信念。</p>
        </div>

      </div>
    </div>
  );
}
