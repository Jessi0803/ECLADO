import React from 'react';
import ProductCard from '../components/product/ProductCard.jsx';
import {
  getCartKey,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import useDocumentMeta from '../hooks/useDocumentMeta.js';
import useIsMobile from '../hooks/useIsMobile.js';

export default function EventProductsPage({
  user,
  setCart,
  onSelectProduct,
  products = [],
  productsStatus = 'ready',
  productsError = '',
  promotions = [],
}) {
  const isMobile = useIsMobile();
  useDocumentMeta({
    title: '活動限定商品｜ECLADO',
    description: '僅透過活動邀請連結開放的 ECLADO 限定商品。',
    canonicalPath: '/events/limited',
    robots: 'noindex,nofollow',
  });

  function addToCart(product) {
    if (product.isProOnly && !isProfessionalMember(user)) return;
    setCart(previous => {
      const cartKey = getCartKey(product);
      const existing = previous.find(item => getCartKey(item) === cartKey);
      if (existing) {
        return previous.map(item => (
          getCartKey(item) === cartKey ? { ...item, qty: item.qty + 1 } : item
        ));
      }
      return [...previous, { ...product, cartKey, qty: 1 }];
    });
  }

  return (
    <main style={{ paddingTop: 68, minHeight: '100vh', background: 'var(--white)' }}>
      <section style={{ background: 'var(--black)', color: 'var(--white)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '54px 24px 48px' : '82px 32px 72px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <span style={{ width: 30, height: 1, background: 'var(--gold)' }} />
            <p style={{ margin: 0, color: 'var(--gold)', fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase' }}>Private Event Selection</p>
          </div>
          <h1 style={{ margin: '0 0 18px', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: isMobile ? 34 : 52, letterSpacing: '0.04em' }}>活動限定商品</h1>
          <p style={{ margin: 0, maxWidth: 560, color: 'rgba(255,255,255,0.68)', fontSize: 13, lineHeight: 1.9, letterSpacing: '0.04em' }}>
            此頁面僅透過活動邀請開放。商品數量與供應狀態以結帳時顯示為準。
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '42px 20px 72px' : '64px 32px 100px' }}>
        {productsStatus === 'loading' && (
          <div role="status" style={{ textAlign: 'center', padding: '80px 0', color: 'var(--dark)', fontSize: 14 }}>活動商品載入中…</div>
        )}
        {productsStatus === 'error' && (
          <div role="alert" style={{ textAlign: 'center', padding: '80px 0', color: 'var(--dark)', fontSize: 14 }}>
            {productsError || '活動商品資料暫時無法載入，請稍後重新整理。'}
          </div>
        )}
        {productsStatus === 'ready' && products.length > 0 && (
          <div className="g4lg">
            {products.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                user={user}
                onAdd={() => addToCart(product)}
                onSelect={() => onSelectProduct(product)}
                promotions={promotions}
                routeBase="/events/limited"
              />
            ))}
          </div>
        )}
        {productsStatus === 'ready' && products.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 24 }}>活動已結束</h2>
            <p style={{ margin: 0, color: 'var(--dark)', fontSize: 13 }}>目前沒有開放中的活動限定商品。</p>
          </div>
        )}
      </section>
    </main>
  );
}
