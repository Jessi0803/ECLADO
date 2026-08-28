import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import PurchaseOrderDocument from '../components/PurchaseOrderDocument.jsx';
import {
  exportPurchaseOrderExcel,
  exportPurchaseOrderPdf,
  exportPurchaseOrderPng,
  formatTwd,
  formatUsd,
} from '../utils/purchaseOrderExport.js';

const STATUS_LABELS = {
  draft: '草稿', pending: '待下單', ordered: '已下單',
  shipping: '運送中', received: '已到貨', cancelled: '已取消',
};
const ACTIVE_STATUS_OPTIONS = Object.entries(STATUS_LABELS).filter(([status]) => status !== 'cancelled');
const DELETABLE_STATUSES = new Set(['draft', 'pending']);
const FINAL_STATUS_SET = new Set(['ordered', 'shipping', 'received']);

const EMPTY_ADDRESS = {
  id: '', address_text: '', is_default: false,
};

function normalizedAddress(address = {}) {
  return {
    ...(address.id ? { id: address.id } : {}),
    address_text: String(address.address_text || '').trim(),
    is_default: address.is_default === true,
  };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createDraft(suppliers, addresses) {
  const defaultAddress = addresses.find(address => address.is_default) || addresses[0];
  return {
    id: '',
    po_number: '',
    supplier_id: suppliers[0]?.id || '',
    supplier_code: suppliers[0]?.code || 'ECLADO',
    supplier_name: suppliers[0]?.name || 'ECLADO Korea',
    status: 'draft',
    exchange_rate: 32,
    total_usd: 0,
    total_twd: 0,
    address_id: defaultAddress?.id || '',
    shipping_address: defaultAddress ? { ...defaultAddress } : { ...EMPTY_ADDRESS },
    notes: '',
    items: [],
    created_at: new Date().toISOString(),
  };
}

function calculateOrder(order) {
  const items = (order.items || []).map(item => ({
    ...item,
    quantity: Math.max(1, Math.round(number(item.quantity, 1))),
    unit_cost: Math.max(0, number(item.unit_cost)),
    subtotal_usd: Math.round(Math.max(1, Math.round(number(item.quantity, 1))) * Math.max(0, number(item.unit_cost)) * 100) / 100,
  }));
  const totalUsd = Math.round(items.reduce((sum, item) => sum + item.subtotal_usd, 0) * 100) / 100;
  const rate = Math.max(0, number(order.exchange_rate));
  return { ...order, items, total_usd: totalUsd, total_twd: Math.round(totalUsd * rate * 100) / 100 };
}

function orderFromStored(stored) {
  return calculateOrder({
    ...stored,
    address_id: '',
    shipping_address: stored.shipping_address || { ...EMPTY_ADDRESS },
    items: stored.items || [],
  });
}

export default function ProcurementPage() {
  const [data, setData] = useState({ suppliers: [], supplier_items: [], addresses: [], orders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFilter, setPickerFilter] = useState('all');
  const [pickerSelected, setPickerSelected] = useState(new Set());
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressSearch, setAddressSearch] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState('');
  const documentRef = useRef(null);

  async function loadData() {
    setLoading(true);
    const { data: payload, error: loadError } = await supabase.rpc('get_procurement_management_data');
    if (loadError) {
      setError('無法載入叫貨資料：' + (loadError.message || '請確認資料庫 migration'));
      setLoading(false);
      return;
    }
    const normalized = {
      suppliers: payload?.suppliers || [],
      supplier_items: payload?.supplier_items || [],
      addresses: payload?.addresses || [],
      orders: payload?.orders || [],
    };
    setData(normalized);
    setError('');
    setLoading(false);
    return normalized;
  }

  useEffect(() => { loadData(); }, []);

  const filteredPickerItems = useMemo(() => {
    const keyword = pickerSearch.trim().toLowerCase();
    return data.supplier_items.filter(item => {
      if (String(item.supplier_id) !== String(draft?.supplier_id)) return false;
      if (pickerFilter === 'low' && !(item.has_inventory_link && number(item.available_stock) <= 5)) return false;
      if (pickerFilter === 'zero' && !(item.has_inventory_link && number(item.available_stock) === 0)) return false;
      if (pickerFilter === 'selected' && !pickerSelected.has(String(item.id))) return false;
      if (!keyword) return true;
      return [item.supplier_sku, item.name_zh, item.name_en, item.specification]
        .some(value => String(value || '').toLowerCase().includes(keyword));
    });
  }, [data.supplier_items, draft?.supplier_id, pickerFilter, pickerSearch, pickerSelected]);

  const displayedOrder = calculateOrder(mode === 'detail' ? selectedOrder : (draft || createDraft([], [])));

  function startNew() {
    setDraft(createDraft(data.suppliers, data.addresses));
    setSelectedOrder(null);
    setMode('edit');
  }

  function editOrder(order) {
    setDraft(orderFromStored(order));
    setSelectedOrder(null);
    setMode('edit');
  }

  function duplicateOrder(order) {
    const copy = orderFromStored(order);
    setDraft({ ...copy, id: '', po_number: '', status: 'draft', created_at: new Date().toISOString() });
    setSelectedOrder(null);
    setMode('edit');
  }

  function openPicker() {
    setPickerSelected(new Set((draft.items || []).map(item => String(item.supplier_item_id))));
    setPickerSearch('');
    setPickerFilter('all');
    setPickerOpen(true);
  }

  function applyPicker() {
    const existing = new Map((draft.items || []).map(item => [String(item.supplier_item_id), item]));
    const items = data.supplier_items
      .filter(item => pickerSelected.has(String(item.id)))
      .map(item => existing.get(String(item.id)) || {
        supplier_item_id: item.id,
        supplier_price_id: item.price_id,
        supplier_sku: item.supplier_sku,
        name_zh: item.name_zh,
        name_en: item.name_en,
        specification: item.specification,
        quantity: 1,
        unit_cost: number(item.unit_cost),
        subtotal_usd: number(item.unit_cost),
        stock_at_order: item.has_inventory_link ? number(item.available_stock) : null,
      });
    setDraft(current => calculateOrder({ ...current, items }));
    setPickerOpen(false);
  }

  function updateItem(itemId, patch) {
    setDraft(current => calculateOrder({
      ...current,
      items: current.items.map(item => String(item.supplier_item_id) === String(itemId) ? { ...item, ...patch } : item),
    }));
  }

  function selectAddress(address) {
    setDraft(current => ({ ...current, address_id: address.id, shipping_address: { ...address } }));
    setAddressOpen(false);
  }

  function updateAddressField(field, value) {
    setDraft(current => ({
      ...current,
      address_id: '',
      shipping_address: { ...current.shipping_address, id: '', [field]: value },
    }));
  }

  async function saveAddress() {
    const address = normalizedAddress(draft.shipping_address);
    if (!address.address_text) {
      setError('記錄地址前請填寫收件地址。');
      return;
    }
    const { data: saved, error: addressError } = await supabase.rpc('save_procurement_address', { p_address: address });
    if (addressError) {
      setError('地址儲存失敗：' + (addressError.message || '請稍後再試'));
      return;
    }
    const next = await loadData();
    const currentAddress = next?.addresses.find(item => String(item.id) === String(saved?.id)) || saved;
    setDraft(current => ({ ...current, address_id: currentAddress?.id || '', shipping_address: { ...currentAddress } }));
  }

  async function archiveAddress(addressId) {
    const { error: archiveError } = await supabase.rpc('archive_procurement_address', { p_address_id: Number(addressId) });
    if (archiveError) return setError('地址刪除失敗：' + archiveError.message);
    await loadData();
  }

  async function saveOrder(status) {
    const calculated = calculateOrder({ ...draft, status });
    if (!calculated.items.length) return setError('請至少選擇一個叫貨商品。');
    if (status !== 'draft' && !calculated.shipping_address?.address_text?.trim()) {
      return setError('請填寫收件地址。');
    }
    if (number(calculated.exchange_rate) <= 0) return setError('請填寫正確的美金兌台幣匯率。');
    setSaving(true);
    setError('');
    const { data: saved, error: saveError } = await supabase.rpc('save_purchase_order', {
      p_order: {
        ...(calculated.id ? { id: calculated.id } : {}),
        supplier_id: calculated.supplier_id,
        status,
        exchange_rate: calculated.exchange_rate,
        address_id: calculated.address_id || null,
        shipping_address: { address_text: String(calculated.shipping_address.address_text || '').trim() },
        notes: calculated.notes || null,
      },
      p_items: calculated.items.map(item => ({
        supplier_item_id: item.supplier_item_id,
        supplier_price_id: item.supplier_price_id || null,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        stock_at_order: item.stock_at_order,
      })),
    });
    setSaving(false);
    if (saveError) return setError('叫貨單儲存失敗：' + (saveError.message || '請稍後再試'));
    const next = await loadData();
    const stored = next?.orders.find(order => String(order.id) === String(saved?.id));
    if (stored) {
      setSelectedOrder(orderFromStored(stored));
      setMode('detail');
    } else {
      setMode('list');
    }
  }

  async function updateStatus(orderId, status) {
    const { error: statusError } = await supabase.rpc('update_purchase_order_status', {
      p_order_id: Number(orderId), p_status: status,
    });
    if (statusError) return setError('狀態更新失敗：' + statusError.message);
    const next = await loadData();
    if (mode === 'detail') {
      const stored = next?.orders.find(order => String(order.id) === String(orderId));
      if (stored) setSelectedOrder(orderFromStored(stored));
    }
  }

  async function deleteOrder(order) {
    if (!DELETABLE_STATUSES.has(order.status)) {
      setError('只有草稿與待下單可以永久刪除。');
      return;
    }
    const confirmed = window.confirm(`確定要永久刪除叫貨單「${order.po_number}」嗎？\n\n刪除後無法復原，其品項明細也會一併刪除。`);
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    const { error: deleteError } = await supabase.rpc('delete_purchase_order', {
      p_order_id: Number(order.id),
    });
    setDeleting(false);
    if (deleteError) return setError('叫貨單刪除失敗：' + (deleteError.message || '請稍後再試'));
    await loadData();
    setSelectedOrder(null);
    setDraft(null);
    setMode('list');
  }

  async function runExport(type) {
    setExporting(type);
    setError('');
    try {
      if (type === 'excel') await exportPurchaseOrderExcel(displayedOrder);
      if (type === 'png') await exportPurchaseOrderPng(displayedOrder, documentRef.current);
      if (type === 'pdf') await exportPurchaseOrderPdf(displayedOrder, documentRef.current);
    } catch (exportError) {
      setError('匯出失敗：' + (exportError.message || '請稍後再試'));
    } finally {
      setExporting('');
    }
  }

  if (loading) return <div className="procurement-loading">叫貨資料載入中...</div>;

  return (
    <div className="procurement-page">
      {error && <div className="procurement-error">⚠ {error}</div>}

      {mode === 'list' && <>
        <div className="procurement-header">
          <div><h1>叫貨管理</h1><p>建立與保存向供應商提出的叫貨單</p></div>
          <button className="admin-primary-btn" onClick={startNew}>＋ 建立叫貨單</button>
        </div>
        <div className="procurement-stats">
          <div><span>叫貨單</span><strong>{data.orders.length}</strong></div>
          <div><span>待處理</span><strong>{data.orders.filter(order => ['draft', 'pending'].includes(order.status)).length}</strong></div>
          <div><span>運送中</span><strong>{data.orders.filter(order => order.status === 'shipping').length}</strong></div>
          <div><span>已到貨</span><strong>{data.orders.filter(order => order.status === 'received').length}</strong></div>
        </div>
        <div className="table-scroll procurement-list-wrap">
          <table className="responsive-admin-table procurement-list-table">
            <thead><tr><th>PO 編號</th><th>建立日期</th><th>品項</th><th>美金總額</th><th>台幣估算</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {!data.orders.length && <tr><td colSpan="7" className="procurement-empty">尚未建立叫貨單</td></tr>}
              {data.orders.map(order => <tr key={order.id}>
                <td data-label="PO 編號"><button className="procurement-link" onClick={() => { setSelectedOrder(orderFromStored(order)); setMode('detail'); }}>{order.po_number}</button><small>{order.supplier_name}</small></td>
                <td data-label="建立日期">{new Date(order.created_at).toLocaleDateString('zh-TW')}</td>
                <td data-label="品項">{(order.items || []).length} 項</td>
                <td data-label="美金總額">{formatUsd(order.total_usd)}</td>
                <td data-label="台幣估算">{formatTwd(order.total_twd)}</td>
                <td data-label="狀態"><span className={`procurement-status status-${order.status}`}>{STATUS_LABELS[order.status]}</span></td>
                <td data-label="操作"><div className="procurement-row-actions"><button onClick={() => { setSelectedOrder(orderFromStored(order)); setMode('detail'); }}>查看</button>{DELETABLE_STATUSES.has(order.status) && <button onClick={() => editOrder(order)}>編輯</button>}<button onClick={() => duplicateOrder(order)}>複製</button>{DELETABLE_STATUSES.has(order.status) && <button className="procurement-delete" onClick={() => deleteOrder(order)} disabled={deleting}>永久刪除</button>}</div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}

      {mode === 'edit' && draft && <>
        <div className="procurement-header">
          <div><button className="procurement-back" onClick={() => setMode('list')}>← 返回叫貨單</button><h1>{draft.id ? `編輯 ${draft.po_number}` : '建立叫貨單'}</h1><p>選擇商品、設定數量與匯率後建立叫貨單</p></div>
          <div className="procurement-header-actions">
            <button className="admin-secondary-btn" onClick={() => setPreviewOpen(true)} disabled={!draft.items.length}>預覽文件</button>
            {draft.id ? (
              <button className="admin-primary-btn" onClick={() => saveOrder(draft.status)} disabled={saving}>{saving ? '儲存中...' : '儲存變更'}</button>
            ) : <>
              <button className="admin-secondary-btn" onClick={() => saveOrder('draft')} disabled={saving}>儲存草稿</button>
              <button className="admin-primary-btn" onClick={() => saveOrder('pending')} disabled={saving}>{saving ? '儲存中...' : '確認建立'}</button>
            </>}
          </div>
        </div>

        <div className="procurement-form-card">
          <div className="procurement-form-grid">
            <label>供應商<select value={draft.supplier_id} onChange={event => {
              const supplier = data.suppliers.find(item => String(item.id) === event.target.value);
              setDraft(current => ({ ...current, supplier_id: event.target.value, supplier_code: supplier?.code || '', supplier_name: supplier?.name || '', items: [] }));
            }}>{data.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>PO 編號<input value={draft.po_number || '儲存後由系統產生'} disabled /></label>
            <label>美金兌台幣匯率<input type="number" min="0.0001" step="0.0001" value={draft.exchange_rate} onChange={event => setDraft(current => calculateOrder({ ...current, exchange_rate: event.target.value }))} /></label>
            <label>狀態<input value={STATUS_LABELS[draft.status] || '草稿'} disabled /></label>
          </div>
        </div>

        <div className="procurement-section-card">
          <div className="procurement-section-heading"><div><h2>叫貨商品</h2><p>選擇商品時會同時顯示目前庫存與進貨價</p></div><button className="admin-secondary-btn" onClick={openPicker}>＋ 選擇商品</button></div>
          {!draft.items.length ? <div className="procurement-empty-selection"><strong>尚未選擇商品</strong><span>點擊「選擇商品」一次勾選多個品項</span></div> : <div className="table-scroll"><table className="responsive-admin-table procurement-items-table">
            <thead><tr><th>產品</th><th>建立時庫存</th><th>數量</th><th>USD 單價</th><th>小計</th><th></th></tr></thead>
            <tbody>{displayedOrder.items.map(item => <tr key={item.supplier_item_id}>
              <td data-label="產品"><strong>{item.supplier_sku} · {item.name_zh}</strong><small>{item.name_en} · {item.specification}</small></td>
              <td data-label="建立時庫存">{item.stock_at_order == null ? <span className="inventory-unlinked">尚未連結</span> : `${item.stock_at_order} 件`}</td>
              <td data-label="數量"><input aria-label={`${item.name_zh} 數量`} className="procurement-number-input" type="number" min="1" step="1" value={item.quantity} onChange={event => updateItem(item.supplier_item_id, { quantity: event.target.value })} /></td>
              <td data-label="USD 單價"><input aria-label={`${item.name_zh} 單價`} className="procurement-price-input" type="number" min="0" step="0.01" value={item.unit_cost} onChange={event => updateItem(item.supplier_item_id, { unit_cost: event.target.value })} /></td>
              <td data-label="小計"><strong>{formatUsd(item.subtotal_usd)}</strong></td>
              <td data-label="操作"><button className="procurement-remove" aria-label={`移除 ${item.name_zh}`} onClick={() => setDraft(current => calculateOrder({ ...current, items: current.items.filter(row => String(row.supplier_item_id) !== String(item.supplier_item_id)) }))}>移除</button></td>
            </tr>)}</tbody>
          </table></div>}
        </div>

        <div className="procurement-bottom-grid">
          <div className="procurement-section-card">
            <div className="procurement-section-heading"><div><h2>收件地址</h2><p>可記錄並快速帶入過往地址</p></div><button className="admin-secondary-btn" onClick={() => setAddressOpen(true)}>選擇常用地址</button></div>
            <label className="procurement-address-field">收件地址<textarea rows="7" placeholder="可直接貼上收件人、郵遞區號、完整地址與電話" value={draft.shipping_address.address_text || ''} onChange={event => updateAddressField('address_text', event.target.value)} /></label>
            <button className="procurement-save-address" onClick={saveAddress}>⌑ 記錄此地址</button>
            <label className="procurement-notes">備註<textarea rows="3" placeholder="輸入叫貨備註" value={draft.notes || ''} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} /></label>
          </div>
          <div className="procurement-total-card">
            <h2>金額摘要</h2>
            <div><span>商品項數</span><strong>{displayedOrder.items.length} 項</strong></div>
            <div><span>總件數</span><strong>{displayedOrder.items.reduce((sum, item) => sum + number(item.quantity), 0)} 件</strong></div>
            <div><span>美金總額</span><strong>{formatUsd(displayedOrder.total_usd)}</strong></div>
            <div><span>匯率</span><strong>1 : {number(displayedOrder.exchange_rate).toFixed(4)}</strong></div>
            <div className="twd-total"><span>台幣估算</span><strong>{formatTwd(displayedOrder.total_twd)}</strong></div>
            <small>台幣金額為依目前輸入匯率計算的估算值。</small>
          </div>
        </div>
      </>}

      {mode === 'detail' && selectedOrder && <>
        <div className="procurement-header">
          <div><button className="procurement-back" onClick={() => setMode('list')}>← 返回叫貨單</button><h1>{selectedOrder.po_number}</h1><p>{selectedOrder.supplier_name} · {new Date(selectedOrder.created_at).toLocaleString('zh-TW')}</p></div>
          <div className="procurement-header-actions">{DELETABLE_STATUSES.has(selectedOrder.status) && <button className="admin-secondary-btn" onClick={() => editOrder(selectedOrder)}>編輯</button>}<button className="admin-secondary-btn" onClick={() => duplicateOrder(selectedOrder)}>複製新單</button>{DELETABLE_STATUSES.has(selectedOrder.status) && <button className="admin-secondary-btn procurement-delete" onClick={() => deleteOrder(selectedOrder)} disabled={deleting}>{deleting ? '刪除中...' : '永久刪除'}</button>}<button className="admin-primary-btn" onClick={() => setPreviewOpen(true)}>預覽與匯出</button></div>
        </div>
        <div className="procurement-detail-status"><span className={`procurement-status status-${selectedOrder.status}`}>{STATUS_LABELS[selectedOrder.status]}</span>{selectedOrder.status !== 'cancelled' && <select aria-label="叫貨單狀態" value={selectedOrder.status} onChange={event => updateStatus(selectedOrder.id, event.target.value)}>{ACTIVE_STATUS_OPTIONS.filter(([status]) => !FINAL_STATUS_SET.has(selectedOrder.status) || FINAL_STATUS_SET.has(status)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div>
        <div className="procurement-detail-financials">
          <div><span>美金總額</span><strong>{formatUsd(displayedOrder.total_usd)}</strong></div>
          <div><span>匯率</span><strong>1 : {number(displayedOrder.exchange_rate).toFixed(4)}</strong></div>
          <div><span>台幣估算</span><strong>{formatTwd(displayedOrder.total_twd)}</strong></div>
        </div>
        <div className="procurement-document-shell"><PurchaseOrderDocument order={displayedOrder} /></div>
      </>}

      {pickerOpen && <div className="procurement-modal-backdrop"><div className="procurement-modal product-picker-modal" role="dialog" aria-label="選擇叫貨商品">
        <div className="procurement-modal-header"><div><h2>選擇叫貨商品</h2><p>目前已選 {pickerSelected.size} 項 · 產品總數 {data.supplier_items.filter(item => String(item.supplier_id) === String(draft.supplier_id)).length} 項</p></div><button onClick={() => setPickerOpen(false)}>×</button></div>
        <div className="product-picker-controls"><input autoFocus placeholder="搜尋 SKU、中文名稱或英文名稱" value={pickerSearch} onChange={event => setPickerSearch(event.target.value)} /><div>{[['all','全部'],['low','低庫存'],['zero','零庫存'],['selected','已選']].map(([value,label]) => <button key={value} className={pickerFilter === value ? 'active' : ''} onClick={() => setPickerFilter(value)}>{label}</button>)}</div></div>
        <div className="product-picker-list">{filteredPickerItems.map(item => {
          const checked = pickerSelected.has(String(item.id));
          return <label key={item.id} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => setPickerSelected(current => { const next = new Set(current); checked ? next.delete(String(item.id)) : next.add(String(item.id)); return next; })} /><div><strong>{item.supplier_sku} · {item.name_zh} {item.specification}</strong><span>{item.name_en || '尚未設定英文名稱'}</span><small>進貨成本 {item.unit_cost == null ? '尚未設定' : formatUsd(item.unit_cost)}</small></div>{item.has_inventory_link ? <span className={number(item.available_stock) === 0 ? 'stock-zero' : number(item.available_stock) <= 5 ? 'stock-low' : 'stock-ok'}>庫存 {item.available_stock}</span> : <span className="inventory-unlinked">尚未連結庫存</span>}</label>;
        })}</div>
        <div className="procurement-modal-footer"><button className="admin-secondary-btn" onClick={() => setPickerSelected(new Set())}>清除選取</button><div><button className="admin-secondary-btn" onClick={() => setPickerOpen(false)}>取消</button><button className="admin-primary-btn" onClick={applyPicker}>加入 {pickerSelected.size} 項商品</button></div></div>
      </div></div>}

      {addressOpen && <div className="procurement-modal-backdrop"><div className="procurement-modal address-picker-modal" role="dialog" aria-label="選擇常用地址">
        <div className="procurement-modal-header"><div><h2>選擇常用地址</h2><p>快速帶入曾經記錄的收件資訊</p></div><button onClick={() => setAddressOpen(false)}>×</button></div>
        <div className="address-search"><input autoFocus placeholder="搜尋收件地址" value={addressSearch} onChange={event => setAddressSearch(event.target.value)} /></div>
        <div className="address-picker-list">{data.addresses.filter(address => String(address.address_text || '').toLowerCase().includes(addressSearch.toLowerCase())).map(address => <div key={address.id}><button className="address-select" onClick={() => selectAddress(address)}><strong>{String(address.address_text || '').split(/\r?\n/)[0] || '常用收件地址'}{address.is_default && <em>預設</em>}</strong><span>{address.address_text}</span></button><button className="address-delete" aria-label="刪除常用地址" onClick={() => archiveAddress(address.id)}>刪除</button></div>)}{!data.addresses.length && <p className="procurement-empty">尚未記錄常用地址</p>}</div>
      </div></div>}

      {previewOpen && <div className="procurement-modal-backdrop preview-backdrop"><div className="procurement-modal preview-modal" role="dialog" aria-label="叫貨單預覽">
        <div className="procurement-modal-header"><div><h2>叫貨單預覽</h2><p>Excel、PNG 與 PDF 將使用相同內容</p></div><button onClick={() => setPreviewOpen(false)}>×</button></div>
        <div className="preview-scroll"><PurchaseOrderDocument order={displayedOrder} documentRef={documentRef} /></div>
        <div className="procurement-modal-footer"><button className="admin-secondary-btn" onClick={() => setPreviewOpen(false)}>關閉</button><div><button className="admin-secondary-btn" disabled={!!exporting} onClick={() => runExport('excel')}>{exporting === 'excel' ? '產生中...' : '匯出 Excel'}</button><button className="admin-secondary-btn" disabled={!!exporting} onClick={() => runExport('png')}>{exporting === 'png' ? '產生中...' : '匯出 PNG'}</button><button className="admin-primary-btn" disabled={!!exporting} onClick={() => runExport('pdf')}>{exporting === 'pdf' ? '產生中...' : '匯出 PDF'}</button></div></div>
      </div></div>}
    </div>
  );
}
