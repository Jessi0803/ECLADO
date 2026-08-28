import React, { useEffect, useState } from 'react';
import { PAYMENT_METHODS } from '../../domain/payments.js';
import { SF_EXPRESS_TRACKING_URL } from '../../domain/shipping.js';
import { supabase } from '../../services/supabase.js';
import { StatusSelect, TypeBadge } from '../components/StatusIndicators.jsx';

function hasPreorder(order) {
  return Array.isArray(order.items) && order.items.some(i => i.fulfillment_type === 'preorder');
}

function getPaymentMethodLabel(method) {
  return PAYMENT_METHODS[method]?.label || '—';
}

function getStatusFilter(status) {
  if (status === 'ready_for_pickup') return 'shipped';
  if (status === 'picked_up') return 'delivered';
  return status;
}

function matchesStatusFilter(order, filter) {
  if (filter === 'all') return true;
  if (filter === 'shipped') return ['shipped', 'ready_for_pickup'].includes(order.status);
  if (filter === 'delivered') return ['delivered', 'picked_up'].includes(order.status);
  return order.status === filter;
}

function formatNotificationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Orders({ orders, persistOrderPatch, defaultFilter = 'awaiting_confirm' }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState(defaultFilter);
  const [stockFilter, setStockFilter] = useState('all');
  const [trackingInput, setTrackingInput] = useState('');
  const [pushing, setPushing] = useState(false);
  const [lineNotice, setLineNotice] = useState('');

  useEffect(() => {
    setTrackingInput(selected?.tracking || '');
  }, [selected?.id]);

  useEffect(() => {
    setFilter(getStatusFilter(defaultFilter));
    setSelected(null);
  }, [defaultFilter]);

  const byStatus = orders.filter(order => matchesStatusFilter(order, filter));
  const filtered = stockFilter === 'all' ? byStatus
    : stockFilter === 'preorder' ? byStatus.filter(hasPreorder)
    : byStatus.filter(o => !hasPreorder(o));
  const awaitingCount = orders.filter(o => o.status === 'awaiting_confirm').length;
  const unpaidCount = orders.filter(o => o.status === 'unpaid').length;
  const returnedCount = orders.filter(o => o.status === 'returned').length;
  const preorderCount = byStatus.filter(hasPreorder).length;
  const inStockCount = byStatus.filter(o => !hasPreorder(o)).length;

  async function pushLineOrderNotice(order, type, extra = {}) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      setLineNotice('管理員登入狀態已失效，請重新登入後再試。');
      return { ok: false, channel: '', error: '管理員登入狀態已失效' };
    }
    const authorizedHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    async function pushEmailOrderNotice(fallbackReason = '') {
      if (!order?.email) {
        setLineNotice(fallbackReason || '此訂單沒有 Email，無法發送通知。');
        return { ok: false, channel: '', error: fallbackReason || '此訂單沒有 Email，無法發送通知。' };
      }
      const response = await fetch('/api/order-email', {
        method: 'POST',
        headers: authorizedHeaders,
        body: JSON.stringify({
          type,
          email: order.email,
          orderId: order.id,
          memberName: order.member,
          total: order.total,
          ...extra,
        }),
      }).catch(e => {
        setLineNotice('Email 通知送出失敗：' + (e.message || '網路錯誤'));
        return null;
      });
      if (!response) return { ok: false, channel: 'email', error: 'Email 網路錯誤' };
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setLineNotice('Email 通知送出失敗：' + (body.error || `HTTP ${response.status}`));
        return { ok: false, channel: 'email', error: body.error || `HTTP ${response.status}` };
      }
      setLineNotice(type === 'payment_paid' ? 'Email 付款完成通知已送出。' : 'Email 出貨通知已送出。');
      return { ok: true, channel: 'email', error: '' };
    }

    if (!order?.user_id) {
      return pushEmailOrderNotice('此訂單沒有綁定會員與 Email，無法發送通知。');
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('line_user_id')
      .eq('id', order.user_id)
      .single();
    if (error) {
      return pushEmailOrderNotice('讀取會員 LINE 資料失敗，Email 通知也無法送出。');
    }
    if (!profile?.line_user_id) {
      return pushEmailOrderNotice('此會員沒有 LINE 綁定資料，且訂單沒有 Email，無法發送通知。');
    }
    const response = await fetch('/api/line-push', {
      method: 'POST',
      headers: authorizedHeaders,
      body: JSON.stringify({
        type,
        lineUserId: profile.line_user_id,
        orderId: order.id,
        memberName: order.member,
        total: order.total,
        ...extra,
      }),
    }).catch(e => {
      setLineNotice('LINE 通知送出失敗，正在改寄 Email。');
      return null;
    });
    if (!response) {
      return pushEmailOrderNotice('LINE 通知因網路錯誤送出失敗，且訂單沒有 Email，無法發送備援通知。');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return pushEmailOrderNotice(`LINE 通知送出失敗（${body.error || `HTTP ${response.status}`}），且訂單沒有 Email，無法發送備援通知。`);
    }
    setLineNotice(type === 'payment_paid' ? 'LINE 付款完成通知已送出。' : 'LINE 出貨通知已送出。');
    return { ok: true, channel: 'line', error: '' };
  }

  async function sendShipmentNotice(order, { force = false } = {}) {
    if (!force && order.shipmentNotificationSentAt) {
      setLineNotice(`出貨通知已於 ${formatNotificationTime(order.shipmentNotificationSentAt)} 發送；如需再次通知，請使用「重新發送」。`);
      return false;
    }

    const result = await pushLineOrderNotice(order, 'shipment', { tracking: order.tracking });
    const patch = result.ok
      ? {
          shipment_notification_sent_at: new Date().toISOString(),
          shipment_notification_channel: result.channel,
          shipment_notification_error: null,
        }
      : {
          shipment_notification_error: result.error || 'LINE 與 Email 通知皆發送失敗',
        };

    try {
      await persistOrderPatch(order.id, patch);
      if (selected?.id === order.id) {
        setSelected(current => ({
          ...current,
          ...(result.ok ? {
            shipmentNotificationSentAt: patch.shipment_notification_sent_at,
            shipmentNotificationChannel: patch.shipment_notification_channel,
            shipmentNotificationError: '',
          } : {
            shipmentNotificationError: patch.shipment_notification_error,
          }),
        }));
      }
    } catch (error) {
      setLineNotice(
        result.ok
          ? `通知已送出，但通知紀錄儲存失敗：${error?.message || '請稍後再試'}`
          : `通知失敗，且錯誤紀錄無法儲存：${error?.message || '請稍後再試'}`,
      );
    }
    return result.ok;
  }

  async function resendShipmentNotice() {
    setPushing(true);
    try {
      await sendShipmentNotice(selected, { force: true });
    } finally {
      setPushing(false);
    }
  }

  async function updateStatus(id, status) {
    setLineNotice('');
    const order = orders.find(o => o.id === id);
    const shouldNotifyPaid = order && order.status !== 'paid' && status === 'paid';
    const typedTracking = selected?.id === id ? trackingInput.trim() : '';
    const shipmentTracking = typedTracking || order?.tracking;
    const shouldNotifyShipment = order && order.status !== 'shipped' && status === 'shipped';
    const patch = status === 'shipped' && typedTracking ? { status, tracking: typedTracking } : { status };
    if (shouldNotifyShipment && !shipmentTracking) {
      setLineNotice('請先輸入順豐托運單號，再確認出貨。');
      return;
    }
    try {
      await persistOrderPatch(id, patch);
      if (selected?.id === id) setSelected(s => ({ ...s, ...patch }));
      setFilter(getStatusFilter(status));
    } catch (error) {
      setLineNotice('訂單狀態更新失敗：' + (error?.message || '請稍後再試'));
      return;
    }
    if (shouldNotifyPaid) {
      await pushLineOrderNotice({ ...order, status }, 'payment_paid');
    }
    if (shouldNotifyShipment) {
      await sendShipmentNotice({ ...order, status, tracking: shipmentTracking });
    }
  }

  async function confirmShipment() {
    const id = selected.id;
    const tracking = trackingInput.trim();
    if (!tracking) {
      setLineNotice('請輸入順豐托運單號，再確認出貨。');
      return;
    }
    setPushing(true);
    setLineNotice('');
    const newStatus = ['paid', 'preparing'].includes(selected.status) ? 'shipped' : selected.status;
    const isNewShipment = newStatus === 'shipped' && selected.status !== 'shipped';
    try {
      const shipmentPatch = {
        status: newStatus,
        tracking,
        shipping_carrier: 'sf_express',
        ...(isNewShipment ? { shipped_at: new Date().toISOString() } : {}),
      };
      await persistOrderPatch(id, shipmentPatch);
      const shipmentOrder = {
        ...selected,
        status: newStatus,
        tracking,
        shippingCarrier: 'sf_express',
        ...(isNewShipment ? { shippedAt: shipmentPatch.shipped_at } : {}),
      };
      setSelected(shipmentOrder);
      setFilter(getStatusFilter(newStatus));
      if (isNewShipment) {
        await sendShipmentNotice(shipmentOrder);
      }
    } catch (error) {
      setLineNotice('出貨資料儲存失敗：' + (error?.message || '請稍後再試'));
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className={'detail-grid' + (selected ? '' : ' no-panel')}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400 }}>訂單管理</h1>
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', background: 'var(--white)', flexWrap: 'wrap' }}>
            {[['all','全部'], ['awaiting_confirm','轉帳待確認'], ['unpaid','未付款'], ['paid','已付款'], ['preparing','備貨中'], ['shipped','已出貨'], ['delivered','已到貨'], ['returned','退貨'], ['cancelled','已取消']].map(([val, label]) => (
              <button key={val} aria-pressed={filter === val} onClick={() => setFilter(val)} style={{
                padding: '8px 16px', border: 'none', fontSize: 12, letterSpacing: '0.04em',
                background: filter === val ? 'var(--dark)' : 'transparent',
                color: filter === val ? '#fff' : 'var(--mid)',
                cursor: 'pointer', transition: 'all 0.15s', position: 'relative',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {label}
                {val === 'awaiting_confirm' && awaitingCount > 0 && (
                  <span className="admin-filter-count-badge">{awaitingCount}</span>
                )}
                {val === 'unpaid' && unpaidCount > 0 && (
                  <span style={{
                    background: 'oklch(0.65 0.18 50)', color: '#fff', fontSize: 10, fontWeight: 600,
                    minWidth: 18, height: 18, borderRadius: 9, padding: '0 6px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}>{unpaidCount}</span>
                )}
                {val === 'returned' && returnedCount > 0 && (
                  <span style={{
                    background: 'oklch(0.55 0.12 300)', color: '#fff', fontSize: 10, fontWeight: 600,
                    minWidth: 18, height: 18, borderRadius: 9, padding: '0 6px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}>{returnedCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 庫存狀態篩選 */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--mid)', letterSpacing: '0.08em', marginRight: 10, whiteSpace: 'nowrap' }}>庫存狀態</span>
          {[['all', '全部'], ['in_stock', '現貨'], ['preorder', '含預購']].map(([val, label]) => {
            const count = val === 'in_stock' ? inStockCount : val === 'preorder' ? preorderCount : null;
            return (
              <button key={val} onClick={() => setStockFilter(val)} style={{
                padding: '6px 14px', border: '1px solid var(--border)', borderRight: 'none', fontSize: 11,
                background: stockFilter === val ? 'var(--dark)' : 'var(--white)',
                color: stockFilter === val ? '#fff' : 'var(--mid)',
                cursor: 'pointer', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5,
                ...(val === 'preorder' ? { borderRight: '1px solid var(--border)' } : {}),
              }}>
                {label}
                {count != null && count > 0 && (
                  <span style={{
                    background: val === 'preorder' ? 'var(--gold)' : 'var(--green)', color: '#fff',
                    fontSize: 10, fontWeight: 600, minWidth: 16, height: 16, borderRadius: 8,
                    padding: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 轉帳待確認提示 */}
        {filter === 'awaiting_confirm' && awaitingCount > 0 && (
          <div style={{ background: 'oklch(0.60 0.18 25 / 0.05)', border: '1px solid oklch(0.60 0.18 25 / 0.2)', padding: '14px 20px', marginBottom: 16, fontSize: 13, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <span>有 <strong>{awaitingCount}</strong> 筆顧客待確認付款，請對帳後點選「確認入帳」</span>
          </div>
        )}

        <div className="table-scroll" style={{ background: 'var(--white)', border: '1px solid var(--border)' }}>
          <table className="responsive-admin-table admin-orders-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--off)' }}>
                {['訂單編號', '會員', '類型', '金額', '付款方式', '庫存', '狀態', '日期'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>目前沒有訂單</td>
                </tr>
              )}
              {filtered.map(o => (
                <tr key={o.id} onClick={() => setSelected(o)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === o.id ? 'var(--off)' : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (selected?.id !== o.id) e.currentTarget.style.background = 'var(--off)'; }}
                onMouseLeave={e => { if (selected?.id !== o.id) e.currentTarget.style.background = 'transparent'; }}>
                  <td data-label="訂單編號" style={{ padding: '13px 14px', fontSize: 12, fontWeight: 500, color: 'var(--dark)', whiteSpace: 'nowrap' }}>{o.id}</td>
                  <td data-label="會員" style={{ padding: '13px 14px', fontSize: 13 }}>{o.member}</td>
                  <td data-label="類型" style={{ padding: '13px 14px' }}><TypeBadge type={o.type} />{o.fulfillmentMethod === 'onsite_pickup' && <span style={{ display:'block', marginTop:5, fontSize:10, color:'var(--gold)', whiteSpace:'nowrap' }}>客訂自取</span>}</td>
                  <td data-label="金額" style={{ padding: '13px 14px', fontSize: 13, fontWeight: 500 }}>NT$ {o.total.toLocaleString()}</td>
                  <td data-label="付款方式" style={{ padding: '13px 14px', fontSize: 12, color: o.paymentMethod ? 'var(--dark)' : 'var(--light)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {getPaymentMethodLabel(o.paymentMethod)}
                  </td>
                  <td data-label="庫存" style={{ padding: '13px 14px' }}>
                    {hasPreorder(o)
                      ? <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gold)', background: 'oklch(0.82 0.12 80 / 0.12)', padding: '3px 8px', whiteSpace: 'nowrap' }}>預購</span>
                      : <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--green)', background: 'oklch(0.65 0.18 145 / 0.10)', padding: '3px 8px', whiteSpace: 'nowrap' }}>現貨</span>
                    }
                  </td>
                  <td data-label="狀態" style={{ padding: '13px 14px' }}>
                    <StatusSelect status={o.status} fulfillmentMethod={o.fulfillmentMethod} onChange={ns => updateStatus(o.id, ns)} />
                  </td>
                  <td data-label="日期" style={{ padding: '13px 14px', fontSize: 12, color: 'var(--mid)', whiteSpace: 'nowrap' }}>{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order detail panel */}
      {selected && (
        <>
        <button type="button" className="detail-panel-backdrop" aria-label="關閉訂單詳情" onClick={() => setSelected(null)} />
        <div className="detail-panel" role="dialog" aria-modal="true" aria-label="訂單詳情" style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 500 }}>訂單詳情</h3>
            <button type="button" aria-label="關閉訂單詳情" onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--mid)', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 4 }}>訂單編號</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: 'var(--dark)' }}>{selected.id}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div><div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>會員</div><div style={{ fontSize: 13 }}>{selected.member}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>日期</div><div style={{ fontSize: 13 }}>{selected.date}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>類型</div><TypeBadge type={selected.type} /></div>
            <div><div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>付款方式</div><div style={{ fontSize: 13 }}>{getPaymentMethodLabel(selected.paymentMethod)}</div></div>
          </div>

          {/* 狀態下拉 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 6 }}>訂單狀態</div>
            <StatusSelect status={selected.status} fulfillmentMethod={selected.fulfillmentMethod} onChange={ns => updateStatus(selected.id, ns)} size="lg" />
          </div>

          {selected.phone && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>聯絡電話</div>
              <div style={{ fontSize: 13, color: 'var(--dark)' }}>{selected.phone}</div>
            </div>
          )}
          {lineNotice && (
            <div style={{
              border: '1px solid var(--border)',
              background: 'var(--off)',
              padding: '10px 12px',
              marginBottom: 14,
              fontSize: 12,
              color: lineNotice.includes('失敗') || lineNotice.includes('無法') ? 'var(--red)' : 'var(--green)',
              lineHeight: 1.6,
            }}>
              {lineNotice}
            </div>
          )}
          {selected.fulfillmentMethod === 'onsite_pickup' ? (
            <div style={{ border:'1px solid var(--gold)', background:'oklch(0.82 0.12 80 / 0.08)', color:'var(--gold)', padding:'10px 12px', marginBottom:20, fontSize:12, fontWeight:500 }}>客訂自取 · 不需收件地址與托運單號</div>
          ) : <>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 8 }}>收件地址</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 20, color: 'var(--dark)' }}>{selected.address}</div>
          </>}
          {selected.note && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>備註</div>
              <div style={{ fontSize: 12, color: 'var(--dark)', lineHeight: 1.7 }}>{selected.note}</div>
            </div>
          )}
          {/* 托運/出貨區塊 */}
          {selected.fulfillmentMethod !== 'onsite_pickup' && !['cancelled', 'returned'].includes(selected.status) && (
            <div style={{ marginBottom: 20 }}>
              {['paid', 'preparing', 'shipped'].includes(selected.status) ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 6 }}>托運單號</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={trackingInput}
                      onChange={e => setTrackingInput(e.target.value)}
                      placeholder="輸入順豐托運單號（必填）"
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', fontSize: 12, outline: 'none', background: 'var(--off)' }}
                    />
                    <button
                      onClick={confirmShipment}
                      disabled={pushing}
                      style={{
                        padding: '8px 12px', background: 'var(--dark)', color: '#fff', border: 'none',
                        fontSize: 11, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                        cursor: !pushing ? 'pointer' : 'not-allowed',
                        opacity: !pushing ? 1 : 0.45,
                      }}
                    >{pushing ? '...' : selected.status === 'shipped' ? '更新' : '確認出貨'}</button>
                  </div>
                  {selected.tracking && (
                    <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 6 }}>
                      目前：<a href={SF_EXPRESS_TRACKING_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{selected.tracking}</a>
                    </div>
                  )}
                  {selected.status === 'shipped' && selected.tracking && (
                    <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', background: 'var(--off)' }}>
                      <div style={{ fontSize: 11, color: 'var(--mid)', lineHeight: 1.7 }}>
                        {selected.shippedAt && <div>出貨時間：{formatNotificationTime(selected.shippedAt)}</div>}
                        {selected.shipmentNotificationSentAt ? (
                          <div style={{ color: 'var(--green)' }}>
                            通知已發送：{formatNotificationTime(selected.shipmentNotificationSentAt)}
                            {selected.shipmentNotificationChannel ? `（${selected.shipmentNotificationChannel === 'line' ? 'LINE' : 'Email'}）` : ''}
                          </div>
                        ) : (
                          <div>尚無成功通知紀錄</div>
                        )}
                        {selected.shipmentNotificationError && (
                          <div style={{ color: 'var(--red)' }}>最近錯誤：{selected.shipmentNotificationError}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={resendShipmentNotice}
                        disabled={pushing}
                        style={{ marginTop: 8, padding: '7px 10px', border: '1px solid var(--dark)', background: 'var(--white)', color: 'var(--dark)', fontSize: 11, cursor: pushing ? 'not-allowed' : 'pointer' }}
                      >
                        重新發送出貨通知
                      </button>
                    </div>
                  )}
                </>
              ) : selected.tracking ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4 }}>物流追蹤</div>
                  <a href={SF_EXPRESS_TRACKING_URL} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500, textDecoration: 'none' }}>{selected.tracking}</a>
                </>
              ) : null}
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 12 }}>商品明細</div>
            {selected.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                <span>{item.name} × {item.qty}</span>
                <span style={{ fontWeight: 500 }}>NT$ {(item.price * item.qty).toLocaleString()}</span>
              </div>
            ))}
            {selected.subtotal != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 8, color: 'var(--mid)' }}>
                <span>商品小計</span><span>NT$ {Number(selected.subtotal).toLocaleString()}</span>
              </div>
            )}
            {selected.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, color: 'var(--red)' }}>
                <span>活動折抵{selected.promotionName ? `（${selected.promotionName}）` : ''}</span>
                <span style={{ fontWeight: 500 }}>−NT$ {Number(selected.discount).toLocaleString()}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, color: 'var(--mid)' }}>
              <span>運費</span>
              <span>{selected.shipping === 0 ? '免運' : `NT$ ${Number(selected.shipping).toLocaleString()}`}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <span>合計</span><span>NT$ {selected.total.toLocaleString()}</span>
            </div>
          </div>
          {selected.status !== 'cancelled' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => { if (confirm('確認要取消此訂單嗎？')) updateStatus(selected.id, 'cancelled'); }}
                style={{ flex: 1, padding: '10px', background: 'none', color: 'var(--mid)', border: '1px solid var(--border)', fontSize: 12, letterSpacing: '0.1em', cursor: 'pointer' }}
              >取消訂單</button>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
