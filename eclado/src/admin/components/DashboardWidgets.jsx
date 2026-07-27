import React from 'react';

export function StatCard({ label, value, sub, accent, icon, onClick }) {
  return (
    <div onClick={onClick} style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'24px 28px', cursor:onClick ? 'pointer' : 'default', transition:onClick ? 'box-shadow 0.15s' : undefined }} onMouseEnter={onClick ? event => { event.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)'; } : undefined} onMouseLeave={onClick ? event => { event.currentTarget.style.boxShadow='none'; } : undefined}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
        <span style={{ fontSize:11, letterSpacing:'0.1em', color:'var(--mid)', textTransform:'uppercase' }}>{label}</span>
        <span style={{ fontSize:18, opacity:0.4 }}>{icon}</span>
      </div>
      <div style={{ fontFamily:'var(--font-d)', fontSize:32, fontWeight:400, color:accent || 'var(--dark)', lineHeight:1, marginBottom:8 }}>{value}</div>
      <div style={{ fontSize:12, color:'var(--mid)' }}>{sub}</div>
    </div>
  );
}

export function MiniBarChart({ data, color = 'var(--dark)', height = 80 }) {
  const max = Math.max(...data.map(item => item.revenue));
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:6, height }}>
      {data.map((item, index) => (
        <div key={index} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
          <div style={{ width:'100%', background:index === data.length - 1 ? color : color + '40', borderRadius:2, height:Math.max(4, (item.revenue / max) * (height - 20)), transition:'height 0.5s ease' }} />
          <span style={{ fontSize:9, color:'var(--mid)', letterSpacing:'0.04em' }}>{item.month}</span>
        </div>
      ))}
    </div>
  );
}
