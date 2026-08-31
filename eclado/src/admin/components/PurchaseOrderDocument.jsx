import React from 'react';
import { formatUsd } from '../utils/purchaseOrderExport.js';

const STATUS_LABELS = {
  draft: '草稿', pending: '待下單', ordered: '已下單',
  shipping: '運送中', received: '已到貨', cancelled: '已取消',
};

export default function PurchaseOrderDocument({ order, documentRef }) {
  const address = order.shipping_address || {};
  return (
    <div ref={documentRef} className="purchase-order-document">
      <h2>PURCHASE ORDER (叫貨單)</h2>
      <div className="purchase-order-document-meta">
        <div>PO Number: {order.po_number || '儲存後產生'}</div>
        <div>Supplier / 供應來源: ECLADO</div>
        <div>Shipping Address / 收件地址:</div>
        <div>{address.address_text || ''}</div>
        <div>Status: {STATUS_LABELS[order.status] || order.status || '草稿'}</div>
        <div>Created: {new Date(order.created_at || Date.now()).toLocaleString('zh-TW')}</div>
      </div>

      <table>
        <thead><tr>
          <th>Product Code</th><th>Chinese Name</th><th>English Name</th>
          <th>Qty</th><th>Unit Price</th><th>Subtotal</th>
        </tr></thead>
        <tbody>
          {(order.items || []).map(item => (
            <tr key={item.id || item.product_variant_id}>
              <td>{item.product_sku}</td>
              <td>{[item.name_zh, item.specification].filter(Boolean).join(' ')}</td>
              <td>{item.name_en || '—'}</td>
              <td>{item.quantity}</td>
              <td>{formatUsd(item.unit_cost)}</td>
              <td>{formatUsd(item.subtotal_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="purchase-order-document-totals">
        <div><span>Total:</span><strong>{formatUsd(order.total_usd)}</strong></div>
      </div>
      {order.notes && <div className="purchase-order-document-notes">Notes / 備註：{order.notes}</div>}
    </div>
  );
}
