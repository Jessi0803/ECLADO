import React, { useEffect, useState } from 'react';
import useAuth from '../hooks/useAuth.js';
import useProducts from '../hooks/useProducts.js';
import usePromotions from '../hooks/usePromotions.js';
import useSalesStats from '../hooks/useSalesStats.js';
import {
  LINE_LOGIN_PENDING_KEY,
  POST_LOGIN_PAGE_KEY,
} from './authSession.js';
import { PAGE_PATHS, pageFromPath } from './routes.js';
import Nav from '../components/layout/Nav.jsx';
import PromoDiagnosticBar from '../components/common/PromoDiagnosticBar.jsx';
import AboutPage from '../pages/AboutPage.jsx';
import AccountPage from '../pages/AccountPage.jsx';
import CartPage from '../pages/CartPage.jsx';
import CheckoutPage from '../pages/CheckoutPage.jsx';
import ContactPage from '../pages/ContactPage.jsx';
import HomePage from '../pages/HomePage.jsx';
import InfoPage from '../pages/InfoPage.jsx';
import LineCallbackPage from '../pages/LineCallbackPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import PrivacyPage from '../pages/PrivacyPage.jsx';
import ProfessionalApplicationPage from '../pages/ProfessionalApplicationPage.jsx';
import ResetPasswordPage from '../pages/ResetPasswordPage.jsx';
import ShopPage from '../pages/ShopPage.jsx';
import {
  hasAuthCallbackInUrl,
  isPasswordRecoveryUrl,
} from '../services/auth.js';
import { goProfessionalApply } from '../services/membership.js';

export default function App() {
  const [page, setPageState] = useState(() => {
    if (isPasswordRecoveryUrl()) return 'reset-password';
    if (hasAuthCallbackInUrl() && !isPasswordRecoveryUrl()) {
      return window.location.pathname === '/line-callback' || sessionStorage.getItem(LINE_LOGIN_PENDING_KEY) === '1'
        ? 'line-callback'
        : 'login';
    }
    return pageFromPath(window.location.pathname);
  });

  function setPage(newPage) {
    const path = PAGE_PATHS[newPage] || '/';
    window.history.pushState({ page: newPage }, '', path);
    setPageState(newPage);
  }
  const {
    authReady,
    handleSignOut,
    refreshUser,
    setShowProBanner,
    showProBanner,
    user,
  } = useAuth(setPageState);
  const [cart, setCart] = useState([]);
  const products = useProducts(user, setCart);
  const { promotions, status: promoFetchStatus, errorText: promoFetchError } = usePromotions();
  const salesStats = useSalesStats();
  const cartCount = cart.reduce((sum,i) => sum+i.qty, 0);

  // 登入後導向美容師申請（從導覽「美容師申請」未登入時進入）
  useEffect(() => {
    if (!user?.uid) return;
    if (sessionStorage.getItem(POST_LOGIN_PAGE_KEY) !== 'professional-apply') return;
    let cancelled = false;
    (async () => {
      sessionStorage.removeItem(POST_LOGIN_PAGE_KEY);
      if (!cancelled) await goProfessionalApply(user, setPage);
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // 瀏覽器返回 / 前進
  useEffect(() => {
    function onPopState(e) {
      setPageState(e.state?.page || pageFromPath(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    if (!window.history.state?.page && !hasAuthCallbackInUrl()) {
      const p = pageFromPath(window.location.pathname);
      window.history.replaceState({ page: p }, '', window.location.pathname || '/');
    }
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 網址列 #eclado-promotions 時捲到活動區
  useEffect(() => {
    if (window.location.hash !== '#eclado-promotions') return;
    const t = setTimeout(() => {
      document.getElementById('eclado-promotions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => clearTimeout(t);
  }, [promotions]);

  function renderPage() {
    switch (page) {
      case 'home':     return <HomePage setPage={setPage} user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} salesStats={salesStats} />;
      case 'shop':     return <ShopPage user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} salesStats={salesStats} />;
      case 'cart':     return <CartPage cart={cart} setCart={setCart} setPage={setPage} user={user} promotions={promotions} />;
      case 'checkout': return <CheckoutPage cart={cart} setCart={setCart} setPage={setPage} user={user} promotions={promotions} />;
      case 'login':    return <LoginPage setPage={setPage} />;
      case 'pro-login': return <LoginPage setPage={setPage} />;
      case 'reset-password': return <ResetPasswordPage setPage={setPage} />;
      case 'professional-apply': return <ProfessionalApplicationPage setPage={setPage} user={user} authReady={authReady} onUserUpdated={refreshUser} />;
      case 'account':  return <AccountPage user={user} setPage={setPage} onSignOut={handleSignOut} />;
      case 'about':    return <AboutPage />;
      case 'info':     return <InfoPage user={user} />;
      case 'line-callback': return <LineCallbackPage />;
      case 'privacy':  return <PrivacyPage />;
      case 'contact':  return <ContactPage />;
      default:         return <HomePage setPage={setPage} user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} salesStats={salesStats} />;
    }
  }

  const authPage = page === 'login' || page === 'pro-login' || page === 'reset-password' || page === 'line-callback';
  const showPromoBar = !authPage;

  function dismissProBanner() {
    const seenKey = user?.uid ? `eclado_pro_banner_${user.uid}` : null;
    if (seenKey) localStorage.setItem(seenKey, '1');
    setShowProBanner(false);
  }

  return (
    <>
      {!authPage && <Nav setPage={setPage} cartCount={cartCount} user={user} setUser={handleSignOut} page={page} />}
      {showPromoBar && (
        <PromoDiagnosticBar status={promoFetchStatus} errorText={promoFetchError} />
      )}
      {showProBanner && !authPage && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:200, background:'var(--black)', color:'var(--white)', padding:'16px 20px', display:'flex', alignItems:'center', gap:16, boxShadow:'0 4px 24px rgba(0,0,0,0.25)', maxWidth:'calc(100vw - 32px)', width:440 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--gold)', textTransform:'uppercase', marginBottom:4 }}>美容師專業會員</div>
            <div style={{ fontSize:13, lineHeight:1.6 }}>您是美容師嗎？申請專業會員享有院線商品與專業折扣。</div>
          </div>
          <button onClick={() => { dismissProBanner(); goProfessionalApply(user, setPage); }} style={{ background:'var(--gold)', color:'var(--black)', border:'none', padding:'9px 16px', fontSize:11, letterSpacing:'0.1em', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500, whiteSpace:'nowrap' }}>立即申請</button>
          <button onClick={dismissProBanner} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', fontSize:20, cursor:'pointer', lineHeight:1, padding:'0 4px', flexShrink:0 }}>×</button>
        </div>
      )}
      {renderPage()}
    </>
  );
}
