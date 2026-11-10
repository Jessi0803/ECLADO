import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import './InventoryReceiptsPage.css';

const PAGE_SIZE = 25;
const SUMMARY_FIELDS = [
  ['received_on', '入庫日期', 'date'],
  ['exchange_rate', '付款匯率（TWD／USD）', '0.000001'],
  ['payment_fee_twd', '支付手續費（TWD）', '0.01'],
  ['customs_twd', '關稅（TWD）', '0.01'],
  ['freight_twd', '運費（TWD）', '0.01'],
];

const money = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitCost = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const taipeiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' });
const taipeiTime = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' });

function newReceipt() {
  return {
    id: crypto.randomUUID(), version: 0, received_on: taipeiDate.format(new Date()),
    exchange_rate: '', payment_fee_twd: '0', customs_twd: '0', freight_twd: '0', items: [],
  };
}

async function request(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (['40P01', '55P03'].includes(error?.code)) {
    throw new Error('商品庫存正在處理其他作業，請稍後再試。');
  }
  if (error) throw error;
  return data;
}

function ReceiptCosts({ receipt }) {
  const columns = ['商品規格', '數量', '每件重量（g）', 'USD 單價', '台幣貨款', '支付手續費', '關稅', '運費', '成本小計', '每件實際成本'];
  return (
    <section className="procurement-form-card receipt-costs">
      <h2>{receipt.posted_at ? '入庫成本明細' : '入庫成本預覽'}</h2>
      <dl className="receipt-summary">
        {SUMMARY_FIELDS.map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd>{key.endsWith('_twd') ? money.format(receipt[key]) : receipt[key]}</dd></div>
        ))}
        <div><dt>全單成本（TWD）</dt><dd>{money.format(receipt.total_twd)}</dd></div>
        {receipt.posted_at && <div><dt>確認入庫時間</dt><dd>{taipeiTime.format(new Date(receipt.posted_at))}</dd></div>}
      </dl>
      <div className="table-scroll">
        <table className="responsive-admin-table procurement-items-table">
          <thead><tr>{columns.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{receipt.items.map(item => {
            const values = [
              `${item.product_name} · ${item.variant_name} · ${item.sku}`, item.quantity, item.unit_weight_g,
              item.unit_cost_usd, money.format(item.goods_twd), money.format(item.payment_fee_twd),
              money.format(item.customs_twd), money.format(item.freight_twd), money.format(item.total_twd),
              unitCost.format(item.unit_cost_twd),
            ];
            return <tr key={item.variant_id}>{values.map((value, i) => <td key={columns[i]} data-label={columns[i]}>{value}</td>)}</tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function ReceiptProductPicker({ items, sourceItems, onApply, onClose }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(() => new Map(items.map(item => [item.variant_id, item])));
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sourceItems || filter === 'selected') return;
    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const results = await request('search_inventory_receipt_variants', { p_query: query.trim() });
        if (active) setMatches(results || []);
      } catch (failure) {
        if (active) setError(failure.message || '無法載入商品規格。');
      } finally {
        if (active) setLoading(false);
      }
    }, query.trim() ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, filter, sourceItems]);

  const keyword = query.trim().toLowerCase();
  const available = filter === 'selected' ? [...selected.values()] : sourceItems || matches;
  const visible = filter === 'all' && !sourceItems ? available : available.filter(item =>
    [item.sku, item.product_name, item.variant_name].some(value => String(value || '').toLowerCase().includes(keyword)));
  const showResults = !!sourceItems || filter === 'selected' || (!loading && !error);

  function toggle(item) {
    setSelected(current => {
      const next = new Map(current);
      if (next.has(item.variant_id)) next.delete(item.variant_id);
      else next.set(item.variant_id, items.find(line => line.variant_id === item.variant_id) || { ...item, quantity: item.quantity ?? '1' });
      return next;
    });
  }

  return (
    <div className="procurement-modal-backdrop">
      <div className="procurement-modal product-picker-modal" role="dialog" aria-modal="true" aria-label="選擇入庫商品"
        onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <div className="procurement-modal-header">
          <div><h2>選擇入庫商品</h2><p>目前已選 {selected.size} 項</p></div>
          <button type="button" aria-label="關閉商品選擇" onClick={onClose}>×</button>
        </div>
        <div className="product-picker-controls">
          <input autoFocus aria-label="搜尋商品規格" placeholder="搜尋 SKU、中文名稱、英文名稱或規格"
            maxLength={100} value={query} onChange={event => {
              setQuery(event.target.value);
              if (filter === 'all') setLoading(true);
            }} />
          <div>
            {[['all', '全部'], ['selected', '已選']].map(([value, label]) => (
              <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value}
                onClick={() => { if (value !== filter && value === 'all') setLoading(true); setFilter(value); }}>{label}</button>
            ))}
          </div>
        </div>
        <div className="product-picker-list">
          {!sourceItems && filter === 'all' && loading && <p className="procurement-empty" role="status">載入商品中…</p>}
          {filter === 'all' && !loading && error && <p className="procurement-empty" role="alert">{error}</p>}
          {showResults && visible.map(item => (
            <label key={item.variant_id} className={selected.has(item.variant_id) ? 'selected' : ''}>
              <input type="checkbox" checked={selected.has(item.variant_id)} onChange={() => toggle(item)} />
              <div>
                <strong>{item.sku} · {item.product_name} · {item.variant_name}</strong>
                <small>進貨成本 {item.unit_cost_usd == null ? '待填寫' : `US$${item.unit_cost_usd}`}</small>
              </div>
              <span>{item.unit_weight_g == null ? '重量待填寫' : `${item.unit_weight_g} g`}</span>
            </label>
          ))}
          {showResults && visible.length === 0 && <p className="procurement-empty">沒有符合的商品規格。</p>}
          {showResults && !sourceItems && filter === 'all' && visible.length === 50 && <p className="procurement-empty">目前顯示前 50 項，可搜尋其他規格。</p>}
        </div>
        <div className="procurement-modal-footer">
          <button type="button" className="admin-secondary-btn" onClick={() => setSelected(new Map())}>清除選取</button>
          <div>
            <button type="button" className="admin-secondary-btn" onClick={onClose}>取消</button>
            <button type="button" className="admin-primary-btn" onClick={() => onApply([...selected.values()])}>加入 {selected.size} 項商品</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InventoryReceiptsPage({ initialReceipt, onInitialReceiptOpened, onInventoryChanged }) {
  const [list, setList] = useState([]);
  const [offset, setOffset] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [receipt, setReceipt] = useState(initialReceipt || null);
  const [mode, setMode] = useState(initialReceipt ? initialReceipt.posted_at ? 'posted' : 'edit' : 'list');
  const sourceItems = receipt?.source_items;
  const availableSourceItems = sourceItems?.filter(item => item.quantity > 0);

  useEffect(() => {
    if (initialReceipt) onInitialReceiptOpened?.();
  }, [initialReceipt, onInitialReceiptOpened]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (mode !== 'list') return;
    let active = true;
    setListLoading(true);
    request('get_inventory_receipts', { p_offset: offset })
      .then(data => { if (active) setList(data || []); })
      .catch(failure => {
        if (!active) return;
        setList([]);
        setError(failure.message || '無法讀取入庫單。');
      })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [mode, offset]);

  async function run(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure.message || '作業失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }

  function returnToList() {
    setError('');
    setNotice('');
    setReceipt(null);
    setMode('list');
  }

  function editReceipt(value) {
    setReceipt(value);
    setError('');
    setNotice('');
    setMode('edit');
  }

  function openReceipt(id) {
    run(async () => {
      const detail = await request('get_inventory_receipts', { p_receipt_id: id });
      if (!detail) throw new Error('找不到入庫單。');
      setReceipt(detail);
      setMode(detail.posted_at ? 'posted' : detail.preview_ready === false ? 'edit' : 'preview');
    });
  }

  function updateItem(id, key, value) {
    setReceipt(current => ({
      ...current,
      items: current.items.map(item => item.variant_id === id ? { ...item, [key]: value } : item),
    }));
  }

  function preview(event) {
    event.preventDefault();
    if (!receipt.items.length) {
      setError('請至少加入一項商品規格。');
      return;
    }
    run(async () => {
      const saved = await request('save_inventory_receipt', {
        p_id: receipt.id,
        p_version: receipt.version,
        p_received_on: receipt.received_on,
        p_exchange_rate: receipt.exchange_rate,
        p_payment_fee_twd: receipt.payment_fee_twd,
        p_customs_twd: receipt.customs_twd,
        p_freight_twd: receipt.freight_twd,
        p_items: receipt.items.map(({ variant_id, quantity, unit_cost_usd, unit_weight_g }) => (
          { variant_id, quantity, unit_cost_usd, unit_weight_g }
        )),
      });
      setReceipt(saved);
      setMode(saved.posted_at ? 'posted' : 'preview');
    });
  }

  function post() {
    run(async () => {
      const posted = await request('post_inventory_receipt', { p_id: receipt.id, p_version: receipt.version });
      setReceipt(posted);
      setMode('posted');
      setNotice('已確認入庫並保存成本明細。');
      try {
        await onInventoryChanged?.();
      } catch {
        setNotice('已確認入庫。請重新整理後台以更新庫存顯示。');
      }
    });
  }

  return (
    <div className="procurement-page inventory-receipts">
      <div className="procurement-header">
        <div>
          {mode !== 'list' && <button className="procurement-back" type="button" onClick={returnToList} disabled={busy}>← 返回入庫單</button>}
          <h1>{mode === 'list' ? '入庫單管理' : receipt?.receipt_no ? `入庫單 #${receipt.receipt_no}` : '建立入庫單'}</h1>
          {receipt?.purchase_order_no && <p>來源叫貨單 {receipt.purchase_order_no}</p>}
          <p>{mode === 'list' ? '建立入庫單、預覽成本及查詢歷史紀錄' : '依各商品規格的入庫總重量分攤費用'}</p>
        </div>
        <div className="procurement-header-actions">
          {mode === 'list' && <button className="admin-primary-btn" type="button" disabled={busy} onClick={() => editReceipt(newReceipt())}>新增入庫單</button>}
          {mode === 'edit' && (
            <button className="admin-primary-btn" type="submit" form="inventory-receipt-form" disabled={busy || !receipt.items.length}>
              {busy ? '處理中…' : '儲存草稿並預覽'}
            </button>
          )}
          {mode === 'preview' && <>
            <button className="admin-secondary-btn" type="button" disabled={busy} onClick={() => editReceipt(receipt)}>編輯草稿</button>
            <button className="admin-primary-btn" type="button" disabled={busy} onClick={post}>{busy ? '入庫中…' : '確認入庫'}</button>
          </>}
        </div>
      </div>
      {error && <div className="procurement-error" role="alert">{error}</div>}
      {notice && <p role="status">{notice}</p>}
      {mode === 'list' && (
        <section className="procurement-form-card" aria-label="入庫單紀錄">
          {listLoading ? <p role="status">載入中…</p> : list.length === 0 ? <p>目前沒有入庫單。</p> : (
            <div className="table-scroll">
              <table className="responsive-admin-table procurement-items-table">
                <thead><tr><th>單號</th><th>入庫日期</th><th>狀態</th><th>全單成本（TWD）</th><th>明細</th></tr></thead>
                <tbody>{list.slice(0, PAGE_SIZE).map(item => (
                  <tr key={item.id}>
                    <td data-label="單號">#{item.receipt_no}</td><td data-label="入庫日期">{item.received_on}</td>
                    <td data-label="狀態">{item.posted_at ? '已入庫' : '草稿'}</td>
                    <td data-label="全單成本（TWD）">{item.total_twd == null ? '—' : money.format(item.total_twd)}</td>
                    <td data-label="明細"><button className="admin-secondary-btn" type="button" disabled={busy} onClick={() => openReceipt(item.id)}>查看 #{item.receipt_no}</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {(offset > 0 || list.length > PAGE_SIZE) && <div className="receipt-actions">
            <button className="admin-secondary-btn" type="button" disabled={busy || listLoading || offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>上一頁</button>
            <span>第 {offset / PAGE_SIZE + 1} 頁</span>
            <button className="admin-secondary-btn" type="button" disabled={busy || listLoading || list.length <= PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>下一頁</button>
          </div>}
        </section>
      )}
      {mode === 'edit' && (
        <form id="inventory-receipt-form" onSubmit={preview}>
          <fieldset className="receipt-fields" disabled={busy} aria-label="入庫資料">
            <div className="procurement-form-card">
              <div className="procurement-form-grid">
                {SUMMARY_FIELDS.map(([key, label, step]) => (
                  <label key={key}>{label}
                    <input type={step === 'date' ? 'date' : 'number'} required value={receipt[key] ?? ''}
                      step={step === 'date' ? undefined : step} min={step === 'date' ? undefined : key === 'exchange_rate' ? step : '0'}
                      onChange={event => setReceipt({ ...receipt, [key]: event.target.value })} />
                  </label>
                ))}
              </div>
            </div>

            <section className="procurement-section-card" aria-label="商品明細">
              <div className="procurement-section-heading">
                <div>
                  <h2>入庫商品</h2>
                  <p>請填寫含商品包裝的每件重量。規格尚未設定預設重量時，確認入庫後會將本次重量存為預設值。</p>
                </div>
                <button type="button" className="admin-secondary-btn" onClick={() => setPickerOpen(true)}>＋ 選擇商品</button>
              </div>
              {receipt.items.length === 0 ? (
                <div className="procurement-empty-selection">
                  <strong>尚未選擇商品</strong>
                  <span>點擊「選擇商品」一次勾選多個品項</span>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="responsive-admin-table procurement-items-table">
                    <thead><tr><th>產品</th><th>入庫數量</th><th>USD 單價</th><th>每件重量（g）</th><th>操作</th></tr></thead>
                    <tbody>{receipt.items.map(item => {
                      const source = sourceItems?.find(line => line.variant_id === item.variant_id);
                      return (
                      <tr key={item.variant_id}>
                        <td data-label="產品">
                          <strong>{item.sku} · {item.product_name} · {item.variant_name}</strong>
                          {source && <small>叫貨 {source.ordered_quantity} · 已入庫 {source.received_quantity} · 剩餘 {source.quantity}</small>}
                        </td>
                        {[
                          ['quantity', '入庫數量', '1', '1'],
                          ['unit_cost_usd', 'USD 單價', '0', '0.0001'],
                          ['unit_weight_g', '每件重量（g）', '0.001', '0.001'],
                        ].map(([key, label, min, step]) => (
                          <td key={key} data-label={label}>
                            <input className={key === 'quantity' ? 'procurement-number-input' : 'procurement-price-input'}
                              type="number" required min={min} max={key === 'quantity' ? source?.quantity : undefined} step={step} value={item[key] ?? ''}
                              aria-label={`${item.sku} ${label}`} onChange={event => updateItem(item.variant_id, key, event.target.value)} />
                          </td>
                        ))}
                        <td data-label="操作">
                          <button type="button" className="procurement-remove" aria-label={`${source ? '本次未到' : '移除'} ${item.sku}`}
                            onClick={() => setReceipt(current => ({ ...current, items: current.items.filter(line => line.variant_id !== item.variant_id) }))}>{source ? '本次未到' : '移除'}</button>
                        </td>
                      </tr>
                    ); })}</tbody>
                  </table>
                </div>
              )}
            </section>
          </fieldset>
        </form>
      )}
      {(mode === 'preview' || mode === 'posted') && <ReceiptCosts receipt={receipt} />}
      {mode === 'edit' && pickerOpen && <ReceiptProductPicker items={receipt.items} sourceItems={availableSourceItems} onClose={() => setPickerOpen(false)}
        onApply={items => { setReceipt(current => ({ ...current, items })); setPickerOpen(false); }} />}
    </div>
  );
}
