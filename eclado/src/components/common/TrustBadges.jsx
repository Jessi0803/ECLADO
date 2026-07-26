import React from 'react';

const TRUST_BADGES = ['韓國原廠直送','皮膚科醫師驗證','專業美容師御用'];

export default function TrustBadges({ isMobile = false, compact = false }) {
  return (
    <div style={{
      maxWidth:1280,
      margin:'0 auto',
      padding: compact ? 0 : '0 24px',
      display:'grid',
      gridTemplateColumns: isMobile ? 'repeat(3, max-content)' : 'repeat(4, max-content)',
      justifyContent:'center',
      gap: isMobile ? 10 : 56,
      alignItems:'center'
    }}>
      {TRUST_BADGES.map(item => (
        <div key={item} style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
          <div style={{ width:4, height:4, background:'var(--gold)', borderRadius:'50%', flexShrink:0 }} />
          <span style={{ fontSize: isMobile ? 11 : 11, letterSpacing: isMobile ? '0.02em' : '0.08em', color: compact ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.5)', whiteSpace:'nowrap' }}>{item}</span>
        </div>
      ))}
    </div>
  );
}
