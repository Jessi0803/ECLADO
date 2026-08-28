import React from 'react';

export const STATUS_MAP = {
  awaiting_confirm: { label: '轉帳待確認', color: 'var(--red)' },
  unpaid: { label: '未付款', color: 'oklch(0.65 0.18 50)' },
  paid: { label: '已付款', color: 'var(--blue)' },
  preparing: { label: '備貨中', color: 'var(--yellow)' },
  ready_for_pickup: { label: '可取貨', color: 'var(--gold)' },
  picked_up: { label: '已取貨', color: 'var(--green)' },
  shipped: { label: '已出貨', color: 'var(--gold)' },
  delivered: { label: '已到貨', color: 'var(--green)' },
  returned: { label: '退貨', color: 'oklch(0.55 0.12 300)' },
  cancelled: { label: '已取消', color: 'var(--mid)' },
};

export const STATUS_OPTIONS = ['awaiting_confirm', 'paid', 'preparing', 'shipped', 'delivered', 'returned'];
export const PICKUP_STATUS_OPTIONS = ['awaiting_confirm', 'unpaid', 'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'returned'];

const PROMOTION_PHASES = {
  live: { label: '進行中', color: 'var(--green)' },
  scheduled: { label: '排程中', color: 'var(--gold)' },
  expired: { label: '已結束', color: 'var(--mid)' },
};

export function getPromotionPhase(promotion) {
  const now = Date.now();
  if (promotion?.start_at && new Date(promotion.start_at).getTime() > now) return 'scheduled';
  if (promotion?.end_at && new Date(promotion.end_at).getTime() < now) return 'expired';
  return 'live';
}

export function PromoBadge({ phase }) {
  const item = PROMOTION_PHASES[phase] || PROMOTION_PHASES.expired;
  return <span style={{ display:'inline-block', padding:'3px 10px', fontSize:11, fontWeight:500, letterSpacing:'0.06em', background:item.color + '18', color:item.color, borderRadius:2 }}>{item.label}</span>;
}

export function Badge({ status }) {
  const item = STATUS_MAP[status] || { label:status, color:'var(--mid)' };
  return <span style={{ display:'inline-block', padding:'3px 10px', fontSize:11, fontWeight:500, letterSpacing:'0.06em', background:item.color + '18', color:item.color, borderRadius:2 }}>{item.label}</span>;
}

export function StatusSelect({ status, onChange, size = 'sm', fulfillmentMethod = 'delivery' }) {
  const item = STATUS_MAP[status] || { label:status, color:'var(--mid)' };
  if (status === 'cancelled') {
    return <Badge status="cancelled" />;
  }
  const padding = size === 'lg' ? '8px 32px 8px 12px' : '4px 24px 4px 10px';
  return (
    <div style={{ position:'relative', display:'inline-block' }}>
      <select value={status} onChange={event => onChange(event.target.value)} onClick={event => event.stopPropagation()} style={{ appearance:'none', WebkitAppearance:'none', MozAppearance:'none', padding, fontSize:size === 'lg' ? 13 : 11, fontWeight:500, letterSpacing:'0.06em', background:item.color + '18', color:item.color, border:`1px solid ${item.color}40`, borderRadius:2, cursor:'pointer', fontFamily:'inherit', minWidth:size === 'lg' ? 160 : 110 }}>
        {(fulfillmentMethod === 'onsite_pickup' ? PICKUP_STATUS_OPTIONS : STATUS_OPTIONS).map(option => <option key={option} value={option} style={{ background:'#fff', color:'var(--dark)' }}>{STATUS_MAP[option].label}</option>)}
      </select>
      <span style={{ position:'absolute', right:size === 'lg' ? 12 : 8, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', fontSize:9, color:item.color }}>▼</span>
    </div>
  );
}

export function TypeBadge({ type }) {
  const types = {
    pro: { label:'美容師', color:'var(--dark)' },
    instructor: { label:'師資', color:'var(--gold)' },
    distributor: { label:'經銷商', color:'var(--green)' },
    consumer: { label:'一般會員', color:'var(--mid)' },
    pending: { label:'審核中', color:'var(--yellow)' },
  };
  const item = types[type] || { label:type, color:'var(--mid)' };
  return <span style={{ display:'inline-block', padding:'3px 10px', fontSize:11, fontWeight:500, letterSpacing:'0.06em', background:item.color + '18', color:item.color, borderRadius:2 }}>{item.label}</span>;
}
