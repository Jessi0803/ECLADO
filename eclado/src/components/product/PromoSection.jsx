import React from 'react';
import {
  PRODUCTS,
  isProfessionalMember,
} from '../../domain/catalog.jsx';
import { normProductIds } from '../../domain/promotions.js';
import ProductCard from './ProductCard.jsx';

export default function PromoSection({ promo, user, addToCart, onSelect, isMobile, promotions = [], products = PRODUCTS }) {
  const ids = normProductIds(promo);
  const items = ids
    .map(id => products.find(p => p.id === id))
    .filter(Boolean)
    .filter(p => !p.isProOnly || isProfessionalMember(user));
  if (items.length === 0) {
    return (
      <section style={{ background:'var(--white)', padding: isMobile ? '48px 0' : '72px 0', borderTop:'1px solid var(--light)', borderBottom:'1px solid var(--light)' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', marginBottom:10 }}>限時優惠</p>
          <p style={{ fontSize:14, color:'#555', lineHeight:1.75 }}>
            活動「<strong style={{ color:'var(--black)' }}>{promo.name}</strong>」已建立，但目前<strong>沒有可顯示的商品</strong>。
            請到後台確認已勾選商品，且商品編號需與官網一致（一般為 1～8）。
            {ids.length === 0 && '（目前 product_ids 為空）'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ background:'var(--white)', padding: isMobile ? '60px 0' : '100px 0', borderTop:'1px solid var(--light)', borderBottom:'1px solid var(--light)' }}>
      <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
        <div style={{ marginBottom: isMobile ? 36 : 56 }}>
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', marginBottom:10 }}>限時優惠</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(26px,4vw,52px)', fontWeight:300, lineHeight:1.1, color:'var(--black)', marginBottom:12 }}>{promo.name}</h2>
          {promo.description && (
            <p style={{ fontSize:14, color:'#555', lineHeight:1.75, maxWidth:560, marginBottom:0 }}>{promo.description}</p>
          )}
        </div>

        <div className="g4">
          {items.map(p => (
            <div key={p.id} style={{ background:'var(--off-white)', color:'var(--black)', padding:14, border:'1px solid var(--light)' }}>
              <ProductCard product={p} user={user} onAdd={() => addToCart(p)} onSelect={() => onSelect(p)} promotions={promotions} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── SHOP PAGE ────────────────────────────────────────────────────────────────
