import React from 'react';
import ProductDetail from '../components/product/ProductDetail.jsx';
import {
  getCartKey,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import { getProductSlug } from '../app/routes.js';

export default function ProductPage({
  productSlug,
  products,
  productsStatus = 'ready',
  productsError = '',
  user,
  setCart,
  promotions,
  onBack,
  onShop,
}) {
  const product = products.find(item => getProductSlug(item.name) === productSlug);

  function addToCart(selectedProduct) {
    if (selectedProduct.isProOnly && !isProfessionalMember(user)) return;
    setCart(previous => {
      const cartKey = getCartKey(selectedProduct);
      const existing = previous.find(item => getCartKey(item) === cartKey);
      if (existing) {
        return previous.map(item => (
          getCartKey(item) === cartKey ? { ...item, qty: item.qty + 1 } : item
        ));
      }
      return [...previous, { ...selectedProduct, cartKey, qty: 1 }];
    });
  }

  if (productsStatus === 'loading') {
    return (
      <div role="status" style={{ padding:'160px 24px 100px', minHeight:'70vh', textAlign:'center', color:'var(--dark)', fontSize:14 }}>
        商品載入中…
      </div>
    );
  }

  if (productsStatus === 'error') {
    return (
      <div role="alert" style={{ padding:'160px 24px 100px', minHeight:'70vh', textAlign:'center' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, marginBottom:16 }}>商品資料暫時無法載入</h1>
        <p style={{ color:'var(--dark)', fontSize:14, marginBottom:28 }}>{productsError || '請稍後重新整理頁面。'}</p>
        <button onClick={onShop} style={{ background:'var(--black)', color:'var(--white)', border:0, padding:'12px 28px', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.12em' }}>返回商品列表</button>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ padding:'160px 24px 100px', minHeight:'70vh', textAlign:'center' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, marginBottom:16 }}>找不到此商品</h1>
        <p style={{ color:'var(--dark)', fontSize:14, marginBottom:28 }}>商品可能已下架，或分享網址不正確。</p>
        <button onClick={onShop} style={{ background:'var(--black)', color:'var(--white)', border:0, padding:'12px 28px', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.12em' }}>返回商品列表</button>
      </div>
    );
  }

  return (
    <ProductDetail
      product={product}
      user={user}
      onAdd={addToCart}
      onBack={onBack}
      promotions={promotions}
    />
  );
}
