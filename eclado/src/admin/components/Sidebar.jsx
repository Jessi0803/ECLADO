import React from 'react';

const MENU_GROUPS = [
  {
    title: '營運',
    items: [
      { id: 'dashboard', icon: 'dashboard', label: '儀表板' },
      { id: 'orders', icon: 'orders', label: '訂單管理' },
      { id: 'audit', icon: 'audit', label: '操作紀錄' },
    ],
  },
  {
    title: '商品',
    items: [
      { id: 'catalog', icon: 'catalog', label: '商品 & 庫存' },
      { id: 'promotions', icon: 'promotions', label: '活動管理' },
      { id: 'ai', icon: 'ai', label: 'AI 補貨建議' },
    ],
  },
  {
    title: '會員',
    items: [
      { id: 'members', icon: 'members', label: '會員管理' },
      { id: 'analytics', icon: 'analytics', label: '營業分析' },
    ],
  },
];

function SidebarIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
    case 'orders':
      return <svg {...common}><path d="M7 4h10a2 2 0 012 2v15H5V6a2 2 0 012-2z" /><path d="M9 3h6v3H9zM8 11h8M8 15h8" /></svg>;
    case 'audit':
      return <svg {...common}><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /><path d="M9 2h6v4H9z" /></svg>;
    case 'catalog':
      return <svg {...common}><path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10" /></svg>;
    case 'promotions':
      return <svg {...common}><path d="M4 5h10l6 6-9 9-7-7V5z" /><circle cx="8.5" cy="9.5" r="1.2" /></svg>;
    case 'ai':
      return <svg {...common}><path d="M12 3l1.25 4.25L17.5 8.5l-4.25 1.25L12 14l-1.25-4.25L6.5 8.5l4.25-1.25L12 3zM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3zM6 15l.55 1.95L8.5 17.5l-1.95.55L6 20l-.55-1.95-1.95-.55 1.95-.55L6 15z" /></svg>;
    case 'members':
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0111 0v2M16 5.5a3 3 0 010 5.5M17 14a5 5 0 013.5 4.8V20" /></svg>;
    case 'analytics':
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
    default:
      return null;
  }
}

export default function Sidebar({ page, setPage, open, onClose, adminEmail, onSignOut }) {
  return (
    <div className={'app-sidebar' + (open ? ' open' : '')}>
      {/* Logo */}
      <div style={{ padding: '20px 24px 17px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <img src="/assets/images/ONLY ECLADO LOGO_WHITE.png" alt="ECLADO Laboratory" style={{ width:100, height:'auto', display:'block', marginBottom:8 }} />
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
                <span style={{ width:20, height:18, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity:0.8 }}>
                  <SidebarIcon name={item.icon} />
                </span>
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
