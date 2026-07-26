import React, { useState } from 'react';
import {
  getMemberPrice,
  getMemberTier,
  getProductImage,
  isProfessionalMember,
} from '../../domain/catalog.jsx';
import {
  getPromoDisplayPrice,
  isPromotionLive,
  normProductIds,
} from '../../domain/promotions.js';
import ProductAutoImage from './ProductAutoImage.jsx';

export default function ProductCard({ product, user, onAdd, onSelect, promotions = [] }) {
  const [hovered, setHovered] = useState(false);
  const canPurchase = !product.isProOnly || isProfessionalMember(user);
  const showPrice = getMemberPrice(product, user);
  const priceTier = getMemberTier(user);
  const hasTierPrice = isProfessionalMember(user);
  const onPromo = promotions.some(p => isPromotionLive(p) && normProductIds(p).includes(Number(product.id)));
  const promoDisplay = getPromoDisplayPrice(product, user, promotions);
  return (
    <div onClick={onSelect} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ cursor:'pointer', position:'relative' }}>
      {onPromo && (
        <div style={{ position:'absolute', top:10, right:10, zIndex:3, background:'var(--gold)', color:'var(--white)', fontSize:10, padding:'3px 9px', letterSpacing:'0.1em', fontWeight:500 }}>活動中</div>
      )}
      <div style={{ position:'relative', overflow:'hidden', width:'min(100%, 540px)', aspectRatio:'1', margin:'0 auto 14px', background:'var(--off-white)' }}>
        <ProductAutoImage src={getProductImage(product)} alt={product.nameZh} product={product} mode="list" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
        <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'var(--black)', padding:'10px', transform: hovered?'translateY(0)':'translateY(100%)', transition:'transform 0.25s' }}>
          {canPurchase ? (
            <button onClick={e => { e.stopPropagation(); onAdd(); }} style={{ width:'100%', background:'none', border:'none', cursor:'pointer', color:'var(--white)', fontSize:11, letterSpacing:'0.15em', textTransform:'uppercase', fontFamily:'var(--font-body)', padding:'3px 0' }}>加入購物車</button>
          ) : (
            <span style={{ display:'block', textAlign:'center', color:'var(--white)', fontSize:11, letterSpacing:'0.12em', fontFamily:'var(--font-body)', padding:'3px 0' }}>查看商品介紹 →</span>
          )}
        </div>
      </div>
      <div>
        <p style={{ fontSize:12, color:'var(--dark)', marginBottom:8 }}>{product.nameZh} · {product.size}</p>
        {canPurchase ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            {promoDisplay ? (
              <>
                <span style={{ fontSize:15, fontWeight:500, fontFamily:'var(--font-display)', color:'var(--gold)' }}>NT$ {promoDisplay.price.toLocaleString()}</span>
                <span style={{ fontSize:11, color:'var(--dark)', textDecoration:'line-through' }}>NT$ {showPrice.toLocaleString()}</span>
              </>
            ) : (
              <>
                <span style={{ fontSize:15, fontWeight:500, color:'var(--black)' }}>NT$ {showPrice.toLocaleString()}</span>
                {hasTierPrice && <span style={{ fontSize:11, color:'var(--dark)', textDecoration:'line-through' }}>NT$ {product.price.toLocaleString()}</span>}
                {hasTierPrice && <span style={{ fontSize:10, background:'var(--off-white)', color:'var(--dark)', padding:'2px 6px' }}>{priceTier.priceLabel}</span>}
              </>
            )}
          </div>
        ) : (
          <div>
            <span style={{ fontSize:10, background:'var(--dark)', color:'var(--white)', padding:'2px 9px', letterSpacing:'0.1em', display:'inline-block', marginBottom:6 }}>院線商品</span>
            <p style={{ fontSize:11, color:'var(--dark)', lineHeight:1.6 }}>可查看商品介紹並私訊 LINE 官方帳號詢問</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PROMO SECTION (homepage) ────────────────────────────────────────────────
