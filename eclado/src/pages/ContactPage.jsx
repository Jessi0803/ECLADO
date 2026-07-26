import React from 'react';
import useIsMobile from '../hooks/useIsMobile.js';

// ─── CONTACT PAGE ────────────────────────────────────────────────────────────
export default function ContactPage() {
  const isMobile = useIsMobile();
  const channels = [
    {
      name: '電子郵件',
      description: 'ecladotaiwan@gmail.com',
      action: '發送郵件 →',
      href: 'mailto:ecladotaiwan@gmail.com',
    },
    {
      name: 'LINE 官方帳號',
      description: '產品諮詢、訂單問題、售後服務。',
      action: '開啟 LINE →',
      href: 'https://lin.ee/5RLUjni',
    },
    {
      name: 'Instagram',
      description: '追蹤最新產品資訊、保養知識與品牌動態。',
      action: '前往 Instagram →',
      href: 'https://www.instagram.com/eclado_tw?igsh=MWt3OWl5OWd0dm1vMQ%3D%3D&utm_source=qr',
    },
  ];

  return (
    <div style={{ paddingTop:68, minHeight:'80vh' }}>
      <div style={{ background:'var(--off-white)', padding:isMobile ? '48px 20px 36px' : '64px 32px 48px', borderBottom:'1px solid var(--light)' }}>
        <div style={{ maxWidth:860, margin:'0 auto' }}>
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Contact</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 30 : 44, fontWeight:300, color:'var(--black)', marginBottom:12 }}>聯絡我們</h1>
          <p style={{ fontSize:14, color:'var(--dark)', lineHeight:1.8 }}>有任何問題、諮詢或合作需求，歡迎透過以下方式與我們聯繫。</p>
        </div>
      </div>
      <div style={{ maxWidth:860, margin:'0 auto', padding:isMobile ? '48px 20px 72px' : '64px 32px 96px' }}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(3, 1fr)', gap:24 }}>
          {channels.map(channel => {
            const external = channel.href.startsWith('http');
            return (
              <a
                key={channel.name}
                href={channel.href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                style={{ border:'1px solid var(--light)', padding:isMobile ? '32px 24px' : '40px 32px', textDecoration:'none', display:'flex', flexDirection:'column', gap:16, color:'inherit' }}
              >
                <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, color:'var(--black)' }}>{channel.name}</div>
                <div style={{ fontSize:13, color:'var(--dark)', lineHeight:1.8, flex:1 }}>{channel.description}</div>
                <div style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--dark)', textTransform:'uppercase' }}>{channel.action}</div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
