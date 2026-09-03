import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import { Badge } from '../components/StatusIndicators.jsx';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function BackordersPage({ onInventoryChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allocatingId, setAllocatingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_backorder_management_data');
    if (loadError) {
      setError('無法載入待補商品：' + (loadError.message || '請確認庫存配置 migration 已套用'));
      setItems([]);
    } else {
      setError('');
      setItems(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function allocate(item) {
    const stock = number(item.available_stock);
    if (stock <= 0) return;
    const confirmed = window.confirm(
      `確定將「${item.sku} · ${item.product_name} · ${item.variant_name}」目前可用的 ${stock} 件庫存，依付款時間 FIFO 分配給待補訂單嗎？`,
    );
    if (!confirmed) return;

    setAllocatingId(String(item.variant_id));
    setNotice('');
    setError('');
    const { data, error: allocationError } = await supabase.rpc('allocate_backordered_inventory', {
      p_variant_id: Number(item.variant_id),
    });
    if (allocationError) {
      setError('FIFO 分配失敗：' + (allocationError.message || '請稍後再試'));
    } else {
      const allocated = number(data?.allocated_qty);
      const affected = Array.isArray(data?.affected_orders) ? data.affected_orders.length : 0;
      setNotice(allocated > 0
        ? `已依 FIFO 分配 ${allocated} 件，共更新 ${affected} 張訂單。`
        : '目前沒有可分配的庫存，訂單待補數量未變更。');
      await load();
      await onInventoryChanged?.();
    }
    setAllocatingId(null);
  }

  const totalMissing = items.reduce((sum, item) => sum + number(item.total_backorder_qty), 0);
  const affectedOrders = new Set(items.flatMap(item => (item.orders || []).map(order => order.order_id))).size;

  return (
    <div className="backorders-page">
      <div className="backorders-header">
        <div>
          <h1>待補商品</h1>
          <p>以付款完成時間排序，將規格庫存依 FIFO 配置給尚未補齊的訂單。</p>
        </div>
        <button className="admin-secondary-btn" type="button" onClick={load} disabled={loading}>重新整理</button>
      </div>

      {error && <div className="procurement-error">{error}</div>}
      {notice && <div className="backorders-notice">{notice}</div>}

      <div className="backorders-stats">
        <div><span>待補規格</span><strong>{items.length}</strong></div>
        <div><span>待補總件數</span><strong>{totalMissing}</strong></div>
        <div><span>受影響訂單</span><strong>{affectedOrders}</strong></div>
      </div>

      {loading ? (
        <div className="backorders-empty">待補庫存載入中...</div>
      ) : items.length === 0 ? (
        <div className="backorders-empty"><strong>目前沒有待補商品</strong><span>已付款訂單的庫存皆已配置完成。</span></div>
      ) : (
        <div className="backorders-list">
          {items.map(item => {
            const stock = number(item.available_stock);
            const missing = number(item.total_backorder_qty);
            const running = allocatingId === String(item.variant_id);
            return (
              <section className="backorder-card" key={item.variant_id}>
                <div className="backorder-card-summary">
                  <div className="backorder-product">
                    <strong>{item.sku} · {item.product_name} · {item.variant_name}</strong>
                    <span>{item.order_count} 張訂單等待此規格</span>
                  </div>
                  <div className="backorder-quantity"><span>目前庫存</span><strong>{stock}</strong></div>
                  <div className="backorder-quantity missing"><span>待補總數</span><strong>{missing}</strong></div>
                  <button
                    type="button"
                    className="admin-primary-btn"
                    disabled={stock <= 0 || running}
                    onClick={() => allocate(item)}
                  >
                    {running ? '分配中...' : stock > 0 ? '依 FIFO 分配' : '目前無庫存'}
                  </button>
                </div>
                <div className="table-scroll backorder-orders-wrap">
                  <table className="responsive-admin-table backorder-orders-table">
                    <thead><tr>{['順位', '訂單編號', '訂購人', '狀態', '付款／配置時間', '訂購', '已配置', '缺少'].map(label => <th key={label}>{label}</th>)}</tr></thead>
                    <tbody>
                      {(item.orders || []).map((order, index) => (
                        <tr key={order.allocation_id || `${order.order_id}-${index}`}>
                          <td data-label="順位">{index + 1}</td>
                          <td data-label="訂單編號"><strong>{order.order_id}</strong></td>
                          <td data-label="訂購人">{order.member || '訪客'}</td>
                          <td data-label="狀態"><Badge status={order.order_status} /></td>
                          <td data-label="付款／配置時間">{formatTime(order.priority_at)}</td>
                          <td data-label="訂購">{number(order.requested_qty)}</td>
                          <td data-label="已配置">{number(order.allocated_qty)}</td>
                          <td data-label="缺少"><strong className="backorder-missing-number">{number(order.backorder_qty)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="backorders-footnote">
        叫貨單標記「已到貨」仍只更新叫貨狀態與到貨時間，不會自動增加規格庫存；請先於「商品 &amp; 庫存」確認實際入庫數量，再回到此頁分配。
      </div>
    </div>
  );
}
