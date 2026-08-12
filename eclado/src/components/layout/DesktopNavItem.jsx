import React, { useEffect, useRef, useState } from 'react';
import { goInfoSection } from '../../app/infoNavigation.js';
import { goShopCategory } from '../../app/shopNavigation.js';
import { goProfessionalApply } from '../../services/membership.js';

export default function DesktopNavItem({ item, scrolled, setPage, user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleOutsideClick = event => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  async function go(child) {
    setOpen(false);
    if (item.label === '所有產品') goShopCategory(child, setPage);
    else if (item.label === '會員登錄') {
      if (child === '美容師申請') await goProfessionalApply(user, setPage);
      else setPage(user ? 'account' : 'login');
    } else if (item.label === '品牌故事') setPage('about');
    else if (item.label === '購物說明') goInfoSection(child || '退換貨說明', setPage);
  }

  const color = scrolled ? 'var(--dark)' : 'rgba(255,255,255,0.88)';
  return (
    <div ref={ref} style={{ position:'relative' }} onMouseEnter={() => item.children && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button onClick={() => item.label === '所有產品' ? go('所有產品') : item.children ? setOpen(value => !value) : go()} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, fontWeight:400, letterSpacing:'0.06em', color, padding:'8px 18px', display:'flex', alignItems:'center', gap:5, height:68, whiteSpace:'nowrap', transition:'color 0.3s' }}>
        {item.label}
        {item.children && (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transition:'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      {item.children && open && (
        <div style={{ position:'absolute', top:'100%', left:'50%', transform:'translateX(-50%)', background:'rgba(250,250,249,0.98)', backdropFilter:'blur(16px)', border:'1px solid var(--light)', minWidth:160, boxShadow:'0 8px 32px rgba(0,0,0,0.08)', zIndex:200, padding:'8px 0', animation:'fadeInDown 0.18s ease' }}>
          {item.children.map(child => (
            <button
              key={child}
              onClick={() => go(child)}
              style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, color:'var(--dark)', padding:'11px 22px', letterSpacing:'0.04em', transition:'background 0.15s' }}
              onMouseEnter={event => { event.target.style.background='var(--off-white)'; event.target.style.color='var(--black)'; }}
              onMouseLeave={event => { event.target.style.background='none'; event.target.style.color='var(--dark)'; }}
            >
              {child}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
