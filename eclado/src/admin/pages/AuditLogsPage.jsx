import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase.js';

const ENTITY_LABELS = {
  orders: '訂單',
  products: '商品',
  product_variants: '商品規格',
  product_images: '商品圖片',
  profiles: '會員',
  professional_applications: '專業申請',
  promotions: '活動',
  admin_users: '管理員',
};

const OPERATION_LABELS = { INSERT: '新增', UPDATE: '修改', DELETE: '刪除' };

const ACTION_LABELS = {
  'orders.payment_created': '付款單建立',
  'orders.payment_paid': '付款完成',
  'orders.expired_cancelled': '逾期自動取消',
  'orders.cancelled': '訂單取消',
  'orders.payment_reminder_sent': '第一次付款提醒',
  'orders.payment_second_reminder_sent': '第二次付款提醒',
  'orders.shipment_notification_sent': '出貨通知完成',
};

const ACTOR_TYPE_LABELS = { admin: '管理員', system: '系統排程', api: '付款 API' };

const FIELD_LABELS = {
  status: '狀態', tracking: '托運單號', shipping_carrier: '物流商', shipped_at: '出貨時間',
  shipment_notification_sent_at: '通知時間', shipment_notification_channel: '通知管道',
  payment_due_at: '付款期限', payment_reminded_at: '第一次提醒時間', payment_second_reminded_at: '第二次提醒時間',
  claimed_at: '付款建單鎖定時間', gateway_created_at: '付款單建立時間',
  name: '英文名稱', name_zh: '商品名稱', subtitle: '副標題', category: '分類', min_stock: '庫存警示值',
  is_pro_only: '院線限定', publication_status: '上架狀態', active: '啟用狀態', product_list_image_scale: '列表圖片比例',
  product_id: '商品 ID', sku: 'SKU', size: '規格', price: '市場價', pro_price: '專業價', stock: '庫存',
  is_default: '預設規格', sort_order: '排序', is_primary: '首圖', original_name: '檔名', alt_text: '替代文字',
  storage_path: 'Storage 路徑', role: '會員層級', source: '申請來源', product_ids: '適用商品',
  discount_rate: '折扣倍率', discount_amount: '折扣金額', discount_order: '折扣順序', start_at: '開始時間', end_at: '結束時間',
};

function operationOf(log) {
  if (ACTION_LABELS[log.action]) return 'UPDATE';
  return String(log.action || '').split('.').pop()?.toUpperCase() || '';
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.join('、') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatTime(value);
  return String(value);
}

