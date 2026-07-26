import React, { useEffect, useState } from 'react';
import { NAV_ITEMS } from '../../app/navigation.js';
import useIsMobile from '../../hooks/useIsMobile.js';
import {
  getMemberTier,
  isProfessionalMember,
} from '../../domain/catalog.jsx';
import {
  isAdminUser,
  openAdmin,
} from '../../services/membership.js';
import DesktopNavItem from './DesktopNavItem.jsx';
import MobileNavSection from './MobileNavSection.jsx';

// ─── NAV ─────────────────────────────────────────────────────────────────────
export default function Nav({ setPage, cartCount, user, setUser, page }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [productDetailOpen, setProductDetailOpen] = useState(false);
  const isMobile = useIsMobile();
  const darkMode = scrolled || page !== 'home' || productDetailOpen;

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h);
    return () => window.removeEventListener('scroll', h);
  }, []);

  // ProductDetail 開關時同步深色模式
  useEffect(() => {
    const sync = () => setProductDetailOpen(!!window.__productDetailOpen);
    sync();
    window.addEventListener('product-detail-toggle', sync);
    return () => window.removeEventListener('product-detail-toggle', sync);
  }, []);

  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  const iconCol = darkMode ? 'var(--black)' : 'rgba(255,255,255,0.88)';

  return (
    <>
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:100,
        background: drawerOpen || darkMode ? 'var(--white)' : 'transparent',
        backdropFilter: 'none',
        borderBottom: darkMode || drawerOpen ? '1px solid var(--light)' : '1px solid rgba(255,255,255,0.1)',
        transition:'background 0.4s, border-color 0.4s',
      }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px', height:68, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          {/* Logo */}
          <div onClick={() => { setPage('home'); setDrawerOpen(false); }} style={{ cursor:'pointer', display:'flex', flexDirection:'column', gap:1, flexShrink:0 }}>
            <span style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:400, letterSpacing:'0.22em', color: darkMode || drawerOpen ? 'var(--black)' : 'var(--white)' }}>ECLADO</span>
            <span style={{ fontSize:9, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase' }}>Korean Cosmeceuticals</span>
          </div>

          {/* Desktop nav */}
          <div className="nav-desktop">
            {NAV_ITEMS.map(item => <DesktopNavItem key={item.label} item={item} scrolled={darkMode} setPage={setPage} user={user} />)}
          </div>

          {/* Desktop right */}
          <div className="nav-right">
            {user ? (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                {isProfessionalMember(user) && <span style={{ fontSize:10, letterSpacing:'0.1em', background: darkMode ? 'var(--black)' : 'rgba(255,255,255,0.15)', color:'var(--white)', padding:'3px 8px', fontWeight:500 }}>{getMemberTier(user).badge}</span>}
                {isAdminUser(user) && <button onClick={openAdmin} style={{ background: darkMode ? 'var(--black)' : 'rgba(255,255,255,0.16)', color:'var(--white)', border:'1px solid rgba(255,255,255,0.22)', padding:'5px 10px', fontSize:11, letterSpacing:'0.1em', cursor:'pointer', fontFamily:'var(--font-body)' }}>後台</button>}
                <button onClick={() => setPage('account')} aria-label="會員專區" style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:iconCol, fontFamily:'var(--font-body)', display:'inline-flex', alignItems:'center', gap:6, padding:'4px 0' }}>
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>
                  <span>{user.name}</span>
                </button>
              </div>
            ) : null}
            <button onClick={() => setPage('cart')} aria-label="購物車" style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:iconCol, fontFamily:'var(--font-body)', letterSpacing:'0.04em', position:'relative', padding:'4px 0', whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:6 }}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h8.86a2 2 0 0 0 1.95-1.57L21 7H5.12" /></svg>
              {cartCount > 0 && <span style={{ position:'absolute', top:-4, right:-14, background:'var(--black)', color:'var(--white)', fontSize:9, width:16, height:16, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>{cartCount}</span>}
            </button>
          </div>

          {/* Mobile hamburger row */}
          <div className="nav-hamburger">
            {user && (
              <button onClick={() => setPage('account')} aria-label="會員專區" style={{ maxWidth:108, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', background:'none', border:'none', cursor:'pointer', fontSize:12, color: drawerOpen ? 'var(--dark)' : iconCol, fontFamily:'var(--font-body)', padding:'4px 0', display:'inline-flex', alignItems:'center', gap:5 }}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.name}</span>
              </button>
            )}
            <button onClick={() => setPage('cart')} aria-label="購物車" style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color: drawerOpen ? 'var(--dark)' : iconCol, fontFamily:'var(--font-body)', position:'relative', padding:'4px 0', display:'inline-flex', alignItems:'center', gap:6 }}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h8.86a2 2 0 0 0 1.95-1.57L21 7H5.12" /></svg>
              {cartCount > 0 && <span style={{ position:'absolute', top:-4, right:-14, background:'var(--black)', color:'var(--white)', fontSize:9, width:16, height:16, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>{cartCount}</span>}
            </button>
            <button onClick={() => setDrawerOpen(o => !o)} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', gap:5, padding:4 }}>
              {drawerOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4l12 12M16 4L4 16" stroke={drawerOpen ? 'var(--dark)' : iconCol} strokeWidth="1.5" strokeLinecap="round"/></svg>
              ) : (
                <>
                  <span style={{ display:'block', width:22, height:1.5, background: darkMode ? 'var(--dark)' : 'var(--white)' }}/>
                  <span style={{ display:'block', width:16, height:1.5, background: darkMode ? 'var(--dark)' : 'var(--white)' }}/>
                  <span style={{ display:'block', width:22, height:1.5, background: darkMode ? 'var(--dark)' : 'var(--white)' }}/>
                </>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="mobile-drawer">
          {NAV_ITEMS.map(item => (
            <MobileNavSection key={item.label} item={item} setPage={setPage} user={user} close={() => setDrawerOpen(false)} />
          ))}
          <div style={{ borderTop:'1px solid var(--light)', paddingTop:24, marginTop:8, display:'flex', flexDirection:'column', gap:16 }}>
            {user ? (
              <>
                <button onClick={() => { setPage('account'); setDrawerOpen(false); }} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'var(--dark)', textAlign:'left', padding:0, fontFamily:'var(--font-body)' }}>{isProfessionalMember(user) && <span style={{ fontSize:10, background:'var(--black)', color:'var(--white)', padding:'2px 7px', marginRight:8 }}>{getMemberTier(user).badge}</span>}{user.name}</button>
                {isAdminUser(user) && <button onClick={openAdmin} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--dark)', textAlign:'left', padding:0, fontFamily:'var(--font-body)', letterSpacing:'0.08em' }}>進入後台</button>}
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
