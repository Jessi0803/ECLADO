import React, { useEffect, useState } from 'react';
import useAuth from '../hooks/useAuth.js';
import useProducts from '../hooks/useProducts.js';
import usePromotions from '../hooks/usePromotions.js';
import useSalesStats from '../hooks/useSalesStats.js';
import {
  LINE_LOGIN_PENDING_KEY,
  POST_LOGIN_PAGE_KEY,
} from './authSession.js';
import {
  PAGE_PATHS,
  getProductSlug,
  journalSlugFromPath,
  pageFromPath,
  productSlugFromPath,
} from './routes.js';
import Nav from '../components/layout/Nav.jsx';
import PromoDiagnosticBar from '../components/common/PromoDiagnosticBar.jsx';
import AboutPage from '../pages/AboutPage.jsx';
import AccountPage from '../pages/AccountPage.jsx';
import CartPage from '../pages/CartPage.jsx';
import CheckoutPage from '../pages/CheckoutPage.jsx';
import ContactPage from '../pages/ContactPage.jsx';
import HomePage from '../pages/HomePage.jsx';
import GuestOrderLookupPage from '../pages/GuestOrderLookupPage.jsx';
import InfoPage from '../pages/InfoPage.jsx';
import JournalArticlePage from '../pages/JournalArticlePage.jsx';
import JournalPage from '../pages/JournalPage.jsx';
import LineCallbackPage from '../pages/LineCallbackPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import PrivacyPage from '../pages/PrivacyPage.jsx';
import PaymentResultPage from '../pages/PaymentResultPage.jsx';
import ProductPage from '../pages/ProductPage.jsx';
import ProfessionalApplicationPage from '../pages/ProfessionalApplicationPage.jsx';
import ResetPasswordPage from '../pages/ResetPasswordPage.jsx';
import ShopPage from '../pages/ShopPage.jsx';
import {
  hasAuthCallbackInUrl,
  isPasswordRecoveryUrl,
} from '../services/auth.js';
import {
  CART_STORAGE_KEY,
  loadStoredCart,
  saveStoredCart,
} from '../services/cartStorage.js';
import { goProfessionalApply } from '../services/membership.js';

export default function App() {
  const [journalArticleSlug, setJournalArticleSlug] = useState(() => journalSlugFromPath(window.location.pathname));
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
    const state = newPage === 'order-lookup'
      ? { page: newPage, from: page }
      : { page: newPage };
    window.history.pushState(state, '', path);
    setPageState(newPage);
  }
  function openProduct(product, from = page) {
    const path = `/products/${getProductSlug(product.name)}`;
    window.history.pushState({ page:'product', from }, '', path);
    setPageState('product');
  }
  function closeProduct() {
    if (window.history.state?.from) {
      window.history.back();
      return;
    }
    setPage('shop');
  }
  function openJournalArticle(article, from = page) {
    window.history.pushState({ page:'journal-article', from }, '', `/journal/${article.slug}`);
    setJournalArticleSlug(article.slug);
    setPageState('journal-article');
  }
  const {
    authReady,
    handleSignOut,
    refreshUser,
    setShowProBanner,
    showProBanner,
    user,
  } = useAuth(setPageState);
  const [cart, setCart] = useState(loadStoredCart);
  const [cartOpen, setCartOpen] = useState(false);
  const {
    products,
    status: productsStatus,
    errorText: productsError,
  } = useProducts(user, setCart, authReady);
  const { promotions, status: promoFetchStatus, errorText: promoFetchError } = usePromotions();
  const salesStats = useSalesStats();
  const cartCount = cart.reduce((sum,i) => sum+i.qty, 0);

  useEffect(() => {
    saveStoredCart(cart);
  }, [cart]);

  useEffect(() => {
    if (!cartOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const closeOnEscape = event => { if (event.key === 'Escape') setCartOpen(false); };
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [cartOpen]);

  useEffect(() => {
    function syncCartAcrossTabs(event) {
      if (event.key === CART_STORAGE_KEY) setCart(loadStoredCart());
    }
    window.addEventListener('storage', syncCartAcrossTabs);
    return () => window.removeEventListener('storage', syncCartAcrossTabs);
  }, []);

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
      setJournalArticleSlug(journalSlugFromPath(window.location.pathname));
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
      case 'home':     return <HomePage setPage={setPage} onSelectProduct={product => openProduct(product, 'home')} onOpenArticle={article => openJournalArticle(article, 'home')} user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} salesStats={salesStats} />;
      case 'shop':     return <ShopPage onSelectProduct={product => openProduct(product, 'shop')} user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} productsStatus={productsStatus} productsError={productsError} salesStats={salesStats} />;
      case 'product':  return <ProductPage productSlug={productSlugFromPath(window.location.pathname)} products={products} productsStatus={productsStatus} productsError={productsError} user={user} setCart={setCart} promotions={promotions} onBack={closeProduct} onShop={() => setPage('shop')} />;
      case 'cart':     return <CartPage cart={cart} setCart={setCart} setPage={setPage} user={user} promotions={promotions} />;
      case 'checkout': return <CheckoutPage cart={cart} setCart={setCart} setPage={setPage} user={user} promotions={promotions} />;
      case 'login':    return <LoginPage setPage={setPage} />;
      case 'pro-login': return <LoginPage setPage={setPage} />;
      case 'reset-password': return <ResetPasswordPage setPage={setPage} />;
      case 'professional-apply': return <ProfessionalApplicationPage setPage={setPage} user={user} authReady={authReady} onUserUpdated={refreshUser} />;
      case 'account':  return <AccountPage user={user} setPage={setPage} onSignOut={handleSignOut} />;
      case 'about':    return <AboutPage />;
      case 'info':     return <InfoPage user={user} />;
      case 'journal':  return <JournalPage onOpenArticle={article => openJournalArticle(article, 'journal')} />;
      case 'journal-article': return <JournalArticlePage articleSlug={journalArticleSlug} onBack={() => setPage('journal')} onOpenArticle={article => openJournalArticle(article, 'journal-article')} />;
      case 'line-callback': return <LineCallbackPage />;
      case 'payment-result': return <PaymentResultPage setPage={setPage} />;
      case 'order-lookup': return <GuestOrderLookupPage setPage={setPage} />;
      case 'privacy':  return <PrivacyPage />;
      case 'contact':  return <ContactPage />;
      default:         return <HomePage setPage={setPage} onSelectProduct={product => openProduct(product, 'home')} onOpenArticle={article => openJournalArticle(article, 'home')} user={user} cart={cart} setCart={setCart} promotions={promotions} products={products} salesStats={salesStats} />;
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
      {!authPage && <Nav setPage={setPage} onOpenCart={() => setCartOpen(true)} cartCount={cartCount} user={user} setUser={handleSignOut} page={page} />}
      {showPromoBar && (
        <PromoDiagnosticBar status={promoFetchStatus} errorText={promoFetchError} />
      )}
      {showProBanner && !authPage && !cartOpen && (
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
      {cartOpen && !authPage && page !== 'cart' && (
        <>
          <button type="button" className="cart-drawer-backdrop" aria-label="關閉購物車" onClick={() => setCartOpen(false)} />
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="購物車">
            <CartPage
              cart={cart}
              setCart={setCart}
              setPage={nextPage => { setCartOpen(false); setPage(nextPage); }}
              user={user}
              promotions={promotions}
              drawer
              onClose={() => setCartOpen(false)}
            />
          </aside>
        </>
      )}
    </>
  );
}
