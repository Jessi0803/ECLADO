import React from 'react';
import { StatCard } from '../components/DashboardWidgets.jsx';
import { buildMonthlyRevenue, revenueSummary } from '../domain/analytics.js';

export default function Analytics({ orders }) {
  const monthlyRevenue = buildMonthlyRevenue(orders);
  const maxRev = Math.max(0, ...monthlyRevenue.map(d => d.revenue));
  const { totalRevenue, totalOrders, averageOrder } = revenueSummary(monthlyRevenue);
  const firstMonth = monthlyRevenue[0];
  const lastMonth = monthlyRevenue[monthlyRevenue.length - 1];
  const rangeLabel = `${firstMonth.year}年${firstMonth.month} — ${lastMonth.year}年${lastMonth.month}`;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400, marginBottom: 4 }}>營業分析</h1>
        <p style={{ fontSize: 13, color: 'var(--mid)' }}>{rangeLabel}</p>
      </div>

      <div className="stat-grid-3" style={{ marginBottom: 28 }}>
        <StatCard label="6個月總營業額" value={`NT$ ${(totalRevenue/10000).toFixed(1)}萬`} sub="近半年累計" icon="◐" />
        <StatCard label="6個月總訂單" value={totalOrders} sub={`平均每月 ${Math.round(totalOrders/6)} 筆`} icon="◫" />
        <StatCard label="平均客單價" value={`NT$ ${averageOrder.toLocaleString()}`} sub="含運費" icon="◈" />
      </div>

      {/* Bar chart full */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '32px', marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 24 }}>月營業額趨勢</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 200 }}>
          {monthlyRevenue.map((d, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--mid)' }}>NT${(d.revenue/1000).toFixed(0)}k</div>
              <div style={{ width: '100%', position: 'relative' }}>
                <div style={{ width: '100%', background: i === monthlyRevenue.length - 1 ? 'var(--dark)' : 'var(--light)', height: maxRev > 0 ? Math.max(8, (d.revenue / maxRev) * 150) : 8, transition: 'height 0.6s ease', borderRadius: '2px 2px 0 0', position: 'relative' }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--gold)', opacity: 0.5, height: d.revenue > 0 ? (d.proRevenue / d.revenue) * Math.max(8, (d.revenue / maxRev) * 150) : 0, borderRadius: '2px 2px 0 0' }} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mid)' }}>{d.month}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 12, height: 12, background: 'var(--dark)', borderRadius: 2 }} /><span style={{ fontSize: 11, color: 'var(--mid)' }}>總營業額</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 12, height: 12, background: 'var(--gold)', borderRadius: 2 }} /><span style={{ fontSize: 11, color: 'var(--mid)' }}>院線（PRO）佔比</span></div>
        </div>
      </div>

      {/* Monthly table */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 20 }}>月份明細</h3>
        <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--off)' }}>
              {['月份', '總營業額', '院線營業額', '一般消費', '訂單數', '平均客單'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthlyRevenue.map((d, i) => (
              <tr key={d.key} style={{ borderBottom: '1px solid var(--border)', background: i === monthlyRevenue.length - 1 ? 'var(--off)' : 'transparent' }}>
                <td style={{ padding: '13px 14px', fontSize: 13, fontWeight: i === monthlyRevenue.length - 1 ? 600 : 400 }}>{d.year}年{d.month}</td>
                <td style={{ padding: '13px 14px', fontSize: 13, fontWeight: 500 }}>NT$ {d.revenue.toLocaleString()}</td>
                <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--gold)' }}>NT$ {d.proRevenue.toLocaleString()}</td>
                <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--mid)' }}>NT$ {(d.revenue - d.proRevenue).toLocaleString()}</td>
                <td style={{ padding: '13px 14px', fontSize: 13 }}>{d.orders}</td>
                <td style={{ padding: '13px 14px', fontSize: 13 }}>NT$ {(d.orders ? Math.round(d.revenue / d.orders) : 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