function changedFields(log) {
  const before = log.before_data || {};
  const after = log.after_data || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function actionLabel(log) {
  return ACTION_LABELS[log.action]
    || `${ENTITY_LABELS[log.entity_type] || log.entity_type}${OPERATION_LABELS[operationOf(log)] || operationOf(log)}`;
}

function actorLabel(log) {
  return log.actor_email
    || log.actor_user_id
    || ACTOR_TYPE_LABELS[log.actor_type]
    || '未知';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (loadError) {
      setLogs([]);
      setError(`無法載入操作紀錄：${loadError.message || '請先執行 supabase-admin-audit-logs.sql'}`);
    } else {
      setLogs(data || []);
      setError('');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-audit-logs-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const actors = useMemo(() => [...new Set(logs.map(actorLabel).filter(Boolean))].sort(), [logs]);
  const [actorFilter, setActorFilter] = useState('all');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.filter(log => {
      if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;
      if (operationFilter !== 'all' && operationOf(log) !== operationFilter) return false;
      if (actorFilter !== 'all' && actorLabel(log) !== actorFilter) return false;
      if (!needle) return true;
      return [log.entity_id, actorLabel(log), actionLabel(log), log.metadata?.source]
        .some(value => String(value || '').toLowerCase().includes(needle));
    });
  }, [logs, entityFilter, operationFilter, actorFilter, search]);

  const filterStyle = { border: '1px solid var(--border)', background: 'var(--white)', padding: '9px 11px', fontSize: 12, color: 'var(--dark)', minWidth: 150 };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400, marginBottom: 4 }}>操作紀錄</h1>
        <p style={{ fontSize: 13, color: 'var(--mid)' }}>最近 500 筆管理員成功操作；紀錄不可修改或刪除。</p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <input aria-label="搜尋操作紀錄" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋資料 ID、管理員或操作" style={{ ...filterStyle, flex: '1 1 240px' }} />
        <select aria-label="資料類型" value={entityFilter} onChange={event => setEntityFilter(event.target.value)} style={filterStyle}>
          <option value="all">全部資料類型</option>
          {Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="操作類型" value={operationFilter} onChange={event => setOperationFilter(event.target.value)} style={filterStyle}>
          <option value="all">全部操作</option>
          <option value="INSERT">新增</option><option value="UPDATE">修改</option><option value="DELETE">刪除</option>
        </select>
        <select aria-label="執行者" value={actorFilter} onChange={event => setActorFilter(event.target.value)} style={filterStyle}>
          <option value="all">全部管理員</option>
          {actors.map(actor => <option key={actor} value={actor}>{actor}</option>)}
        </select>
      </div>

      {error && <div style={{ padding: '14px 16px', border: '1px solid oklch(0.60 0.18 25 / 0.3)', background: 'oklch(0.60 0.18 25 / 0.08)', color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>{error}</div>}

      <div className="table-scroll" style={{ background: 'var(--white)', border: '1px solid var(--border)' }}>
        <table className="responsive-admin-table admin-audit-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['時間', '執行者', '操作', '資料 ID', '異動欄位'].map(label => <th key={label} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 500 }}>{label}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>載入中…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>目前沒有符合條件的操作紀錄</td></tr>
                : filtered.map(log => {
                  const fields = changedFields(log);
                  return (
                    <tr key={log.id} onClick={() => setSelected(log)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td data-label="時間" style={{ padding: '13px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>{formatTime(log.created_at)}</td>
                      <td data-label="執行者" style={{ padding: '13px 14px', fontSize: 12 }}>{actorLabel(log)}</td>
                      <td data-label="操作" style={{ padding: '13px 14px', fontSize: 12, fontWeight: 500 }}>{actionLabel(log)}</td>
                      <td data-label="資料 ID" style={{ padding: '13px 14px', fontSize: 12, overflowWrap: 'anywhere' }}>{log.entity_id}</td>
                      <td data-label="異動欄位" style={{ padding: '13px 14px', fontSize: 11, color: 'var(--mid)' }}>{fields.length ? fields.map(field => FIELD_LABELS[field] || field).join('、') : '—'}</td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <button type="button" className="detail-panel-backdrop" aria-label="關閉操作紀錄" onClick={() => setSelected(null)} />
          <div className="detail-panel detail-panel-wide" role="dialog" aria-modal="true" aria-label="操作紀錄詳情" style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}><div><p style={{ fontSize: 11, color: 'var(--gold)', letterSpacing: '0.12em', marginBottom: 6 }}>{actionLabel(selected)}</p><h2 style={{ fontSize: 20, fontWeight: 500, overflowWrap: 'anywhere' }}>{selected.entity_id}</h2></div><button onClick={() => setSelected(null)} aria-label="關閉操作紀錄詳情" style={{ border: 0, background: 'none', fontSize: 24, color: 'var(--mid)' }}>×</button></div>
            <div style={{ padding: 14, background: 'var(--off)', border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.9, marginBottom: 20 }}><div>時間：{formatTime(selected.created_at)}</div><div>執行者：{actorLabel(selected)}</div><div>來源：{selected.metadata?.source || '—'}</div><div>Request ID：{selected.request_id || '—'}</div></div>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>修改前後</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {changedFields(selected).map(field => <div key={field} style={{ border: '1px solid var(--border)', padding: '12px 14px' }}><div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 8 }}>{FIELD_LABELS[field] || field}</div><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center', fontSize: 12 }}><div style={{ overflowWrap: 'anywhere' }}>{formatValue(selected.before_data?.[field])}</div><span style={{ color: 'var(--gold)' }}>→</span><div style={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{formatValue(selected.after_data?.[field])}</div></div></div>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
