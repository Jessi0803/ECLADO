import React, { useEffect, useState } from 'react';
import useIsMobile from '../hooks/useIsMobile.js';
import { PRODUCT_NAV_LINKS } from '../app/navigation.js';
import {
  SHOP_CATEGORY_EVENT,
  categoryFromLocation,
  shopPath,
} from '../app/shopNavigation.js';
import ProductCard from '../components/product/ProductCard.jsx';
import PromoSection from '../components/product/PromoSection.jsx';
import {
  PRODUCTS,
  getCartKey,
  getMemberTier,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import {
  isPromotionLive,
} from '../domain/promotions.js';

const PROFESSIONAL_CATEGORY = '院線課程儀器（含試用包）';

function isProfessionalCatalogProduct(product) {
  const category = String(product.category || '');
  return product.isProOnly || /院線|課程|儀器|試用包/.test(category);
}

function isProductInCategory(product, category) {
  if (category === '所有產品' || category === '全部') return true;

  const productCategory = String(product.category || '');
  const isProfessional = isProfessionalCatalogProduct(product);
  if (category === PROFESSIONAL_CATEGORY) return isProfessional;
  if (isProfessional) return false;

  if (category === '清潔卸妝') return /清潔|卸妝/.test(productCategory);
  if (category === '化妝水') return /化妝水/.test(productCategory);
  if (category === '安瓶精華') return /安瓶|精華/.test(productCategory);
  if (category === '乳霜') return /乳霜|面霜|眼霜/.test(productCategory);
  if (category === '面膜') return /面膜/.test(productCategory);
  if (category === '防曬底妝') return /防曬|底妝/.test(productCategory);
  if (category === '其他') return productCategory === '其他';
  return false;
}

export default function ShopPage({ user, cart, setCart, onSelectProduct, promotions = [], products = PRODUCTS }) {
  const [activeCategory, setActiveCategory] = useState(categoryFromLocation);
  const categories = PRODUCT_NAV_LINKS;
  const isMobile = useIsMobile();

  useEffect(() => {
    const syncCategory = event => setActiveCategory(event.detail || categoryFromLocation());
    const syncPopState = () => setActiveCategory(categoryFromLocation());
    window.addEventListener(SHOP_CATEGORY_EVENT, syncCategory);
    window.addEventListener('popstate', syncPopState);
    return () => {
      window.removeEventListener(SHOP_CATEGORY_EVENT, syncCategory);
      window.removeEventListener('popstate', syncPopState);
    };
  }, []);

  function selectCategory(category) {
    setActiveCategory(category);
    window.history.pushState({ page: 'shop', category }, '', shopPath(category));
  }

  function addToCart(product) {
    if (product.isProOnly && !isProfessionalMember(user)) return;
    setCart(prev => {
      const cartKey = getCartKey(product);
      const ex = prev.find(i => getCartKey(i) === cartKey);
      if (ex) return prev.map(i => getCartKey(i) === cartKey ? { ...i, qty: i.qty+1 } : i);
      return [...prev, { ...product, cartKey, qty:1 }];
    });
  }

  const filtered = products.filter(product => isProductInCategory(product, activeCategory));

  const livePromosShop = promotions.filter(isPromotionLive);

  return (
    <div style={{ paddingTop:68 }}>
      {livePromosShop.length > 0 && (
        <div style={{
          background:'var(--off-white)', borderBottom:'1px solid var(--light)',
          padding:'14px 20px', textAlign:'center',
        }}>
          <span style={{ fontSize:13, color:'var(--dark)', letterSpacing:'0.04em', lineHeight:1.6 }}>
            限時優惠進行中：購物車內含活動商品時會自動折抵。
          </span>
        </div>
      )}
      {/* 頂部 header */}
      <div style={{ position:'relative', height: isMobile ? 180 : 240, overflow:'hidden' }}>
        <img src={isMobile ? '/assets/images/shop-hero-cleansing.png' : '/assets/images/shop-hero-cleansing-wide.png'} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition: isMobile ? '70% 55%' : 'center center' }} />
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, rgba(12,12,10,0.86) 0%, rgba(12,12,10,0.66) 45%, rgba(12,12,10,0.30) 100%)' }} />
        <div style={{ position:'relative', height:'100%', maxWidth:1280, margin:'0 auto', padding: isMobile ? '0 24px' : '0 32px', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:12, paddingBottom: isMobile ? 28 : 36 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
              <div style={{ width:28, height:1, background:'var(--gold)' }} />
              <p style={{ fontSize:10, letterSpacing:'0.3em', color:'var(--gold)', textTransform:'uppercase', margin:0 }}>Shop</p>
            </div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 28 : 42, fontWeight:500, color:'var(--white)', lineHeight:1.1, margin:0 }}>全部商品</h1>
          </div>
          {isProfessionalMember(user) && (
            <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:4 }}>
              <span style={{ fontSize:10, background:'var(--gold)', color:'var(--black)', padding:'3px 8px', letterSpacing:'0.12em', fontWeight:600 }}>{getMemberTier(user).badge}</span>
              <span style={{ fontSize:12, color:'var(--dark)', letterSpacing:'0.04em' }}>{getMemberTier(user).priceLabel}已啟用</span>
            </div>
          )}
        </div>
      </div>
      {/* 分類篩選列 */}
      <div className="filter-tabs" style={{ background:'var(--off-white)', borderBottom:'1px solid var(--light)', padding: isMobile ? '0 16px' : '0 32px' }}>
        <div style={{ maxWidth:1280, margin:'0 auto', display:'flex', alignItems:'center' }}>
          <div style={{ display:'flex' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => selectCategory(cat)} style={{
              background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12,
              color: activeCategory===cat ? 'var(--black)' : 'var(--dark)',
              padding:'16px 20px', letterSpacing:'0.08em', textTransform:'uppercase',
              borderBottom: activeCategory===cat ? '2px solid var(--black)' : '2px solid transparent',
              fontWeight: activeCategory===cat ? 500 : 300, transition:'all 0.2s',
            }}>{cat}</button>
          ))}
          </div>
        </div>
      </div>
      <div style={{ maxWidth:1280, margin:'0 auto', padding: isMobile ? '40px 20px' : '60px 32px' }}>
        {false && null /* pro banner moved to header */}
        <div className="g4lg">
          {filtered.map(p => <ProductCard key={p.id} product={p} user={user} onAdd={() => addToCart(p)} onSelect={() => onSelectProduct(p)} promotions={promotions} />)}
        </div>
        {filtered.length === 0 && <div style={{ textAlign:'center', padding:'80px 0', color:'var(--dark)', fontSize:14 }}>此分類目前無商品</div>}
      </div>
    </div>
  );
}
