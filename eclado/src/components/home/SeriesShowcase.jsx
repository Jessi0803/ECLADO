import React, { useEffect, useState } from 'react';
import { goShopSeries } from '../../app/shopNavigation.js';
import ProductCard from '../product/ProductCard.jsx';

const HOME_SERIES = [
  { title:'記憶系列', english:'Memory Series', series:'Cell' },
  { title:'精粹系列', english:'Essential Series', series:'微囊精萃' },
  { title:'AC 系列', english:'AC Series', series:'AC' },
];

function SeriesProductRow({ item, products, user, onAdd, onSelect, isMobile, setPage, promotions }) {
  const [active, setActive] = useState(0);
  const visibleCount = isMobile ? 2 : 4;
  const slideStep = isMobile ? 2 : 1;
  const maxStart = Math.max(0, products.length - visibleCount);
  const slideStarts = [];
  for (let index = 0; index <= maxStart; index += slideStep) slideStarts.push(index);
  if (slideStarts[slideStarts.length - 1] !== maxStart) slideStarts.push(maxStart);

  useEffect(() => {
    setActive(current => Math.min(current, maxStart));
  }, [maxStart]);

  const start = Math.min(active, maxStart);
  const gap = isMobile ? 10 : 24;
  const itemWidth = `calc((100% - ${gap * (visibleCount - 1)}px) / ${visibleCount})`;
  const slideOffset = `calc(-${start} * (${itemWidth} + ${gap}px))`;
  const hasOverflow = products.length > visibleCount;

  function move(delta) {
    setActive(current => {
      if (!hasOverflow) return 0;
      const currentIndex = slideStarts.indexOf(current);
      const fallbackIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = fallbackIndex + delta;
      if (nextIndex < 0) return slideStarts[slideStarts.length - 1] || 0;
      if (nextIndex >= slideStarts.length) return 0;
      return slideStarts[nextIndex] || 0;
    });
  }

  return (
    <div className="home-series-block">
      <div className="home-series-header">
        <div>
          <p>{item.english}</p>
          <h2>{item.title}</h2>
        </div>
        {hasOverflow && (
          <div className="home-series-nav">
            <button type="button" aria-label={`上一組${item.title}商品`} onClick={() => move(-1)}>←</button>
            <button type="button" aria-label={`下一組${item.title}商品`} onClick={() => move(1)}>→</button>
          </div>
        )}
      </div>

      {products.length ? (
        <div className="home-series-viewport">
          <div className="home-series-track" style={{ gap, transform:`translateX(${slideOffset})` }}>
            {products.map(product => (
              <div key={product.id} className="home-series-item" style={{ flexBasis:itemWidth }}>
                <ProductCard
                  product={product}
                  user={user}
                  onAdd={() => onAdd(product)}
                  onSelect={() => onSelect(product)}
                  promotions={promotions}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="home-series-empty">系列商品準備中</div>
      )}

      <div className="home-series-footer">
        <button
          type="button"
          aria-label={`瀏覽${item.title}商品`}
          onClick={() => goShopSeries(item.series, setPage)}
        >
          瀏覽系列商品 →
        </button>
      </div>
    </div>
  );
}

export default function SeriesShowcase({ products, user, onAdd, onSelect, setPage, isMobile, promotions = [] }) {
  return (
    <section className="home-series-section">
      <div className="home-series-inner px-page">
        {HOME_SERIES.map(item => (
          <SeriesProductRow
            key={item.series}
            item={item}
            products={products.filter(product => product.series === item.series)}
            user={user}
            onAdd={onAdd}
            onSelect={onSelect}
            isMobile={isMobile}
            setPage={setPage}
            promotions={promotions}
          />
        ))}
      </div>
    </section>
  );
}
