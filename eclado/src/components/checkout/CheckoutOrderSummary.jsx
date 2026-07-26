import React from 'react';
import {
  getCartKey,
  getFulfillmentInfo,
  getMemberPrice,
} from '../../domain/catalog.jsx';

export default function CheckoutOrderSummary({ items, summary, user }) {
  const hasPreorderItem = items.some(item => getFulfillmentInfo(item).type === 'preorder');

  return (
    <div style={{ background:'var(--off-white)', padding:'28px 24px', height:'fit-content' }}>
      <h3 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:400, marginBottom:20, letterSpacing:'0.04em' }}>訂單明細</h3>
      {hasPreorderItem && (
        <div style={{ background:'var(--white)', border:'1px solid var(--gold)', padding:'12px 14px', marginBottom:16, fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>
          訂單含預購商品，預購品項出貨時間為 7-14 個工作天。
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:18 }}>
        {items.map(item => {
          const unitPrice = getMemberPrice(item, user);
          const fulfillment = getFulfillmentInfo(item);
          return (
            <div key={getCartKey(item)} style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ width:48, height:48, flexShrink:0, position:'relative' }}>
                <img src={item.img} alt={item.nameZh} style={{ width:'100%', height:'100%', objectFit:'contain', background:'var(--off-white)', display:'block' }} />
                <div style={{ position:'absolute', top:-6, right:-6, width:18, height:18, borderRadius:'50%', background:'var(--dark)', color:'var(--white)', fontSize:10, display:'flex', alignItems:'center', justifyContent:'center' }}>{item.qty}</div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, color:'var(--black)', marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.nameZh}</p>
                <p style={{ fontSize:11, color:'var(--dark)' }}>{item.size}</p>
                <p style={{ fontSize:10, color: fulfillment.type === 'preorder' ? 'var(--gold)' : 'var(--dark)', marginTop:3, lineHeight:1.45 }}>{fulfillment.type === 'loading' ? '庫存資料載入中' : `${fulfillment.label} · ${fulfillment.shipping.replace('出貨時間為 ', '')}`}</p>
              </div>
              <span style={{ fontSize:13, color:'var(--black)', flexShrink:0, fontFamily:'var(--font-display)' }}>NT$ {(unitPrice * item.qty).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
      <div style={{ height:1, background:'var(--light)', marginBottom:14 }} />
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--dark)', marginBottom:8 }}>
        <span>小計</span><span style={{ fontFamily:'var(--font-display)' }}>NT$ {summary.subtotal.toLocaleString()}</span>
      </div>
      {summary.discount > 0 && summary.promotion && (
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--gold)', marginBottom:8 }}>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ background:'var(--gold)', color:'var(--white)', fontSize:9, padding:'1px 5px', letterSpacing:'0.06em' }}>活動</span>
            {summary.promotion.name}
          </span>
          <span style={{ fontFamily:'var(--font-display)' }}>−NT$ {summary.discount.toLocaleString()}</span>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--dark)', marginBottom:14, alignItems:'center' }}>
        <span>運費 <span style={{ fontSize:10, color:'var(--dark)' }}>（宅配到府）</span></span>
        <span style={{ fontFamily:'var(--font-display)' }}>{summary.shipping === 0 ? <span style={{ color:'var(--gold)', fontFamily:'var(--font-body)' }}>免運</span> : `NT$ ${summary.shipping}`}</span>
      </div>
      <div style={{ height:1, background:'var(--light)', marginBottom:14 }} />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <span style={{ fontSize:13, fontWeight:500 }}>合計</span>
        <span style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:300 }}>NT$ {summary.total.toLocaleString()}</span>
      </div>
    </div>
  );
}
