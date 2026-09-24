import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabase.js';

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function defaultCountName() {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()} 盤點`;
}

function inventoryLabel(type) {
  return type === 'gift' ? '贈品庫存' : '一般庫存';
}

export default function InventoryCountsPage({ adminUserId, isSuperAdmin = false, onInventoryChanged }) {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [inventoryType, setInventoryType] = useState('all');
  const savingRef = useRef(new Set());

  async function loadSessions() {
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_inventory_count_sessions');
    if (loadError) {
      setError(`無法載入庫存盤點：${loadError.message || '請確認盤點 SQL 已部署'}`);
      setSessions([]);
    } else {
      setError('');
      setSessions(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }

  async function loadDetail(id, { quiet = false } = {}) {
    if (!id) return;
    if (!quiet) setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_inventory_count_detail', { p_session_id: id });
    if (loadError) {
      setError(`無法載入盤點內容：${loadError.message || '請稍後再試'}`);
    } else {
      const items = Array.isArray(data?.items) ? data.items : [];
      setError('');
      setDetail({ ...data, items });
      setDrafts(Object.fromEntries(items.map(item => [item.id, item.actual_quantity ?? ''])));
    }
    if (!quiet) setLoading(false);
  }

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  async function createCount() {
    const name = newName.trim();
    if (!name) {
      setError('請輸入盤點名稱。');
      return;
    }
    setCreating(true);
    setError('');
    setNotice('');
    const { data, error: createError } = await supabase.rpc('create_inventory_count', { p_name: name.trim() });
    if (createError) {
      setError(`建立盤點失敗：${createError.message || '請稍後再試'}`);
    } else {
      await loadSessions();
      setCreateOpen(false);
      setSelectedId(data);
      setNotice('盤點單已建立，項目範圍與系統庫存已凍結。');
    }
    setCreating(false);
  }

  async function saveItem(item) {
    if (detail?.session?.status !== 'draft' || savingRef.current.has(item.id)) return;
    const raw = drafts[item.id];
    const actual = raw === '' ? null : integer(raw);
    if (raw !== '' && actual === null) {
      setError('實際數量必須是 0 或正整數。');
      return;
    }
    if (actual === item.actual_quantity || (actual === null && item.actual_quantity === null)) return;

    savingRef.current.add(item.id);
    setError('');
    const { data, error: saveError } = await supabase.rpc('update_inventory_count_item', {
      p_item_id: Number(item.id),
      p_actual_quantity: actual,
      p_expected_version: Number(item.version),
    });
    savingRef.current.delete(item.id);
    if (saveError) {
      const message = saveError.message || '盤點數量儲存失敗';
      await loadDetail(selectedId, { quiet: true });
      setError(message);
      return;
    }
    setDetail(previous => ({
      ...previous,
      items: previous.items.map(existing => String(existing.id) === String(item.id) ? data : existing),
    }));
    setDrafts(previous => ({ ...previous, [item.id]: data.actual_quantity ?? '' }));
  }

  async function completeCount() {
    const items = detail?.items || [];
    const uncounted = items.filter(item => item.actual_quantity === null).length;
    if (uncounted > 0) {
      setError(`仍有 ${uncounted} 項尚未盤點，請全部填寫後再完成。`);
      setOnlyUncounted(true);
      return;
    }
    setCompleting(true);
    setError('');
    setNotice('');
    const { data, error: completeError } = await supabase.rpc('complete_inventory_count', {
      p_session_id: selectedId,
    });
    if (completeError) {
      setError(`完成盤點失敗：${completeError.message || '請重新整理後再試'}`);
    } else {
      setNotice(`盤點已完成，共更新 ${data?.completed_items || items.length} 項${Number(data?.shortage_quantity) > 0 ? `，並記錄 ${data.shortage_quantity} 件訂單待處理短缺` : ''}。`);
      await Promise.all([loadSessions(), loadDetail(selectedId, { quiet: true }), onInventoryChanged?.()]);
    }
    setCompleting(false);
  }

  async function deleteDraft() {
    if (!session || session.status !== 'draft') return;
    setDeleting(true);
    setError('');
    const { error: deleteError } = await supabase.rpc('delete_draft_inventory_count', {
      p_session_id: selectedId,
    });
    if (deleteError) {
      setError(`刪除草稿失敗：${deleteError.message || '請重新整理後再試'}`);
      setDeleting(false);
      return;
    }
    setSelectedId('');
    setDetail(null);
    setNotice('盤點草稿已刪除，正式庫存沒有異動。');
    setDeleting(false);
    await loadSessions();
  }

  const items = detail?.items || [];
  const summary = useMemo(() => ({
    total: items.length,
    uncounted: items.filter(item => item.actual_quantity === null).length,
    gain: items.filter(item => Number(item.variance) > 0).length,
    loss: items.filter(item => Number(item.variance) < 0).length,
  }), [items]);
  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter(item => {
      if (inventoryType !== 'all' && item.inventory_type !== inventoryType) return false;
      if (onlyUncounted && item.actual_quantity !== null) return false;
      if (onlyDifferent && Number(item.variance) === 0) return false;
      if (!keyword) return true;
      return [item.product_name, item.variant_name, item.sku]
        .some(value => String(value || '').toLowerCase().includes(keyword));
    });
  }, [items, search, onlyUncounted, onlyDifferent, inventoryType]);

  if (!selectedId) {
    return (
      <div className="inventory-counts-page">
        <div className="inventory-counts-header">
          <div><h1>庫存盤點</h1><p>盤點倉庫內的一般與贈品實體庫存，完成後保留不可修改的歷史紀錄。</p></div>
          <button className="admin-primary-btn" type="button" onClick={() => { setNewName(defaultCountName()); setCreateOpen(true); setError(''); }} disabled={creating}>建立盤點單</button>
        </div>
        {error && <div className="procurement-error">{error}</div>}
        {notice && <div className="backorders-notice">{notice}</div>}
        {loading ? <div className="inventory-counts-empty">盤點紀錄載入中...</div> : sessions.length === 0 ? (
          <div className="inventory-counts-empty"><strong>目前沒有盤點紀錄</strong><span>建立第一張盤點單後，系統會凍結當下商品與庫存範圍。</span></div>
        ) : (
          <div className="inventory-counts-list">
            {sessions.map(session => (
              <button type="button" className="inventory-count-session-card" key={session.id} onClick={() => setSelectedId(session.id)}>
                <div><strong>{session.name}</strong><span>建立於 {formatTime(session.created_at)} · {session.created_by_email || '後台管理員'}</span></div>
                <div className="inventory-count-session-summary">
                  <span className={`inventory-count-status ${session.status}`}>{session.status === 'completed' ? '已完成' : '草稿'}</span>
                  <span>{session.total_count} 項</span>
                  {session.status === 'draft' && <span>{session.uncounted_count} 項未盤</span>}
                  {session.status === 'completed' && <span>盤盈 {session.gain_count}／盤虧 {session.loss_count}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
        {createOpen && <div className="inventory-count-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
          <form className="inventory-count-modal-card" onSubmit={event => { event.preventDefault(); createCount(); }}>
            <h2>建立盤點單</h2>
            <p>建立後會凍結目前全部商品規格、一般庫存、贈品庫存與現場訂單保留數量。</p>
            <label htmlFor="inventory-count-name">盤點名稱</label>
            <input id="inventory-count-name" autoFocus maxLength="100" value={newName} onChange={event => setNewName(event.target.value)} />
            <div><button className="admin-secondary-btn" type="button" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button><button className="admin-primary-btn" type="submit" disabled={creating}>{creating ? '建立中...' : '建立盤點單'}</button></div>
          </form>
        </div>}
      </div>
    );
  }

  const session = detail?.session;
  const canComplete = session?.status === 'draft' && (session?.created_by === adminUserId || isSuperAdmin);
  return (
    <div className="inventory-counts-page">
      <div className="inventory-count-detail-top">
        <button type="button" className="inventory-count-back" onClick={() => { setSelectedId(''); setDetail(null); setNotice(''); setError(''); }}>←</button>
        <div>
          <h1>{session?.name || '庫存盤點'}</h1>
          <p>{session ? `建立於 ${formatTime(session.created_at)} · ${session.created_by_email || '後台管理員'}` : '載入中...'}</p>
        </div>
        {session?.status === 'completed' ? (
          <span className="inventory-count-status completed">已完成 · {formatTime(session.completed_at)}</span>
        ) : (
          <div className="inventory-count-actions">
            {canComplete && <button className="admin-secondary-btn" type="button" disabled={deleting || completing} onClick={() => setConfirmAction('delete')}>{deleting ? '刪除中...' : '刪除草稿'}</button>}
            <button className="admin-primary-btn" type="button" disabled={!canComplete || completing || deleting} onClick={() => setConfirmAction('complete')} title={!canComplete ? '只有建立者或最高管理員可以完成盤點' : undefined}>{completing ? '完成中...' : '完成盤點'}</button>
          </div>
        )}
      </div>
      {error && <div className="procurement-error">{error}</div>}
      {notice && <div className="backorders-notice">{notice}</div>}
      <div className="inventory-count-stats">
        <button type="button" onClick={() => { setOnlyUncounted(false); setOnlyDifferent(false); }}><strong>{summary.total}</strong><span>盤點項目</span></button>
        <button type="button" onClick={() => setOnlyUncounted(value => !value)} className={onlyUncounted ? 'active' : ''}><strong>{summary.uncounted}</strong><span>未盤點</span></button>
        <button type="button" onClick={() => setOnlyDifferent(true)}><strong className="gain">{summary.gain}</strong><span>盤盈（多）</span></button>
        <button type="button" onClick={() => setOnlyDifferent(true)}><strong className="loss">{summary.loss}</strong><span>盤虧（少）</span></button>
      </div>
      <div className="inventory-count-toolbar">
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋商品名稱、規格或 SKU..." />
        <select value={inventoryType} onChange={event => setInventoryType(event.target.value)} aria-label="庫存類型">
          <option value="all">全部庫存</option><option value="sale">一般庫存</option><option value="gift">贈品庫存</option>
        </select>
        <button type="button" className={onlyDifferent ? 'active' : ''} onClick={() => setOnlyDifferent(value => !value)}>只顯示有差異</button>
      </div>
      <div className="inventory-count-table-wrap">
        <div className="inventory-count-table-note">共 {visibleItems.length} 項 · 輸入實際數量後按 Enter 或移開焦點自動儲存</div>
        <table className="inventory-count-table">
          <thead><tr><th>商品／規格</th><th>庫存類型</th><th>可用庫存</th><th>現場保留</th><th>預期實體</th><th>實際數量</th><th>差異</th></tr></thead>
          <tbody>{visibleItems.map(item => {
            const variance = item.actual_quantity === null ? null : Number(item.variance);
            return <tr key={item.id}>
              <td><strong>{item.product_name}</strong><span>{item.variant_name} · {item.sku}</span></td>
              <td><span className={`inventory-kind ${item.inventory_type}`}>{inventoryLabel(item.inventory_type)}</span></td>
              <td>{item.system_stock_snapshot}</td><td>{item.onsite_allocated_snapshot}</td><td><strong>{item.expected_physical_snapshot}</strong></td>
              <td>{session?.status === 'draft' ? <input type="number" min="0" step="1" inputMode="numeric" value={drafts[item.id] ?? ''} onChange={event => setDrafts(previous => ({ ...previous, [item.id]: event.target.value }))} onBlur={() => saveItem(item)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} aria-label={`${item.product_name} ${item.variant_name} ${inventoryLabel(item.inventory_type)}實際數量`} /> : item.actual_quantity}</td>
              <td className={variance > 0 ? 'variance-gain' : variance < 0 ? 'variance-loss' : ''}>{variance === null ? '—' : variance > 0 ? `+${variance}` : variance}</td>
            </tr>;
          })}</tbody>
        </table>
        {!visibleItems.length && <div className="inventory-counts-empty"><strong>沒有符合條件的項目</strong></div>}
      </div>
      {session?.status === 'completed' && Number(detail?.shortages?.length) > 0 && (
        <div className="inventory-count-shortages">
          <h2>盤點造成的訂單待處理</h2>
          <p>一般商品已同步至待補數量；贈品短缺需補足後再交付對應訂單。</p>
          {(detail.shortages || []).map(shortage => {
            const remaining = Math.max(0, Number(shortage.quantity) - Number(shortage.resolved_quantity || 0));
            const label = shortage.inventory_type === 'sale'
              ? '一般商品已轉待補'
              : shortage.status === 'pending' ? '贈品待處理' : shortage.status === 'resolved' ? '贈品已補回' : '贈品待處理已結束';
            return <div key={shortage.id}><span>{label}</span><strong>{shortage.order_id || '未能對應訂單'} · {shortage.status === 'pending' ? remaining : shortage.quantity} 件</strong></div>;
          })}
        </div>
      )}
      {confirmAction && <div className="inventory-count-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmAction(''); }}>
        <div className="inventory-count-modal-card" role="dialog" aria-modal="true" aria-labelledby="inventory-count-confirm-title">
          <h2 id="inventory-count-confirm-title">{confirmAction === 'delete' ? '刪除盤點草稿？' : '完成盤點？'}</h2>
          <p>{confirmAction === 'delete'
            ? `「${session?.name}」已填寫的暫存數量會一併刪除，但正式庫存不會受到影響。`
            : '完成後會立即調整正式庫存，並永久禁止修改、刪除或重新開啟這張盤點單。'}</p>
          <div><button className="admin-secondary-btn" type="button" onClick={() => setConfirmAction('')}>返回</button><button className="admin-primary-btn" type="button" onClick={() => { const action = confirmAction; setConfirmAction(''); if (action === 'delete') deleteDraft(); else completeCount(); }}>{confirmAction === 'delete' ? '確認刪除草稿' : '確認完成盤點'}</button></div>
        </div>
      </div>}
    </div>
  );
}
