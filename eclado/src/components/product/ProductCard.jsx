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
import { getProductSlug } from '../../app/routes.js';

export default function ProductCard({ product, user, onAdd, onSelect, promotions = [], routeBase = '/products' }) {
  const [hovered, setHovered] = useState(false);
  const canPurchase = !product.isProOnly || isProfessionalMember(user);
  const showPrice = getMemberPrice(product, user);
  const priceTier = getMemberTier(user);
  const hasTierPrice = isProfessionalMember(user) && showPrice !== product.price;
  const priceLabel = product.applyTierMultiplier === false ? '固定專業價' : priceTier.priceLabel;
  const onPromo = promotions.some(p => isPromotionLive(p) && normProductIds(p).includes(Number(product.id)));
  const promoDisplay = getPromoDisplayPrice(product, user, promotions);
  const productHref = `${routeBase}/${getProductSlug(product)}`;
  return (
    <article onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ position:'relative' }}>
      {onPromo && (
        <div style={{ position:'absolute', top:10, right:10, zIndex:3, background:'var(--gold)', color:'var(--white)', fontSize:10, padding:'3px 9px', letterSpacing:'0.1em', fontWeight:500 }}>活動中</div>
      )}
      <div style={{ position:'relative', overflow:'hidden', width:'min(100%, 540px)', aspectRatio:'1', margin:'0 auto 14px', background:'var(--off-white)' }}>
        <a href={productHref} onClick={event => { event.preventDefault(); onSelect(); }} aria-label={`查看${product.nameZh}`} style={{ position:'absolute', inset:0, display:'block', color:'inherit', textDecoration:'none' }}>
          <ProductAutoImage src={getProductImage(product)} alt={product.nameZh} product={product} mode="list" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
        </a>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'var(--black)', padding:'10px', transform: hovered?'translateY(0)':'translateY(100%)', transition:'transform 0.25s' }}>
          {canPurchase ? (
            <button onClick={onAdd} style={{ width:'100%', background:'none', border:'none', cursor:'pointer', color:'var(--white)', fontSize:11, letterSpacing:'0.15em', textTransform:'uppercase', fontFamily:'var(--font-body)', padding:'3px 0' }}>加入購物車</button>
          ) : (
            <a href={productHref} onClick={event => { event.preventDefault(); onSelect(); }} style={{ display:'block', textAlign:'center', color:'var(--white)', fontSize:11, letterSpacing:'0.12em', fontFamily:'var(--font-body)', padding:'3px 0', textDecoration:'none' }}>查看商品介紹 →</a>
          )}
        </div>
      </div>
      <div>
        <a href={productHref} onClick={event => { event.preventDefault(); onSelect(); }} style={{ display:'inline-block', fontSize:12, color:'var(--dark)', marginBottom:8, textDecoration:'none' }}>{product.nameZh} · {product.size}</a>
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
                {hasTierPrice && <span style={{ fontSize:10, background:'var(--off-white)', color:'var(--dark)', padding:'2px 6px' }}>{priceLabel}</span>}
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
    </article>
  );
}

// ─── PROMO SECTION (homepage) ────────────────────────────────────────────────
