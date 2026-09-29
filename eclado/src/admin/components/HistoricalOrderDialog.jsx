import React, { useEffect, useMemo, useState } from 'react';

function emptyItem() {
  return { productId: '', variantId: '', quantity: 1, unitPrice: '' };
}

function todayValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const fieldStyle = {
  width: '100%', border: '1px solid var(--border)', background: 'var(--white)',
  color: 'var(--dark)', padding: '10px 11px', fontSize: 12, fontFamily: 'inherit',
};

export default function HistoricalOrderDialog({ member, products = [], onCreate, onClose }) {
  const [transactionDate, setTransactionDate] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const maximumDate = todayValue();

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const productById = useMemo(
    () => new Map(products.map(product => [String(product.id), product])),
    [products],
  );
  const total = items.reduce((sum, item) => (
    sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0)
  ), 0);

  function updateItem(index, patch) {
    setItems(current => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  }

  function chooseProduct(index, productId) {
    const product = productById.get(String(productId));
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const preferred = variants.find(variant => variant.isDefault) || variants[0];
    updateItem(index, {
      productId: String(productId),
      variantId: preferred ? String(preferred.id) : '',
      unitPrice: '',
    });
  }

  async function submit() {
    setError('');
    if (!transactionDate) {
      setError('請選擇歷史交易日期。');
      return;
    }
    if (transactionDate > maximumDate) {
      setError('歷史交易日期不可晚於今天。');
      return;
    }
    const invalidItem = items.some(item => (
      !item.variantId
      || !Number.isInteger(Number(item.quantity))
      || Number(item.quantity) <= 0
      || item.unitPrice === ''
      || !Number.isFinite(Number(item.unitPrice))
      || Number(item.unitPrice) < 0
    ));
    if (invalidItem) {
      setError('每筆商品都必須選擇規格，數量需大於 0，歷史單價不可小於 0。');
      return;
    }
    setSubmitting(true);
    const result = await onCreate?.({
      memberId: member.id,
      transactionDate,
      items,
      note: note.trim(),
    });
    setSubmitting(false);
    if (!result?.ok) {
      setError(result?.message || '歷史訂單補登失敗，請稍後再試。');
      return;
    }
    onClose(result);
  }

  return (
    <div className="assignment-modal" role="dialog" aria-modal="true" aria-label="補登歷史訂單">
      <button type="button" className="assignment-modal-backdrop" aria-label="關閉歷史訂單視窗" onClick={() => !submitting && onClose()} />
      <div className="assignment-modal-card historical-order-modal-card" style={{ maxWidth: 760 }}>
        <div className="assignment-modal-header">
          <div>
            <h3>補登歷史訂單</h3>
            <p>會員 {member?.name || member?.email}</p>
          </div>
          <button type="button" aria-label="關閉歷史訂單視窗" onClick={() => onClose()} disabled={submitting}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 11, color: 'var(--mid)' }}>
            歷史交易日期
            <input aria-label="歷史交易日期" type="date" max={maximumDate} value={transactionDate} onChange={event => setTransactionDate(event.target.value)} style={fieldStyle} />
          </label>

          <div>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 8 }}>商品明細</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {items.map((item, index) => {
                const product = productById.get(String(item.productId));
                const variants = Array.isArray(product?.variants) ? product.variants : [];
                const lineTotal = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0);
                return (
                  <div key={index} style={{ border: '1px solid var(--border)', background: 'var(--off)', padding: 12 }}>
                    <div className="historical-order-product-grid">
                      <label style={{ display: 'grid', gap: 5, fontSize: 10, color: 'var(--mid)' }}>
                        商品
                        <select aria-label={`歷史商品 ${index + 1}`} value={item.productId} onChange={event => chooseProduct(index, event.target.value)} style={fieldStyle}>
                          <option value="">請選擇商品</option>
                          {products.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.nameZh || candidate.name}</option>)}
                        </select>
                      </label>
                      <label style={{ display: 'grid', gap: 5, fontSize: 10, color: 'var(--mid)' }}>
                        規格／SKU
                        <select aria-label={`歷史規格 ${index + 1}`} value={item.variantId} onChange={event => updateItem(index, { variantId: event.target.value })} disabled={!product} style={fieldStyle}>
                          <option value="">請選擇規格</option>
                          {variants.map(variant => <option key={variant.id} value={variant.id}>{variant.size || '預設規格'} · {variant.sku || '無 SKU'}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="historical-order-price-grid">
                      <label style={{ display: 'grid', gap: 5, fontSize: 10, color: 'var(--mid)' }}>
                        數量
                        <input aria-label={`歷史數量 ${index + 1}`} type="number" min="1" step="1" value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} style={fieldStyle} />
                      </label>
                      <label style={{ display: 'grid', gap: 5, fontSize: 10, color: 'var(--mid)' }}>
                        歷史成交單價
                        <input aria-label={`歷史單價 ${index + 1}`} type="number" min="0" step="1" value={item.unitPrice} onChange={event => updateItem(index, { unitPrice: event.target.value })} placeholder="請輸入當時單價" style={fieldStyle} />
                      </label>
                      <div style={{ paddingBottom: 10 }}>
                        <div style={{ fontSize: 10, color: 'var(--mid)', marginBottom: 5 }}>小計</div>
                        <div style={{ fontSize: 13 }}>NT$ {lineTotal.toLocaleString()}</div>
                      </div>
                      <button type="button" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} disabled={items.length === 1} style={{ padding: '10px 12px', border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--red)', fontSize: 11 }}>移除</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setItems(current => [...current, emptyItem()])} style={{ marginTop: 10, padding: '9px 12px', border: '1px solid var(--dark)', background: 'var(--white)', color: 'var(--dark)', fontSize: 11 }}>＋ 新增商品</button>
          </div>

          <label style={{ display: 'grid', gap: 6, fontSize: 11, color: 'var(--mid)' }}>
            內部備註（選填，會員不會看到）
            <textarea aria-label="歷史訂單內部備註" value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={3} placeholder="例如：官網上線前 LINE 訂購紀錄補登" style={{ ...fieldStyle, resize: 'vertical' }} />
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--mid)' }}>歷史訂單不會扣庫存、付款或出貨</span>
            <strong style={{ fontSize: 15 }}>總額 NT$ {total.toLocaleString()}</strong>
          </div>
          {error && <div className="assignment-error">{error}</div>}
        </div>

        <div className="assignment-actions">
          <button type="button" onClick={() => onClose()} disabled={submitting}>取消</button>
          <button type="button" className="primary" onClick={submit} disabled={submitting}>{submitting ? '建立中…' : '確認補登'}</button>
        </div>
      </div>
    </div>
  );
}
