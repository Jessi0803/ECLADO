import React from 'react';
import {
  formatMoney,
  formatQuarterPeriod,
  PROFESSIONAL_ROLE_LABELS,
  quarterTitle,
} from '../../domain/professionalSales.js';

export default function QuarterlySalesPanel({ sales, loading = false, error = '', isMobile = false }) {
  if (loading) {
    return <div style={{ borderTop:'1px solid var(--black)', padding:'24px 0', color:'var(--dark)', fontSize:13 }}>正在載入季度採購資料…</div>;
  }
  if (error) {
    return <div role="alert" style={{ border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b', padding:'14px 16px', fontSize:12 }}>{error}</div>;
  }

  const current = sales?.currentQuarter;
  const recent = sales?.quarters?.slice(0, 4) || [];
  if (!current) {
    return (
      <div style={{ borderTop:'1px solid var(--black)', padding:'24px 0 10px' }}>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 22 : 28, fontWeight:300, marginBottom:10 }}>季度採購統計</h2>
        <p style={{ fontSize:13, color:'var(--dark)', lineHeight:1.8 }}>專業資格季度尚未建立，請聯繫管理員確認資格起算日。</p>
      </div>
    );
  }

  return (
    <section aria-label="季度採購統計" style={{ marginBottom:isMobile ? 34 : 42 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:16, marginBottom:16 }}>
        <div>
          <p style={{ fontSize:10, color:'var(--gold)', letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:6 }}>Quarterly Purchase</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 24 : 30, fontWeight:300 }}>季度採購統計</h2>
        </div>
        <span style={{ fontSize:11, color:'var(--dark)' }}>{PROFESSIONAL_ROLE_LABELS[current.role] || current.role}</span>
      </div>

      <div style={{ border:'1px solid var(--light)', background:'var(--off-white)', padding:isMobile ? 18 : 24, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:12, color:'var(--dark)', marginBottom:6 }}>{quarterTitle(current)}</div>
            <div style={{ fontSize:11, color:'var(--dark)' }}>{formatQuarterPeriod(current)}</div>
          </div>
          <div style={{ textAlign:isMobile ? 'left' : 'right' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 28 : 34, fontWeight:300, color:'var(--black)' }}>{formatMoney(current.sales_amount)}</div>
            <div style={{ marginTop:5, fontSize:11, color:'var(--dark)' }}>{current.order_count} 筆有效訂單</div>
          </div>
        </div>
      </div>

      {recent.length > 1 && (
        <div style={{ borderTop:'1px solid var(--light)' }}>
          {recent.slice(1).map(quarter => (
            <div key={`${quarter.membership_id}-${quarter.quarter_number}`} style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr auto' : '150px 1fr auto', gap:12, padding:'13px 2px', borderBottom:'1px solid var(--light)', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'var(--black)' }}>{quarterTitle(quarter)}{quarter.is_partial ? '（身分變更）' : ''}</span>
              {!isMobile && <span style={{ fontSize:11, color:'var(--dark)' }}>{formatQuarterPeriod(quarter)}</span>}
              <span style={{ fontSize:13, color:'var(--black)', textAlign:'right' }}>{formatMoney(quarter.sales_amount)}</span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize:10, color:'var(--dark)', lineHeight:1.7, marginTop:10 }}>統計付款成功訂單的商品實付金額，不含運費；取消或退貨訂單不列入。</p>
    </section>
  );
}
