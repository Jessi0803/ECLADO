import React from 'react';
import { getOrderPriceAdjustments } from '../domain/orderDiscounts.js';

export default function OrderPriceAdjustments({ order, style = {} }) {
  return getOrderPriceAdjustments(order).map((row, index) => (
    <div key={`${row.name}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, minWidth: 0, fontSize: 12, color: 'var(--accent)', marginTop: 6, ...style }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.name}</span><span style={{ whiteSpace: 'nowrap' }}>{row.amount < 0 ? '+' : '−'}NT$ {Math.abs(row.amount).toLocaleString('zh-TW')}</span>
    </div>
  ));
}
