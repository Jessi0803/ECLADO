import React, { useEffect, useState } from 'react';
import useIsMobile from '../../hooks/useIsMobile.js';
import {
  applyVariantToProduct,
  getCartKey,
  getFulfillmentInfo,
  getMemberPrice,
  getMemberTier,
  getProductImage,
  getProductImages,
  getProductVariants,
  isProfessionalMember,
} from '../../domain/catalog.jsx';
import {
  getPromoDisplayPrice,
  isPromotionLive,
  normProductIds,
} from '../../domain/promotions.js';

export default function ProductDetail({ product, user, onAdd, onBack, promotions = [] }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [activeVariant, setActiveVariant] = useState(0);
  const isMobile = useIsMobile();
  const images = getProductImages(product);
  const variants = getProductVariants(product);
  const selectedVariant = variants[activeVariant] || null;
  const displayProduct = applyVariantToProduct(product, selectedVariant);
  const showPrice = getMemberPrice(displayProduct, user);
  const priceTier = getMemberTier(user);
  const hasTierPrice = isProfessionalMember(user);
  const fulfillment = getFulfillmentInfo(displayProduct);

  const livePromosForProduct = (promotions || []).filter(p => isPromotionLive(p) && normProductIds(p).includes(Number(product.id)));
  const primaryPromo = livePromosForProduct[0];
  const promoDisplay = getPromoDisplayPrice(displayProduct, user, promotions);

  function handleAdd() {
    if (displayProduct.isProOnly && !isProfessionalMember(user)) return;
    const cartProduct = { ...displayProduct, cartKey: getCartKey(displayProduct) };
    for (let i = 0; i < qty; i++) onAdd(cartProduct);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    setActiveImage(0);
    setActiveVariant(0);
    setQty(1);
  }, [product.id]);

  // 通知 Nav 切換到深色模式（避免 navbar 在商品詳情頁還顯示透明白字）
  useEffect(() => {
    window.__productDetailOpen = true;
    window.dispatchEvent(new Event('product-detail-toggle'));
    return () => {
      window.__productDetailOpen = false;
      window.dispatchEvent(new Event('product-detail-toggle'));
    };
  }, []);

  return (
    <div style={{ paddingTop:68, minHeight:'100vh', background:'var(--white)' }}>
      {/* 返回列 */}
      <div style={{ borderBottom:'1px solid var(--light)', padding: isMobile ? '14px 20px' : '14px 32px' }}>
        <div style={{ maxWidth:1200, margin:'0 auto' }}>
          <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.1em', color:'var(--dark)', display:'flex', alignItems:'center', gap:8, padding:0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            返回商品列表
          </button>
        </div>
      </div>

      {/* 主體內容 */}
      <div style={{ maxWidth:1200, margin:'0 auto', padding: isMobile ? '32px 20px' : '56px 32px' }}>
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 36 : 72, alignItems:'start' }}>

          {/* 左：圖片 */}
          <div style={{ position: isMobile ? 'static' : 'sticky', top:90 }}>
            <div style={{ position:'relative', overflow:'hidden' }}>
              <img src={images[activeImage] || getProductImage(product, 900)} alt={product.nameZh} style={{ width:'100%', aspectRatio:'1', objectFit:'contain', background:'var(--off-white)', display:'block' }} />
            </div>
            {images.length > 1 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginTop:10 }}>
                {images.map((image, index) => (
                  <button key={image} type="button" aria-label={`查看商品圖片 ${index + 1}`} onClick={() => setActiveImage(index)}
                    style={{ border: activeImage === index ? '1px solid var(--black)' : '1px solid var(--light)', background:'var(--white)', padding:0, cursor:'pointer', aspectRatio:'1' }}>
                    <img src={image} alt="" style={{ width:'100%', height:'100%', objectFit:'contain', background:'var(--off-white)', display:'block' }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 右：資訊 */}
          <div>
            <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>{[product.category, product.series].filter(Boolean).join('｜')}</p>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 26 : 34, fontWeight:300, color:'var(--black)', lineHeight:1.2, marginBottom:6 }}>{product.nameZh}</h1>
            {product.subtitle && <p style={{ fontSize:13, color:'var(--gold)', letterSpacing:'0.08em', marginBottom:8 }}>{product.subtitle}</p>}
            <p style={{ fontSize:12, color:'var(--dark)', letterSpacing:'0.1em', marginBottom:28 }}>{product.name} · {displayProduct.size}</p>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, marginBottom:22 }}>
              <span style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--white)', background: fulfillment.type === 'preorder' ? 'var(--gold)' : fulfillment.type === 'loading' ? 'var(--mid)' : 'var(--black)', padding:'5px 10px' }}>{fulfillment.label}</span>
              {fulfillment.shipping && <span style={{ fontSize:13, color:'var(--dark)', lineHeight:1.6 }}>{fulfillment.shipping}</span>}
            </div>

            {primaryPromo && (
              <div style={{ background:'var(--off-white)', border:'1px solid var(--gold)', padding:'14px 18px', marginBottom:20 }}>
                <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--gold)', textTransform:'uppercase', marginBottom:6 }}>限時優惠</p>
                <p style={{ fontSize:14, color:'var(--black)', fontWeight:500, marginBottom:0 }}>{primaryPromo.name}</p>
              </div>
            )}

            {variants.length > 1 && (
              <div style={{ marginBottom:24 }}>
                <p style={{ fontSize:10, letterSpacing:'0.22em', color:'var(--dark)', textTransform:'uppercase', marginBottom:10 }}>容量規格</p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {variants.map((variant, index) => (
                    <button key={variant.id || variant.size || index} type="button" onClick={() => { setActiveVariant(index); setQty(1); }}
                      style={{ minWidth:92, padding:'10px 14px', border: activeVariant === index ? '1px solid var(--black)' : '1px solid var(--light)', background: activeVariant === index ? 'var(--black)' : 'var(--white)', color: activeVariant === index ? 'var(--white)' : 'var(--black)', cursor:'pointer', fontSize:13, fontFamily:'var(--font-body)' }}>
                      {variant.size || `規格 ${index + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 價格 or 購買資格 */}
            {displayProduct.isProOnly && !isProfessionalMember(user) ? (
              <div style={{ borderTop:'1px solid var(--light)', borderBottom:'1px solid var(--light)', padding:'24px 0', marginBottom:28 }}>
                <p style={{ fontSize:10, letterSpacing:'0.22em', color:'var(--gold)', textTransform:'uppercase', marginBottom:12 }}>院線專業商品</p>
                <p style={{ fontSize:14, color:'var(--dark)', lineHeight:1.85, marginBottom:20 }}>
                  若您想了解使用方式或購買資格，歡迎私訊 LINE 官方帳號詢問。
                </p>
                <a href="https://line.me/ti/p/@ecladotw" target="_blank" rel="noopener noreferrer"
                  style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#00B900', color:'var(--white)', padding:'13px 26px', fontSize:13, letterSpacing:'0.06em', fontFamily:'var(--font-body)', fontWeight:500, textDecoration:'none' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="white"><path d="M10 2C5.6 2 2 5.1 2 8.8c0 2.5 1.6 4.7 4 5.9l-.5 2 2.3-1.2c.7.2 1.4.3 2.2.3 4.4 0 8-3.1 8-6.8C18 5.1 14.4 2 10 2z"/></svg>
                  私訊 LINE 官方詢問
                </a>
              </div>
            ) : (
              <div style={{ borderTop:'1px solid var(--light)', borderBottom:'1px solid var(--light)', padding:'20px 0', marginBottom:28 }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:12, flexWrap:'wrap' }}>
                  {promoDisplay ? (
                    <>
                      <span style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, color:'var(--gold)' }}>NT$ {promoDisplay.price.toLocaleString()}</span>
                      <span style={{ fontSize:13, color:'var(--dark)', textDecoration:'line-through' }}>NT$ {showPrice.toLocaleString()}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, color:'var(--black)' }}>NT$ {showPrice.toLocaleString()}</span>
                      {hasTierPrice && <>
                      <span style={{ fontSize:13, color:'var(--dark)', textDecoration:'line-through' }}>NT$ {displayProduct.price.toLocaleString()}</span>
                        <span style={{ fontSize:10, background:'var(--gold)', color:'var(--white)', padding:'3px 8px', letterSpacing:'0.1em', fontWeight:500 }}>{priceTier.priceLabel}</span>
                      </>}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 特點 */}
            <div style={{ marginBottom:28 }}>
              {product.features.map((f,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <div style={{ width:4, height:4, background:'var(--gold)', flexShrink:0 }} />
                  <span style={{ fontSize:13, color:'var(--dark)', letterSpacing:'0.04em' }}>{f}</span>
                </div>
              ))}
            </div>

            {/* 數量 + 加入購物車 — 僅限可購買商品 */}
            {!(displayProduct.isProOnly && !isProfessionalMember(user)) && (
              <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', border:'1px solid var(--light)' }}>
                  <button onClick={() => setQty(q => Math.max(1, q-1))} style={{ width:40, height:48, background:'none', border:'none', cursor:'pointer', fontSize:16, color:'var(--dark)', fontFamily:'var(--font-body)' }}>−</button>
                  <span style={{ width:36, textAlign:'center', fontSize:14, color:'var(--black)' }}>{qty}</span>
                  <button onClick={() => setQty(q => q+1)} style={{ width:40, height:48, background:'none', border:'none', cursor:'pointer', fontSize:16, color:'var(--dark)', fontFamily:'var(--font-body)' }}>+</button>
                </div>
                <button onClick={handleAdd} style={{ flex:1, minWidth:180, height:48, background: added ? 'var(--gold)' : 'var(--black)', color:'var(--white)', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.16em', textTransform:'uppercase', transition:'background 0.3s' }}>
                  {added ? '✓ 已加入購物車' : '加入購物車'}
                </button>
              </div>
            )}
            <p style={{ fontSize:11, color:'var(--mid)', lineHeight:1.8, borderTop:'1px solid var(--light)', paddingTop:14, marginTop:4 }}>
              ⚠ 本商品為個人衛生用品，依《消費者保護法》第 19 條之 1，<strong>已拆封商品不適用七天猶豫期退貨</strong>。未拆封商品自收到次日起 7 日內可無條件退貨（退回運費由消費者負擔）。如有品質瑕疵，不限拆封與否均可申請退換，運費由本公司負擔。詳見<a href="/info" style={{ color:'var(--mid)', textUnderlineOffset:2 }}>退換貨政策</a>。
            </p>
          </div>
        </div>

        {/* 下方詳細資訊 */}
        <div style={{ marginTop: isMobile ? 48 : 72, display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap:1, background:'var(--light)' }}>
          {[
            { label:'商品描述', content: product.desc },
            { label:'主要成分', content: product.ingredients },
            { label:'適合膚質', content: product.skinType },
          ].map(({ label, content }) => (
            <div key={label} style={{ background:'var(--white)', padding: isMobile ? '28px 20px' : '36px 32px' }}>
              <p style={{ fontSize:13, fontWeight:600, letterSpacing:'0.24em', color:'var(--dark)', textTransform:'uppercase', marginBottom:14 }}>{label}</p>
              <p style={{ fontSize:14, color:'#555', lineHeight:1.9, whiteSpace:'pre-line' }}>{content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────
