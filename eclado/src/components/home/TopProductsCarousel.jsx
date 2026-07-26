import React, { useEffect, useState } from 'react';
import ProductCard from '../product/ProductCard.jsx';

export default function TopProductsCarousel({ products, user, onAdd, onSelect, isMobile, setPage, promotions = [] }) {
  const [active, setActive] = useState(0);
  const visibleCount = isMobile ? 2 : 4;
  const slideStep = isMobile ? 2 : 1;
  const intervalMs = isMobile ? 2000 : 5200;
  const maxStart = Math.max(0, products.length - visibleCount);
  const slideStarts = [];
  for (let index = 0; index <= maxStart; index += slideStep) slideStarts.push(index);
  if (slideStarts[slideStarts.length - 1] !== maxStart) slideStarts.push(maxStart);

  useEffect(() => {
    if (products.length <= visibleCount) return;
    const timer = setInterval(() => {
      setActive(current => {
        const currentIndex = slideStarts.indexOf(current);
        const nextIndex = currentIndex < 0 || currentIndex >= slideStarts.length - 1 ? 0 : currentIndex + 1;
        return slideStarts[nextIndex] || 0;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, maxStart, products.length, slideStarts.join('|'), visibleCount]);

  useEffect(() => {
    setActive(current => slideStarts.reduce((closest, item) => Math.abs(item - current) < Math.abs(closest - current) ? item : closest, slideStarts[0] || 0));
  }, [maxStart, slideStep]);

  const start = Math.min(active, maxStart);
  const gap = isMobile ? 10 : 24;
  const itemWidth = `calc((100% - ${gap * (visibleCount - 1)}px) / ${visibleCount})`;
  const slideOffset = `calc(-${start} * (${itemWidth} + ${gap}px))`;

  function move(delta) {
    setActive(current => {
      if (maxStart === 0) return 0;
      const currentIndex = slideStarts.indexOf(current);
      const fallbackIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = fallbackIndex + delta;
      if (nextIndex < 0) return slideStarts[slideStarts.length - 1] || 0;
      if (nextIndex >= slideStarts.length) return 0;
      return slideStarts[nextIndex] || 0;
    });
  }

  return (
    <section style={{ background:'var(--off-white)', padding: isMobile ? '60px 0' : '100px 0', borderBottom:'1px solid var(--light)' }}>
      <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
        <div style={{ display:'flex', justifyContent:'space-between', gap:24, alignItems:'flex-end', marginBottom: isMobile ? 28 : 42, flexWrap:'wrap' }}>
          <div style={{ maxWidth:680 }}>
            <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Popular</p>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.6vw,46px)', fontWeight:300, lineHeight:1.1, color:'var(--black)', marginBottom:14 }}>熱門商品</h2>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button aria-label="上一組熱門商品" onClick={() => move(-1)} style={{ width:44, height:44, border:'1px solid var(--light)', background:'var(--white)', color:'var(--black)', cursor:'pointer', fontSize:18 }}>←</button>
            <button aria-label="下一組熱門商品" onClick={() => move(1)} style={{ width:44, height:44, border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', cursor:'pointer', fontSize:18 }}>→</button>
          </div>
        </div>

        <div style={{ overflow:'hidden' }}>
          <div style={{ display:'flex', gap, transform:`translateX(${slideOffset})`, transition:'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)', willChange:'transform' }}>
            {products.map(product => (
              <div key={product.id} style={{ flex:`0 0 ${itemWidth}`, minWidth:0 }}>
                <ProductCard product={product} user={user} onAdd={() => onAdd(product)} onSelect={() => onSelect(product)} promotions={promotions} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop:24, display:'flex', justifyContent:'space-between', gap:18, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {slideStarts.map((slideStart, index) => (
              <button key={slideStart} aria-label={`查看第 ${index + 1} 組熱門商品`} onClick={() => setActive(slideStart)} style={{ width:slideStart === start ? 28 : 9, height:3, border:'none', background:slideStart === start ? 'var(--black)' : 'var(--light)', cursor:'pointer', padding:0, transition:'all 0.25s' }} />
            ))}
          </div>
          <button onClick={() => setPage('shop')} style={{ background:'none', border:'none', borderBottom:'1px solid var(--dark)', color:'var(--dark)', cursor:'pointer', fontSize:13, paddingBottom:3 }}>瀏覽全部商品 →</button>
        </div>
      </div>
    </section>
  );
}
