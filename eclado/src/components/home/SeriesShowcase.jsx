import React from 'react';
import { goShopSeries } from '../../app/shopNavigation.js';
import { getProductImage } from '../../domain/catalog.jsx';
import ProductAutoImage from '../product/ProductAutoImage.jsx';

const HOME_SERIES = [
  {
    title:'記憶系列', english:'Memory Series', series:'Cell', representativeName:'記憶多肽精華',
    description:['彈潤緊緻・撫紋抗老', '喚醒肌膚記憶力'], background:'/assets/images/series-memory-bg.jpg', tone:'#6b4527', maxProducts:2,
  },
  {
    title:'呼吸系列', english:'Breathing Series', series:'呼吸', representativeName:'呼吸安瓶',
    description:['深層補水・舒緩穩定', '讓肌膚自由呼吸'], background:'/assets/images/series-breathing-bg.jpg', tone:'#234f78', maxProducts:1,
  },
  {
    title:'AC 系列', english:'AC Series', series:'AC', representativeName:'積雪草泥膜',
    description:['調理平衡・淨化舒緩', '改善油痘困擾'], background:'/assets/images/series-ac-bg.jpg', tone:'#52623c', maxProducts:2,
  },
  {
    title:'精粹系列', english:'Essential Series', series:'微囊精萃', representativeName:'精萃爽膚水',
    description:['溫和修護・強化屏障', '打造肌膚健康基底'], background:'/assets/images/series-essential-bg.jpg', tone:'#6c5949', maxProducts:2,
  },
];

function selectSeriesProducts(products, representativeName, maxProducts) {
  const representative = products.find(product => product.nameZh === representativeName);
  if (!representative) return products.slice(0, maxProducts);
  if (maxProducts === 1) return [representative];
  const secondary = products.find(product => product !== representative);
  return secondary ? [secondary, representative] : [representative];
}

function productLayout(count, index) {
  if (count === 1) {
    return { left:'10%', bottom:'9%', width:'80%', height:'74%', zIndex:2 };
  }
  return index === 0
    ? { left:'-4%', bottom:'10%', width:'66%', height:'66%', zIndex:1 }
    : { right:'-5%', bottom:'7%', width:'70%', height:'75%', zIndex:2 };
}

export default function SeriesShowcase({ products, setPage }) {
  const cards = HOME_SERIES.map(item => {
    const seriesProducts = products.filter(product => product.series === item.series);
    return { ...item, products:selectSeriesProducts(seriesProducts, item.representativeName, item.maxProducts) };
  });

  return (
    <section className="home-series-section">
      <div className="home-series-inner px-page">
        <div className="home-series-heading">
          <p>Signature Series</p>
          <h2>四大系列</h2>
          <span>從肌膚需求出發，找到適合您的日常保養系列。</span>
        </div>

        <div className="home-series-grid">
          {cards.map(({ title, english, series, description, background, tone, products:seriesProducts }) => (
            <button
              key={series}
              type="button"
              className="home-series-card"
              aria-label={`探索${title}`}
              onClick={() => goShopSeries(series, setPage)}
              style={{ '--series-tone':tone }}
            >
              <img className="home-series-background" src={background} alt="" />
              <div className="home-series-copy">
                <span>{english}</span>
                <h3>{title}</h3>
                <p>{description[0]}<br />{description[1]}</p>
              </div>

              <div className="home-series-products" aria-hidden="true">
                {seriesProducts.length ? seriesProducts.map((product, index) => {
                  const layout = productLayout(seriesProducts.length, index);
                  return (
                    <div key={product.id || product.nameZh} className="home-series-product" style={layout}>
                      <ProductAutoImage
                        src={getProductImage(product, 900)}
                        alt=""
                        product={product}
                        mode="series"
                        style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
                      />
                    </div>
                  );
                }) : <span className="home-series-empty">系列商品準備中</span>}
              </div>

              <span className="home-series-discover">Discover Series <b aria-hidden="true">↗</b></span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
