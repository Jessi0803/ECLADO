import React from 'react';
import { getOrderPriceAdjustments } from '../domain/orderDiscounts.js';

export default function OrderPriceAdjustments({ order, style = {} }) {
  return getOrderPriceAdjustments(order).map((row, index) => (
    <div key={`${row.name}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--accent)', marginTop: 6, ...style }}>
      <span>{row.name}</span><span>{row.amount < 0 ? '+' : '−'}NT$ {Math.abs(row.amount).toLocaleString('zh-TW')}</span>
    </div>
  ));
}
