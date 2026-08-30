import React from 'react';
import { goShopSeries } from '../../app/shopNavigation.js';
import { getProductImage } from '../../domain/catalog.jsx';
import ProductAutoImage from '../product/ProductAutoImage.jsx';

const HOME_SERIES = [
  { title: '記憶系列', series: 'Cell', representativeName: '記憶多肽精華' },
  { title: '呼吸系列', series: '呼吸', representativeName: '呼吸安瓶' },
  { title: 'AC 系列', series: 'AC', representativeName: '積雪草泥膜' },
  { title: '精粹系列', series: '微囊精萃', representativeName: '精萃爽膚水' },
];

const STACK_LAYOUTS = {
  3: [
    { left:'4%', bottom:'9%', width:'39%', height:'72%', zIndex:1, rotate:-4 },
    { right:'4%', bottom:'9%', width:'39%', height:'72%', zIndex:1, rotate:4 },
    { left:'29%', bottom:'1%', width:'42%', height:'88%', zIndex:3, rotate:0 },
  ],
  4: [
    { left:'-1%', bottom:'12%', width:'34%', height:'68%', zIndex:1, rotate:-5 },
    { right:'-1%', bottom:'12%', width:'34%', height:'68%', zIndex:1, rotate:5 },
    { left:'19%', bottom:'2%', width:'37%', height:'85%', zIndex:3, rotate:-1 },
    { right:'19%', bottom:'3%', width:'37%', height:'82%', zIndex:2, rotate:1 },
  ],
};

function arrangeSeriesProducts(products, representativeName) {
  const representative = products.find(product => product.nameZh === representativeName);
  if (!representative) return products;
  const others = products.filter(product => product !== representative);
  if (products.length === 3) return [...others, representative];
  if (products.length === 4) return [others[0], others[1], representative, others[2]];
  return [...others, representative];
}

function stackLayout(count, index) {
  if (STACK_LAYOUTS[count]) return STACK_LAYOUTS[count][index];
  const width = Math.max(24, Math.min(40, 90 / count));
  const spread = count > 1 ? (88 - width) / (count - 1) : 0;
  return {
    left:`${6 + spread * index}%`,
    bottom:`${index % 2 === 0 ? 4 : 12}%`,
    width:`${width}%`,
    height:`${index % 2 === 0 ? 82 : 70}%`,
    zIndex:index % 2 === 0 ? 2 : 1,
    rotate:index % 2 === 0 ? -2 : 2,
  };
}

export default function SeriesShowcase({ products, setPage, isMobile }) {
  const cards = HOME_SERIES.map(item => {
    const seriesProducts = products.filter(product => product.series === item.series);
    return { ...item, products: arrangeSeriesProducts(seriesProducts, item.representativeName) };
  });

  return (
    <section style={{ background:'var(--off-white)', padding: isMobile ? '52px 0 60px' : '78px 0 88px', borderTop:'1px solid var(--light)' }}>
      <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px' }} className="px-page">
        <div style={{ marginBottom: isMobile ? 24 : 34 }}>
          <p style={{ fontSize:11, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:12 }}>Signature Series</p>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(24px,3.1vw,40px)', fontWeight:300, lineHeight:1.1, color:'var(--black)', marginBottom:12 }}>四大系列</h2>
          <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.8, letterSpacing:'0.04em' }}>從肌膚需求出發，找到適合您的日常保養系列。</p>
        </div>

        <div className="home-series-grid">
          {cards.map(({ title, series, products: seriesProducts }) => (
            <button
              key={series}
              type="button"
              onClick={() => goShopSeries(series, setPage)}
              style={{ border:'1px solid rgba(0,0,0,0.1)', background:'var(--white)', padding:0, textAlign:'left', cursor:'pointer', color:'inherit', fontFamily:'var(--font-body)', overflow:'hidden', transition:'border-color 0.25s ease, transform 0.25s ease' }}
              onMouseEnter={event => { event.currentTarget.style.borderColor = 'var(--dark)'; }}
              onMouseLeave={event => { event.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)'; }}
            >
              <div style={{ position:'relative', aspectRatio:'4 / 3', background:'radial-gradient(circle at 50% 76%, #fff 0%, #f5f3ee 62%, #ece8df 100%)', overflow:'hidden' }}>
                {seriesProducts.length ? (
                  seriesProducts.map((product, index) => {
                    const layout = stackLayout(seriesProducts.length, index);
                    return (
                      <div
                        key={product.id || product.nameZh}
                        style={{ position:'absolute', left:layout.left, right:layout.right, bottom:layout.bottom, width:layout.width, height:layout.height, zIndex:layout.zIndex, transform:`rotate(${layout.rotate}deg)`, filter:'drop-shadow(0 10px 8px rgba(45,38,27,0.13))' }}
                      >
                        <ProductAutoImage
                          src={getProductImage(product, 700)}
                          alt={`${title}商品：${product.nameZh}`}
                          product={product}
                          mode="list"
                          style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center', color:'var(--mid)', fontSize:12 }}>系列商品準備中</div>
                )}
              </div>
              <div style={{ padding: isMobile ? '12px 13px 13px' : '15px 18px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                <span style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 12 : 15, fontWeight:300, letterSpacing:'0.12em' }}>{title}</span>
                <span aria-hidden="true" style={{ display:'inline-flex', alignItems:'center', gap:7, color:'var(--dark)', fontSize:9, letterSpacing:'0.16em', whiteSpace:'nowrap' }}>
                  <span className="home-series-view-label">VIEW</span><span style={{ fontSize:11, color:'var(--gold)', lineHeight:1 }}>↗</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
