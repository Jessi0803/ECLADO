import React, { useState } from 'react';
import CheckoutChoiceModal from '../components/cart/CheckoutChoiceModal.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import { CHECKOUT_LOGIN_REDIRECT_KEY } from '../app/authSession.js';
import {
  getCartKey,
  getFulfillmentInfo,
  getMemberPrice,
} from '../domain/catalog.jsx';
import {
  calculateDiscount,
  isPromotionLive,
} from '../domain/promotions.js';
import { calculateShipping } from '../domain/shipping.js';

// ─── CART PAGE ────────────────────────────────────────────────────────────────
export default function CartPage({ cart, setCart, setPage, user, promotions = [] }) {
  const isMobile = useIsMobile();
  const [showCheckoutChoice, setShowCheckoutChoice] = useState(false);
  function updateQty(key, delta) {
    setCart(prev => prev.map(i => getCartKey(i) === key ? { ...i, qty: Math.max(0, i.qty+delta) } : i).filter(i => i.qty>0));
  }
  function handleCheckoutClick() {
    if (user) {
      setPage('checkout');
      return;
    }
    setShowCheckoutChoice(true);
  }
  function handleLoginCheckout() {
    sessionStorage.setItem(CHECKOUT_LOGIN_REDIRECT_KEY, 'checkout');
    setShowCheckoutChoice(false);
    setPage('login');
  }
  function handleGuestCheckout() {
    setShowCheckoutChoice(false);
    setPage('checkout');
  }
  const { subtotal, discount, finalSubtotal, promotion } = calculateDiscount(cart, promotions, user);
  const shipping = calculateShipping(cart);
  const grandTotal = finalSubtotal + shipping;

  return (
    <div style={{ paddingTop:68, minHeight:'80vh' }}>
      <div style={{ maxWidth:900, margin:'0 auto', padding: isMobile ? '40px 20px' : '60px 32px' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:14, marginBottom:40 }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 30 : 40, fontWeight:300 }}>購物車</h1>
          <span style={{ fontSize:14, color:'var(--dark)' }}>{cart.length} 件商品</span>
        </div>

        {cart.length > 0 && promotions.some(isPromotionLive) && discount === 0 && (
          <div style={{ background:'var(--off-white)', border:'1px solid var(--gold)', padding:'14px 18px', marginBottom:24, fontSize:13, color:'var(--dark)', lineHeight:1.65 }}>
            目前有<strong>限時優惠</strong>，但購物車內還沒有「活動指定商品」，所以尚無折抵。
          </div>
        )}

        {cart.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px 0' }}>
            <p style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, color:'var(--dark)', marginBottom:24 }}>購物車是空的</p>
            <button onClick={() => setPage('shop')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 36px', fontSize:12, letterSpacing:'0.15em', cursor:'pointer', fontFamily:'var(--font-body)' }}>繼續購物</button>
          </div>
        ) : (
          <div className="gcart">
            <div>
              {cart.map(item => {
                const fulfillment = getFulfillmentInfo(item);
                return (
                  <div key={getCartKey(item)} style={{ display:'grid', gridTemplateColumns:'72px 1fr auto', gap:16, alignItems:'center', padding:'20px 0', borderBottom:'1px solid var(--light)' }}>
                    <img src={item.img} alt={item.nameZh} style={{ width:72, height:72, objectFit:'contain', background:'var(--off-white)', display:'block' }} />
                    <div>
                      <p style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:400, marginBottom:3 }}>{item.name}</p>
                      <p style={{ fontSize:12, color:'var(--dark)', marginBottom:6 }}>{item.nameZh} · {item.size}</p>
                      <p style={{ fontSize:11, color: fulfillment.type === 'preorder' ? 'var(--gold)' : 'var(--dark)', marginBottom:10, lineHeight:1.5 }}>{fulfillment.type === 'loading' ? '庫存資料載入中' : `${fulfillment.label} · ${fulfillment.shipping}`}</p>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <button onClick={() => updateQty(getCartKey(item),-1)} style={{ width:26, height:26, border:'1px solid var(--light)', background:'none', cursor:'pointer', fontSize:15, lineHeight:1 }}>−</button>
                        <span style={{ fontSize:14, minWidth:20, textAlign:'center', fontFamily:'var(--font-display)' }}>{item.qty}</span>
                        <button onClick={() => updateQty(getCartKey(item),1)} style={{ width:26, height:26, border:'1px solid var(--light)', background:'none', cursor:'pointer', fontSize:15, lineHeight:1 }}>+</button>
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <p style={{ fontSize:14, fontWeight:500, fontFamily:'var(--font-display)' }}>NT$ {(getMemberPrice(item, user)*item.qty).toLocaleString()}</p>
                      <button onClick={() => updateQty(getCartKey(item),-item.qty)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--dark)', marginTop:6 }}>移除</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ background:'var(--off-white)', padding:'28px', height:'fit-content' }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:400, marginBottom:20 }}>訂單摘要</h3>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10, fontSize:13 }}><span>小計</span><span style={{ fontFamily:'var(--font-display)' }}>NT$ {subtotal.toLocaleString()}</span></div>
              {discount > 0 && promotion && (
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10, fontSize:13, color:'var(--gold)' }}>
                  <span>{promotion.name}</span>
                  <span style={{ fontFamily:'var(--font-display)' }}>−NT$ {discount.toLocaleString()}</span>
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10, fontSize:13 }}>
                <span>運費</span>
                <span style={{ fontFamily:'var(--font-display)' }}>{shipping === 0 ? <span style={{ color:'var(--gold)', fontFamily:'var(--font-body)' }}>免運</span> : `NT$ ${shipping}`}</span>
              </div>
              <div style={{ height:1, background:'var(--light)', margin:'16px 0' }} />
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:24, fontWeight:500 }}>
                <span style={{ fontSize:14 }}>合計</span>
                <span style={{ fontFamily:'var(--font-display)', fontSize:18 }}>NT$ {grandTotal.toLocaleString()}</span>
              </div>
              <button onClick={handleCheckoutClick} style={{ width:'100%', background:'var(--black)', color:'var(--white)', border:'none', padding:'15px', fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500 }}
                onMouseEnter={e=>e.target.style.background='#333'}
                onMouseLeave={e=>e.target.style.background='var(--black)'}
              >前往結帳</button>
              <p style={{ textAlign:'center', fontSize:11, color:'var(--dark)', marginTop:14 }}>支援：虛擬帳號匯款 / 信用卡 / Apple Pay / Google Pay</p>
            </div>
          </div>
        )}
      </div>
      {showCheckoutChoice && (
        <CheckoutChoiceModal
          onClose={() => setShowCheckoutChoice(false)}
          onLoginCheckout={handleLoginCheckout}
          onGuestCheckout={handleGuestCheckout}
        />
      )}
    </div>
  );
}

// ─── CHECKOUT FIELD (must be outside CheckoutPage to avoid remount on every keystroke) ───
