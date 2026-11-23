import React, { forwardRef } from 'react';
import './PriceUpdateNotice.css';

const money = value => `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;

const PriceUpdateNotice = forwardRef(function PriceUpdateNotice({ previous, updated }, ref) {
  const amountChanged = Number(previous.paymentTotal) !== Number(updated.paymentTotal);
  return <section ref={ref} className="price-update-notice" role="alert" tabIndex={-1}
    aria-labelledby="price-update-title" aria-describedby="price-update-description">
    <h3 id="price-update-title">{amountChanged ? '訂單金額已更新' : '訂單優惠內容已更新'}</h3>
    {amountChanged && <p className="price-update-notice__previous">原應付金額 <s>{money(previous.paymentTotal)}</s></p>}
    <div className="price-update-notice__total"><span>目前應付金額</span><strong>{money(updated.paymentTotal)}</strong></div>
    {['shoppingCreditAmount', 'rewardCreditAmount'].some(key => Number(previous[key]) || Number(updated[key])) &&
      <p className="price-update-notice__credits">使用購物金 {money(updated.shoppingCreditAmount)} · 返饋金 {money(updated.rewardCreditAmount)}</p>}
    <p id="price-update-description">已保留填寫資料。請確認更新內容後，再按下方按鈕繼續付款。</p>
  </section>;
});

export default PriceUpdateNotice;
