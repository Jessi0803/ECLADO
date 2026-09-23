import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_MAP } from './StatusIndicators.jsx';

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return `NT$ ${Math.round(numberValue(value)).toLocaleString('zh-TW')}`;
}

function negativeMoney(value) {
  return `-NT$ ${Math.round(Math.abs(numberValue(value))).toLocaleString('zh-TW')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replaceAll('-', ' / ');
  return date.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replaceAll('/', ' / ');
}

function itemUnitPrice(item) {
  return numberValue(item.unit_price ?? item.price);
}

function itemLineTotal(item) {
  const savedLineTotal = Number(item.line_total);
  if (Number.isFinite(savedLineTotal)) return savedLineTotal;
  return itemUnitPrice(item) * numberValue(item.qty);
}

function itemCode(item) {
  return item.sku || item.variant_sku || item.product_sku || item.product_id || item.id || '—';
}

function itemName(item) {
  return item.nameZh || item.name_zh || item.name || '商品';
}

function itemSize(item) {
  return item.size || item.variant_name || item.variantName || '';
}

function invoiceTypeLabel(type) {
  if (type === 'company') return '公司發票';
  if (type === 'personal') return '個人發票';
  return '';
}

export default function OrderPrintPreview({ order, onClose }) {
  useEffect(() => {
    function handleKeydown(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onClose]);

  function printOrder() {
    document.body.classList.add('eclado-order-printing');
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('eclado-order-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // afterprint is supported by current browsers; timeout is only a safety net.
    window.setTimeout(cleanup, 60_000);
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const savedSubtotal = Number(order.subtotal);
  const subtotal = Number.isFinite(savedSubtotal)
    ? savedSubtotal
    : items.reduce((sum, item) => sum + itemLineTotal(item), 0);
  const discount = Math.max(0, numberValue(order.discount));
  const shoppingCreditDiscount = Math.max(0, numberValue(order.shoppingCreditDiscount));
  const shipping = Math.max(0, numberValue(order.shipping));
  const isCompanyInvoice = order.invoiceType === 'company';

  return createPortal(
    <div className="order-print-overlay" role="dialog" aria-modal="true" aria-label="訂單列印預覽">
      <div className="order-print-actions">
        <button type="button" onClick={onClose}>關閉</button>
        <button type="button" className="order-print-primary" onClick={printOrder}>列印</button>
      </div>
      <article className="order-print-document">
        <header className="order-print-header">
          <img src="/assets/images/ECLADO LOGO with CI_BLUE.png" alt="ECLADO TAIWAN" />
          <div>
            <h1>訂單明細</h1>
            <p>ORDER INVOICE</p>
          </div>
        </header>

        <div className="order-print-rule" />

        <section className="order-print-customer-section">
          <div className="order-print-recipient">
            <p className="order-print-eyebrow">{order.fulfillmentMethod === 'onsite_pickup' ? '訂購資訊' : '收件資訊'}</p>
            <h2>{order.member || '—'}</h2>
            {order.studioName && <p className="order-print-studio">{order.studioName}</p>}
            {order.phone && <p><span aria-hidden="true">☎</span>{order.phone}</p>}
            {order.email && <p><span aria-hidden="true">✉</span>{order.email}</p>}
            {order.fulfillmentMethod !== 'onsite_pickup' && order.address && <p><span aria-hidden="true">⌖</span>{order.address}</p>}
            {order.fulfillmentMethod === 'onsite_pickup' && <p>門市自取</p>}
          </div>
          <dl className="order-print-order-card">
            <div className="order-print-order-card-title">訂單資訊</div>
            <div><dt>訂單編號</dt><dd>{order.id || '—'}</dd></div>
            <div><dt>訂單日期</dt><dd>{formatDate(order.createdAt || order.date)}</dd></div>
            <div><dt>狀態</dt><dd>{STATUS_MAP[order.status]?.label || order.status || '—'}</dd></div>
          </dl>
        </section>

        <table className="order-print-items">
          <thead>
            <tr>
              <th>編號</th>
              <th>品項</th>
              <th>數量</th>
              <th>單價</th>
              <th>金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const gift = item.is_gift || item.line_type === 'gift';
              return (
                <tr key={`${itemCode(item)}-${index}`}>
                  <td>{itemCode(item)}</td>
                  <td>
                    <strong>{itemName(item)}</strong>
                    {itemSize(item) && <span>{itemSize(item)}</span>}
                    {gift && <span>贈品</span>}
                  </td>
                  <td>{numberValue(item.qty)}</td>
                  <td>{gift ? 'NT$ 0' : money(itemUnitPrice(item))}</td>
                  <td>{gift ? 'NT$ 0' : money(itemLineTotal(item))}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan="5" className="order-print-empty">此訂單沒有商品明細</td></tr>}
          </tbody>
        </table>

        <section className="order-print-summary" aria-label="訂單金額">
          <div><span>小計</span><strong>{money(subtotal)}</strong></div>
          <div><span>運費</span><strong>{shipping === 0 ? '—' : money(shipping)}</strong></div>
          {discount > 0 && <div><span>{order.couponName ? '優惠券折抵' : '優惠折抵'}</span><strong>{negativeMoney(discount)}</strong></div>}
          {shoppingCreditDiscount > 0 && <div><span>購物金折抵</span><strong>{negativeMoney(shoppingCreditDiscount)}</strong></div>}
          <div className="order-print-total"><span>應付總計</span><strong>{money(order.total)}</strong></div>
        </section>

        {(order.invoiceType || order.invoiceNumber || order.note) && (
          <section className="order-print-notes">
            {(order.invoiceType || order.invoiceNumber) && (
              <div>
                <strong>發票資訊</strong>
                <p>
                  {[invoiceTypeLabel(order.invoiceType),
                    isCompanyInvoice && order.invoiceCompanyName ? order.invoiceCompanyName : '',
                    isCompanyInvoice && order.invoiceTaxId ? `統編 ${order.invoiceTaxId}` : '',
                    order.invoiceNumber ? `發票號碼 ${order.invoiceNumber}` : '']
                    .filter(Boolean).join('｜')}
                </p>
              </div>
            )}
            {order.note && <div><strong>顧客訂單備註</strong><p>{order.note}</p></div>}
          </section>
        )}

        <footer className="order-print-footer">
          <span>ECLADO TAIWAN ・ 感謝您的訂購</span>
          <span>列印日期：{formatDate(new Date().toISOString())}</span>
        </footer>
      </article>
    </div>,
    document.body,
  );
}
