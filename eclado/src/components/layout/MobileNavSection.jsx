import React, { useState } from 'react';
import { goInfoSection } from '../../app/infoNavigation.js';
import { goShopFilter } from '../../app/shopNavigation.js';
import { goProfessionalApply } from '../../services/membership.js';

export default function MobileNavSection({ item, setPage, user, close }) {
  const [open, setOpen] = useState(false);
  const [productView, setProductView] = useState('category');

  function go(page) {
    setPage(page);
    close();
  }

  async function goMemberChild(child) {
    if (child === '美容師申請') await goProfessionalApply(user, setPage);
    else go(user ? 'account' : 'login');
  }

  return (
    <div style={{ borderBottom:'1px solid var(--light)' }}>
      <button onClick={() => item.children ? setOpen(value => !value) : go(
        item.label === '品牌故事' ? 'about'
        : item.label === '會員登錄' ? (user ? 'account' : 'login')
        : item.label === '所有產品' ? 'shop'
        : 'info'
      )} style={{ width:'100%', background:'none', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 0', fontSize:15, color:'var(--dark)', fontFamily:'var(--font-body)', letterSpacing:'0.04em' }}>
        {item.label}
        {item.children && <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transition:'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>}
      </button>
      {item.children && open && (
        <div style={{ paddingBottom:8 }}>
          {item.label === '所有產品' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'0 0 8px' }}>
                {item.children.map(group => (
                  <button key={group.view} type="button" aria-pressed={productView === group.view} onClick={() => setProductView(group.view)} style={{ border:'1px solid var(--light)', background:productView === group.view ? 'var(--black)' : 'var(--white)', color:productView === group.view ? 'var(--white)' : 'var(--dark)', padding:'10px 8px', fontSize:12, cursor:'pointer' }}>{group.label}</button>
                ))}
              </div>
              {item.children.find(group => group.view === productView)?.items.map(child => (
                <button key={child} onClick={() => { goShopFilter(productView, child, setPage); close(); }} style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, color:'var(--dark)', padding:'10px 16px', letterSpacing:'0.04em' }}>{child}</button>
              ))}
            </>
          )}
          {item.label !== '所有產品' && item.children.map(child => (
            <button key={child} onClick={async () => {
              if (item.label === '會員登錄') await goMemberChild(child);
              else if (item.label === '購物說明') {
                goInfoSection(child, setPage);
                close();
              }
            }} style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, color:'var(--dark)', padding:'10px 16px', letterSpacing:'0.04em' }}>
              {child}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
