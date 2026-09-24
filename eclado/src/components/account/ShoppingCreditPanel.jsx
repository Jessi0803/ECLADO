import React, { useEffect, useState } from 'react';
import { getMyShoppingCredit } from '../../services/shoppingCredit.js';

const EVENT_LABELS = Object.freeze({
  grant: '購物金入帳',
  debit: '購物金扣除',
  reserve: '訂單保留',
  consume: '訂單付款',
  release: '購物金返還',
  refund: '訂單取消返還',
});

const REASON_LABELS = Object.freeze({
  customer_service_compensation: '客服補償',
  campaign_grant: '活動贈送',
  order_return_adjustment: '訂單／退貨調整',
  wrong_account_correction: '錯帳更正',
  eligibility_revocation: '資格撤回',
  other: '其他',
  order_checkout: '訂單結帳',
  payment_success: '付款完成',
  order_cancelled: '訂單取消',
  order_expired: '訂單逾期',
  payment_failed: '付款失敗',
  paid_order_cancelled: '已付款訂單取消',
});

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
}

function entryAmount(entry) {
  const amount = money(entry.amount);
  if (entry.event_type === 'consume') return `使用 ${amount}`;
  if (Number(entry.available_delta) > 0) return `+${amount}`;
  if (Number(entry.available_delta) < 0) return `-${amount}`;
  return amount;
}

function dateTime(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ShoppingCreditPanel({ userId, isMobile }) {
  const [credit, setCredit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    setExpanded(false);
    setVisibleCount(10);
    getMyShoppingCredit().then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) {
        setCredit(null);
        setError('購物金資料暫時無法載入。');
      } else {
        setCredit({
          availableBalance: Number(data?.available_balance || 0),
          entries: Array.isArray(data?.entries) ? data.entries : [],
        });
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [userId]);

  const entries = credit?.entries || [];
  const visibleEntries = entries.slice(0, visibleCount);

  return (
    <section aria-label="購物金" style={{ border:'1px solid var(--light)', padding:isMobile ? 18 : 24, marginBottom:32 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16 }}>
        <div>
          <div style={{ fontSize:12, letterSpacing:'0.12em', color:'var(--dark)', marginBottom:8 }}>購物金</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 26 : 32, color:'var(--black)' }}>
            {loading ? '載入中…' : money(credit?.availableBalance || 0)}
          </div>
          <div style={{ fontSize:11, color:'var(--dark)', marginTop:5 }}>目前可用餘額</div>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            style={{ background:'none', border:'1px solid var(--light)', color:'var(--black)', padding:'9px 12px', fontSize:11, letterSpacing:'0.06em', cursor:'pointer', fontFamily:'inherit' }}
          >
            {expanded ? '收合異動明細' : `查看異動明細（${entries.length}）`}
          </button>
        )}
      </div>

      {error && <p role="alert" style={{ marginTop:16, fontSize:12, color:'#991b1b' }}>{error}</p>}

      {expanded && (
        <div style={{ marginTop:20, borderTop:'1px solid var(--light)' }}>
          {visibleEntries.map(entry => (
            <div key={entry.id} style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr auto', gap:8, padding:'14px 0', borderBottom:'1px solid var(--light)' }}>
              <div>
                <div style={{ fontSize:13, color:'var(--black)', fontWeight:500 }}>{EVENT_LABELS[entry.event_type] || '購物金異動'}</div>
                <div style={{ fontSize:11, color:'var(--dark)', marginTop:4 }}>
                  原因：{REASON_LABELS[entry.reason_code] || entry.reason_code || '—'}
                  {entry.order_id ? ` · 訂單 ${entry.order_id}` : ''}
                </div>
              </div>
              <div style={{ textAlign:isMobile ? 'left' : 'right' }}>
                <div style={{ fontSize:13, color:'var(--black)', fontWeight:500 }}>{entryAmount(entry)}</div>
                <div style={{ fontSize:11, color:'var(--dark)', marginTop:4 }}>{dateTime(entry.created_at)}</div>
              </div>
            </div>
          ))}
          {visibleCount < entries.length && (
            <button type="button" onClick={() => setVisibleCount(count => count + 10)} style={{ width:'100%', marginTop:14, background:'none', border:'1px solid var(--light)', padding:'10px', fontSize:11, color:'var(--black)', cursor:'pointer', fontFamily:'inherit' }}>
              載入更多
            </button>
          )}
        </div>
      )}
    </section>
  );
}
