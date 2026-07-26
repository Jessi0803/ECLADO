import React from 'react';

export default function CheckoutChoiceModal({ onClose, onLoginCheckout, onGuestCheckout }) {
  return (
    <div onClick={onClose} role="presentation" style={{ position:'fixed', inset:0, background:'rgba(20,20,18,0.48)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="checkout-choice-title" onClick={event => event.stopPropagation()} style={{ width:'100%', maxWidth:460, background:'var(--white)', padding:'32px 28px 28px', boxShadow:'0 22px 60px rgba(0,0,0,0.18)', position:'relative' }}>
        <button type="button" aria-label="關閉" onClick={onClose} style={{ position:'absolute', top:16, right:16, width:28, height:28, border:'1px solid var(--light)', background:'none', color:'var(--dark)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
        <p style={{ fontSize:10, letterSpacing:'0.24em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Checkout</p>
        <h2 id="checkout-choice-title" style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:300, color:'var(--black)', marginBottom:12 }}>請選擇結帳方式</h2>
        <p style={{ fontSize:13, color:'var(--dark)', lineHeight:1.8, marginBottom:24 }}>註冊會員享有不定時優惠。</p>
        <div style={{ display:'grid', gap:12 }}>
          <button type="button" onClick={onLoginCheckout} style={{ width:'100%', background:'var(--black)', color:'var(--white)', border:'none', padding:'15px', fontSize:12, letterSpacing:'0.16em', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500 }}>登入會員結帳</button>
          <button type="button" onClick={onGuestCheckout} style={{ width:'100%', background:'var(--white)', color:'var(--black)', border:'1px solid var(--black)', padding:'15px', fontSize:12, letterSpacing:'0.16em', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500 }}>訪客結帳</button>
        </div>
      </div>
    </div>
  );
}
