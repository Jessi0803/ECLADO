import React from 'react';
import ScrollReveal from '../components/common/ScrollReveal.jsx';
import CountUp from '../components/common/CountUp.jsx';
import './AboutPage.css';

const imageRoot = '/assets/images/brand-story/';
function Photo({ name, alt, width, height, priority = false, className = '' }) {
  return <img className={className} src={imageRoot + name + '.jpg'} width={width} height={height} alt={alt} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} />;
}
function Heading({ english, children }) {
  return <><p className="brand-story-eyebrow">{english}</p><h2>{children}</h2></>;
}

export default function AboutPage() {
  return (
    <article className="brand-story" aria-label="ECLADO 品牌故事">
      <header className="brand-story-hero">
        <div className="brand-story-hero-copy">
          <p className="brand-story-eyebrow">OUR STORY · SINCE 1998</p>
          <h1>品牌故事</h1>
          <h2>從專業出發，<br />讓日常綻放光采。</h2>
          <p className="brand-story-intro">ECLADO 源自韓國專業皮膚管理領域。以產品研發與教育為基礎，將美容現場累積的經驗，延伸為貼近生活的保養選擇。</p>
          <span className="brand-story-signature">Glow Beyond Limits.</span>
        </div>
        <Photo name="brand-portrait" className="brand-story-portrait" width="1076" height="1522" priority alt="ECLADO 光澤肌膚形象海報，保留品牌標誌與 Glow Beyond Limits 英文宣言" />
      </header>

      <section className="brand-story-origin brand-story-container" aria-label="品牌起源">
        <ScrollReveal>
          <Heading english="OUR ORIGIN">始於 1998，<br />專注每一張肌膚的可能。</Heading>
          <p className="brand-story-body">保養不只是日常的一個步驟，也是一段重新認識自己的過程。從韓國專業美容現場出發，ECLADO 持續探索肌膚的需求，將產品、護理方式與教育串連，陪伴專業人士與每一位使用者。</p>
          <p className="brand-story-body">我們相信，細緻而持續的照顧，能讓人更自在地面對自己的肌膚。這份從專業出發的信念，也成為 ECLADO 走向世界的起點。</p>
        </ScrollReveal>
        <div className="brand-story-facts" aria-label="品牌足跡">
          <dl>
            <div><dt>品牌創立</dt><dd><CountUp value={1998} grouping={false} duration={1000} /><span>年</span></dd></div>
            <div><dt>韓國皮膚管理中心使用</dt><dd><CountUp value={8000} /><span>+</span></dd></div>
            <div><dt>韓國美容教育機構選用</dt><dd><CountUp value={150} duration={2200} /><span>所</span></dd></div>
          </dl>
          {/* <p>依品牌提供資料</p> */}
        </div>
      </section>

      <section className="brand-story-professional brand-story-container" aria-label="專業保養理念">
        <ScrollReveal>
          <figure>
            <Photo name="professional-care" width="1074" height="969" alt="美容師進行臉部保養，照片下方保留 ECLADO LABORATORY 標誌" />
            <figcaption>PROFESSIONAL CARE, EVERYDAY CONFIDENCE.</figcaption>
          </figure>
        </ScrollReveal>
        <ScrollReveal delay={100}>
          <Heading english="PROFESSIONAL CARE">不只一件產品，<br />更是完整的保養思考。</Heading>
          <p className="brand-story-body">每一張肌膚，都有不同的需要。ECLADO 從專業皮膚管理的角度出發，重視產品之間的搭配，以及每一步保養的角色。</p>
          <div className="brand-story-principle"><span aria-hidden="true">01</span><div><h3>以肌膚需求為起點</h3><p>從清潔、補水到日常調理，依照不同膚況選擇合適的系列，建立有脈絡的保養步驟。</p></div></div>
          <div className="brand-story-principle"><span aria-hidden="true">02</span><div><h3>從專業護理，走進日常</h3><p>串連院線產品、居家保養與專業教育，讓皮膚管理師的經驗，成為日常照顧肌膚的支持。</p></div></div>
        </ScrollReveal>
      </section>

      <section className="brand-story-research brand-story-band" aria-label="研發與測試">
        <div className="brand-story-container brand-story-split">
          <ScrollReveal>
            <Heading english="RESEARCH & DEVELOPMENT">把研究，<br />放進保養的每個細節。</Heading>
            <p className="brand-story-body">從配方設計到產品應用，ECLADO 將專業美容現場的經驗帶入研發，關注使用方式、膚感與保養需求之間的關係。</p>
            <p className="brand-story-body">品牌提供的研究資料包含人體應用與產品測試報告。這些累積，讓產品開發不止於概念，也持續回到實際使用的觀察與評估。</p>
            <div className="brand-story-research-notes"><span>配方研究</span><span>應用評估</span><span>現場回饋</span></div>
            <p className="brand-story-note">右圖為品牌研究資料示意，非單一商品功效說明；個別產品資訊請參閱商品頁。</p>
          </ScrollReveal>
          <ScrollReveal delay={100}><figure><Photo name="research-reports" width="657" height="703" alt="ECLADO 提供的人體應用與產品研究報告彙整" /><figcaption>RESEARCH DOCUMENTATION / ECLADO LABORATORY</figcaption></figure></ScrollReveal>
        </div>
      </section>

      <section className="brand-story-education brand-story-container" aria-label="專業教育">
        <div className="brand-story-section-heading">
          <Heading english="PROFESSIONAL EDUCATION">分享知識，讓專業持續成長。</Heading>
          <p>從產品知識到實際手法，讓保養背後的原理，被理解，也被傳遞。</p>
        </div>
        <div className="brand-story-split brand-story-education-layout">
          <ScrollReveal><Photo name="education-gallery" width="796" height="534" alt="ECLADO 專業教學、國際學員合影與現場護理的四幅紀錄" /></ScrollReveal>
          <ScrollReveal delay={100}>
            <p className="brand-story-body">ECLADO 的教育不只介紹產品，更重視保養原理、操作方法與現場應用之間的連結。透過課程與實作，讓專業人士建立自己的護理思考。</p>
            <div className="brand-story-principle"><span>01</span><div><h3>理解產品與原理</h3><p>從不同系列的角色出發，認識產品搭配與保養步驟。</p></div></div>
            <div className="brand-story-principle"><span>02</span><div><h3>練習與經驗交流</h3><p>透過操作示範與課堂實作，將知識帶回日常的專業服務。</p></div></div>
          </ScrollReveal>
        </div>
      </section>

      <section className="brand-story-global brand-story-band" aria-label="全球品牌足跡">
        <div className="brand-story-container">
          <div className="brand-story-section-heading">
            <Heading english="FROM KOREA TO THE WORLD">源自韓國，與世界的肌膚對話。</Heading>
            <p>跨越語言與地域，連結共同重視專業保養的人。</p>
          </div>
          <ScrollReveal><Photo name="global-community" width="950" height="490" alt="來自不同地區的 ECLADO 產品使用與專業護理照片拼貼" /></ScrollReveal>
          <div className="brand-story-global-copy">
            <p className="brand-story-body">從韓國出發，ECLADO 的產品與教育交流延伸至超過 20 個國家。不同的美容現場，分享著對肌膚照顧的共同關注。</p>
            <p className="brand-story-body">透過與各地專業人士的連結，品牌將累積的護理經驗持續分享，也從不同使用情境中學習，讓專業不受地域限制。</p>
          </div>
          {/* <p className="brand-story-note">品牌足跡依韓國官網與品牌提供資料整理。</p> */}
        </div>
      </section>

      <section className="brand-story-commitment brand-story-container" aria-label="品牌肯定與社會關懷">
        <div className="brand-story-section-heading">
          <Heading english="TRUST & RESPONSIBILITY">讓信任，成為持續前行的力量。</Heading>
          <p>專業的累積，也體現在品牌所獲得的肯定，以及對人的關懷。</p>
        </div>
        <div className="brand-story-commitment-grid">
          <ScrollReveal>
            <Photo name="brand-award" width="778" height="389" alt="2024、2025 KCAB 品牌獎項海報，保留 ECLADO 標誌" />
            <p className="brand-story-eyebrow">RECOGNITION</p><h3>來自品牌評選的肯定</h3>
            <p className="brand-story-body">ECLADO 韓國官網列載 2024、2025 年 KCAB 韓國消費者評價最佳品牌獎項，在 Medical Cosmetic 類別獲得肯定。</p>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <Photo name="social-care" width="355" height="239" alt="ECLADO 參與產品捐贈活動的合影" />
            <p className="brand-story-eyebrow">SOCIAL CONNECTION</p><h3>將關懷延伸到肌膚之外</h3>
            <p className="brand-story-body">透過產品捐贈與社會關懷，ECLADO 將與人的連結帶入品牌行動，讓日常保養之外，多一份溫暖的陪伴。</p>
          </ScrollReveal>
        </div>
      </section>

      <section className="brand-story-closing" aria-label="品牌宣言與探索">
        <div className="brand-story-container brand-story-split">
          <Photo name="glow-manifesto" width="1076" height="1522" alt="黑白護理形象海報，印有 Glow Beyond Limits 與 ECLADO LABORATORY" />
          <div className="brand-story-closing-copy">
            <p className="brand-story-eyebrow">GLOW BEYOND LIMITS</p>
            <h2>保養不止於肌膚，<br />自信不設限。</h2>
            <p>從一次細心的照顧，走向每一天的自在。<br />找到適合自己的保養方式，讓光采成為生活的一部分。</p>
            <div className="brand-story-links">
              <a href="/shop?view=series">探索保養系列 <span aria-hidden="true">↗</span></a>
              <a href="/contact">與我們聯繫 <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </div>
      </section>
    </article>
  );
}
