import React, { useEffect, useRef, useState } from 'react';
import useIsMobile from '../hooks/useIsMobile.js';
import {
  clearPendingInfoSection,
  getPendingInfoSection,
} from '../app/infoNavigation.js';

// ─── INFO PAGE ────────────────────────────────────────────────────────────────
export default function InfoPage() {
  const [active, setActive] = useState(getPendingInfoSection() || '退換貨說明');
  const infoContentRef = useRef(null);
  const isMobile = useIsMobile();
  const sections = {
    '退換貨說明': { title:'退換貨說明', content:[
      { q:'【商品驗收】', a:'為保障您我雙方權益，建議您於收到商品時，全程錄影開箱（一鏡到底），並確認商品內容物是否完整、外觀是否有異常。如有商品瑕疵、缺件、配送錯誤等情形，請於收到商品後 7 日內聯繫客服，以利協助處理。' },
      { q:'【退貨政策】', a:'依《消費者保護法》規定，消費者享有商品到貨次日起 7 日猶豫期（鑑賞期） 之權益（含例假日）。\n\n提醒您：猶豫期並非試用期。\n\n若您欲辦理退貨，請保持以下條件：\n商品為全新未使用狀態。\n商品本體、配件、贈品、包裝、說明書、保卡等內容完整。\n商品不得有人為使用痕跡、刮傷、髒污、異味、拆解或其他影響再次販售之情形。\n如因個人因素退貨，請妥善包裝後寄回，以避免運送途中造成商品損壞。' },
      { q:'【下列情況恕不適用七日猶豫期退貨】', a:'依《消費者保護法》第19條合理例外情事規定：\n已拆封之個人衛生用品、美容用品、耗材等，除商品本身瑕疵外，恕不接受退貨。\n客製化商品。\n其他依法公告不適用七日猶豫期之商品。\n\n※ 若商品本身具有新品瑕疵、運送損壞、寄錯商品等情況，不在此限，本公司將協助辦理退換貨。' },
      { q:'【新品瑕疵換貨】', a:'若商品於正常使用前即有新品瑕疵、缺件、配送錯誤等情況，請於收到商品後 7 日內提供：\n訂單資訊\n商品照片\n開箱影片（如有）\n客服確認後將協助辦理換貨或退貨。' },
      { q:'【維修服務】', a:'美容儀器如需送修，請先聯繫客服。\n商品送修後，將依韓國原廠檢測結果判定是否屬保固範圍，維修時間依原廠流程安排。\n若屬人為因素或超過保固期限，可能產生檢測費、維修費或零件費，實際費用依原廠報價為準。' },
      { q:'【保固說明】', a:'商品皆為韓國原廠公司貨。\n保固期限依各商品原廠公告為準。\n保固內容依各商品原廠保固規範辦理。\n保固範圍限正常使用情況下，非人為因素造成之功能異常。\n以下情況不屬保固範圍：\n人為損壞或操作不當。\n摔落、撞擊、泡水、受潮、火災等外力因素造成之損壞。\n耗材、配件及正常使用所造成之自然耗損。\n超過原廠保固期限。' },
      { q:'【消費者權益聲明】', a:'本退換貨政策將依《消費者保護法》及相關法令辦理，消費者權益仍以法律規定為準。' }
    ]},
    '運送方式': { title:'運送方式', content:[
      { q:'配送方式', a:'全台宅配（順豐物流）。' },
      { q:'運費說明', a:'全站統一運費 NT$ 120（宅配到府，順豐物流）。' },
      { q:'出貨時間', a:'現貨商品於確認付款後 5 個工作天內出貨，每週二統一出貨。\n\n預購商品：下單後約 7-14 個工作天出貨，實際時間視備貨及運輸狀況而定。' },
      { q:'出貨通知', a:'商品出貨後系統將自動透過 LINE 發送出貨通知，內含物流追蹤連結。' },
    ]},
    '付款說明': { title:'付款說明', content:[
      { q:'付款方式', a:'目前提供虛擬帳號匯款、信用卡、Apple Pay 與 Google Pay，由永豐豐收款處理。' },
      { q:'付款確認', a:'完成付款後系統會自動接收通知並更新訂單狀態，無須另外上傳轉帳末五碼。' },
      { q:'付款期限', a:'若選擇虛擬帳號匯款，請依付款頁顯示的期限完成付款，逾期訂單將自動失效。' },
      { q:'匯款 / 付款說明', a:'如為虛擬帳號匯款，付款完成後請保留收據；信用卡與行動支付則依永豐付款頁面流程完成即可。' },
    ]},
    '常見問題': { title:'常見問題', content:[
      { q:'如何成為美容師會員？', a:'請先完成一般會員註冊並登入，再前往「美容師申請」頁面填寫資料送出。審核通過後即可享有院線商品購買資格與專業折扣。' },
      { q:'院線商品跟客裝商品有什麼差別？', a:'院線商品需要專業操作技術，僅開放給認證美容師會員購買；客裝商品則適合一般消費者在家自行保養使用。' },
      { q:'如何查詢訂單狀態？', a:'登入會員後可在「我的訂單」查詢所有訂單狀態。下單及出貨時系統也會自動發送 LINE 通知。' },
      { q:'商品可以退款嗎？', a:'商品未拆封且在 7 天內，如有品質問題可申請退款。請透過 LINE 聯繫客服處理。' },
    ]},
  };
  useEffect(() => {
    function showSection(section, shouldScroll = true) {
      if (!sections[section]) return;
      setActive(section);
      clearPendingInfoSection();
      if (shouldScroll) {
        setTimeout(() => infoContentRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
      }
    }
    const pending = getPendingInfoSection();
    if (pending) showSection(pending);
    const handler = event => showSection(event.detail?.section);
    window.addEventListener('eclado-info-section', handler);
    return () => window.removeEventListener('eclado-info-section', handler);
  }, []);
  const current = sections[active];
  return (
    <div style={{ paddingTop:68 }}>
      <div style={{ background:'var(--off-white)', padding: isMobile ? '48px 20px 0' : '64px 32px 0', borderBottom:'1px solid var(--light)' }}>
        <div style={{ maxWidth:900, margin:'0 auto' }}>
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Service</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 30 : 44, fontWeight:300, color:'var(--black)', marginBottom:32 }}>購物說明</h1>
          <div className="info-tabs">
            {Object.keys(sections).map(key => (
              <button key={key} onClick={() => setActive(key)} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, color: active===key ? 'var(--black)' : 'var(--dark)', padding:'13px 20px 13px 0', marginRight:4, borderBottom: active===key ? '2px solid var(--black)' : '2px solid transparent', letterSpacing:'0.06em', fontWeight: active===key ? 500 : 300 }}>{key}</button>
            ))}
          </div>
        </div>
      </div>
      <div ref={infoContentRef} id="info-section-content" style={{ maxWidth:900, margin:'0 auto', padding: isMobile ? '40px 20px' : '60px 32px' }}>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 22 : 28, fontWeight:300, marginBottom:32, color:'var(--black)' }}>{current.title}</h2>
        {current.content.map((item,i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '180px 1fr', gap: isMobile ? 8 : 32, padding:'24px 0', borderBottom:'1px solid var(--light)' }}>
            <div style={{ fontSize:13, fontWeight:500, color:'var(--black)', letterSpacing:'0.04em' }}>{item.q}</div>
            <div style={{ fontSize:14, color:'#555', lineHeight:1.9, whiteSpace:'pre-line' }}>{item.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
