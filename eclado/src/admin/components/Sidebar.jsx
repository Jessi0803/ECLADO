import React from 'react';

const MENU_GROUPS = [
  {
    title: '營運',
    items: [
      { id: 'dashboard', icon: '▦', label: '儀表板' },
      { id: 'orders', icon: '◫', label: '訂單管理' },
    ],
  },
  {
    title: '商品',
    items: [
      { id: 'catalog', icon: '◈', label: '商品 & 庫存' },
      { id: 'promotions', icon: '◆', label: '活動管理' },
      { id: 'ai', icon: '✦', label: 'AI 補貨建議' },
    ],
  },
  {
    title: '會員',
    items: [
      { id: 'members', icon: '◎', label: '會員管理' },
      { id: 'analytics', icon: '◐', label: '營業分析' },
    ],
  },
];

export default function Sidebar({ page, setPage, open, onClose, adminEmail, onSignOut }) {
  return (
    <div className={'app-sidebar' + (open ? ' open' : '')}>
      {/* Logo */}
      <div style={{ padding: '28px 24px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, letterSpacing: '0.2em', color: '#fff', marginBottom: 4 }}>ECLADO</div>
          <div style={{ fontSize: 9, letterSpacing: '0.24em', color: 'var(--gold)', textTransform: 'uppercase' }}>管理後台</div>
        </div>
        {/* Close (mobile only) */}
        <button onClick={onClose} className="sidebar-close" style={{
          background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer',
          lineHeight: 1, padding: 4,
        }}>×</button>
      </div>

      {/* Menu */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {MENU_GROUPS.map((group, gi) => (
          <div key={group.title} style={{ marginBottom: 8, paddingTop: gi === 0 ? 4 : 12 }}>
            <div style={{
              padding: '8px 24px 6px',
              fontSize: 9,
              letterSpacing: '0.22em',
              color: 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}>{group.title}</div>
            {group.items.map(item => (
              <button key={item.id} onClick={() => { setPage(item.id); if (onClose) onClose(); }} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '11px 24px', border: 'none',
                background: page === item.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: page === item.id ? '#fff' : 'rgba(255,255,255,0.45)',
                fontSize: 13, letterSpacing: '0.04em', textAlign: 'left',
                borderLeft: page === item.id ? '2px solid var(--gold)' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (page !== item.id) e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
              onMouseLeave={e => { if (page !== item.id) e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; }}
              >
                <span style={{ fontSize: 14, opacity: 0.8 }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '20px 24px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          type="button"
          onClick={() => { window.location.href = '/'; }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'rgba(184,169,138,0.12)', border: '1px solid rgba(184,169,138,0.28)',
            color: 'rgba(255,255,255,0.82)', fontSize: 12, letterSpacing: '0.08em',
            padding: '9px 0', cursor: 'pointer', marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
          返回前台
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: onSignOut ? 10 : 0 }}>
          <div style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff' }}>
            {adminEmail ? adminEmail[0].toUpperCase() : 'A'}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{adminEmail || '管理員'}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>管理員</div>
          </div>
        </div>
        {onSignOut && (
          <button onClick={onSignOut} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.1em', padding: '8px 0', cursor: 'pointer' }}>
            登出
          </button>
        )}
      </div>
    </div>
  );
}
