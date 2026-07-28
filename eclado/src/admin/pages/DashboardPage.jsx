import React from 'react';
import { Badge } from '../components/StatusIndicators.jsx';
import { MiniBarChart, StatCard } from '../components/DashboardWidgets.jsx';
import { MONTHLY_REVENUE } from '../data/mockData.js';

export default function Dashboard({ orders, products, members, applications = [], onGoToPendingMembers }) {
  const thisMonth = MONTHLY_REVENUE[MONTHLY_REVENUE.length - 1];
  const lastMonth = MONTHLY_REVENUE[MONTHLY_REVENUE.length - 2];
  const growth = (((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100).toFixed(1);
  const lowStock = products.filter(p => p.stock <= p.minStock);
  const pendingOrders = orders.filter(o => ['awaiting_confirm', 'paid', 'preparing'].includes(o.status));
  const paidOrders = orders.filter(o => o.status === 'paid');
  const applicationCount = applications.length;
  const pendingApplications = applications.filter(a => a.status === 'pending');

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400, color: 'var(--dark)', marginBottom: 4 }}>儀表板</h1>
        <p style={{ fontSize: 13, color: 'var(--mid)' }}>2026年5月1日 — 歡迎回來，Yoyo</p>
      </div>

      {/* Stats grid */}
      <div className="stat-grid-4" style={{ marginBottom: 32 }}>
        <StatCard label="本月營業額" value={`NT$ ${thisMonth.revenue.toLocaleString()}`} sub={`較上月 ${growth > 0 ? '+' : ''}${growth}%`} accent="var(--dark)" icon="◐" />
        <StatCard label="已付款訂單" value={paidOrders.length} sub={paidOrders.length > 0 ? '可安排後續出貨' : '目前無已付款訂單'} accent={paidOrders.length > 0 ? 'var(--blue)' : 'var(--green)'} icon="◫" />
        <StatCard label="待審核申請" value={pendingApplications.length} sub={pendingApplications.length > 0 ? '點擊前往會員管理審核' : '目前無待審核'} accent={pendingApplications.length > 0 ? 'var(--gold)' : 'var(--green)'} icon="◉" onClick={pendingApplications.length > 0 ? onGoToPendingMembers : undefined} />
        <StatCard label="庫存警示" value={lowStock.length} sub="件商品庫存不足" accent={lowStock.length > 0 ? 'var(--red)' : 'var(--green)'} icon="◉" />
      </div>

      <div className="split-2" style={{ marginBottom: 20 }}>
        {/* Revenue chart */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 2 }}>近6個月營業額</h3>
              <p style={{ fontSize: 12, color: 'var(--mid)' }}>月份 / 萬元</p>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, background: 'var(--dark)' }} />
                <span style={{ fontSize: 11, color: 'var(--mid)' }}>本月</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, background: 'var(--dark)', opacity: 0.25 }} />
                <span style={{ fontSize: 11, color: 'var(--mid)' }}>歷史</span>
              </div>
            </div>
          </div>
          <MiniBarChart data={MONTHLY_REVENUE} color="var(--dark)" height={120} />
        </div>

        {/* Low stock alert */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 4 }}>庫存警示</h3>
          <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 20 }}>低於 3 件需補貨</p>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 12, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {lowStock.length === 0 ? (
              <p style={{ width: '100%', fontSize: 13, color: 'var(--mid)', textAlign: 'center', padding: '20px 0' }}>✓ 庫存充足</p>
            ) : lowStock.map(p => (
              <div key={p.id} style={{ flex: '0 0 180px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: p.stock === 0 ? 'oklch(0.60 0.18 25 / 0.06)' : 'oklch(0.78 0.14 80 / 0.06)', border: `1px solid ${p.stock === 0 ? 'oklch(0.60 0.18 25 / 0.2)' : 'oklch(0.78 0.14 80 / 0.2)'}` }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--dark)', marginBottom: 2 }}>{p.nameZh}</p>
                  <p style={{ fontSize: 11, color: 'var(--mid)' }}>{p.size}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 16, fontWeight: 600, color: p.stock === 0 ? 'var(--red)' : 'var(--yellow)' }}>{p.stock}</p>
                  <p style={{ fontSize: 10, color: 'var(--mid)' }}>件</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500 }}>最新訂單</h3>
          <span style={{ fontSize: 12, color: 'var(--gold)', cursor: 'pointer', letterSpacing: '0.06em' }}>查看全部 →</span>
        </div>
        <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['訂單編號', '會員', '金額', '狀態', '日期'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 5).map(o => (
              <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px', fontSize: 12, color: 'var(--dark)', fontWeight: 500 }}>{o.id}</td>
                <td style={{ padding: '12px', fontSize: 13 }}>{o.member}</td>
                <td style={{ padding: '12px', fontSize: 13, fontWeight: 500 }}>NT$ {o.total.toLocaleString()}</td>
                <td style={{ padding: '12px' }}><Badge status={o.status} /></td>
                <td style={{ padding: '12px', fontSize: 12, color: 'var(--mid)' }}>{o.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
