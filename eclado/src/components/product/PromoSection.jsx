import React from 'react';
import { canAccessProfessionalCatalog } from '../../domain/catalog.jsx';
import { normProductIds } from '../../domain/promotions.js';
import ProductCard from './ProductCard.jsx';
import './PromoSection.css';

export default function PromoSection({ livePromotions, user, addToCart, onSelect, promotions, products }) {
  if (!livePromotions.length) return null;

  const canViewProfessionalProducts = canAccessProfessionalCatalog(user);

  return (
    <section className="home-promotions" aria-labelledby="home-promotions-title">
      <div className="home-promotions-inner px-page">
        <h2 id="home-promotions-title">
          限時優惠 <span className="home-promotions-count" aria-label={`${livePromotions.length} 個現行活動`}>{livePromotions.length}</span>
        </h2>
        <div className="home-promotions-track" role="group" aria-label="優惠活動與商品" tabIndex={0}>
          {livePromotions.map(promo => {
            const items = normProductIds(promo)
              .map(id => products.find(product => product.id === id))
              .filter(product => product && (!product.isProOnly || canViewProfessionalProducts));
            const titleId = `home-promotion-${promo.id}`;

            return (
              <article key={promo.id} className="home-promotions-group" aria-labelledby={titleId}>
                <header className="home-promotions-heading">
                  <h3 id={titleId}>{promo.name}</h3>
                  {promo.description && <p className="home-promotions-description">{promo.description}</p>}
                </header>
                {items.length ? (
                  <div className="home-promotions-products">
                    {items.map(product => (
                      <div key={product.id} className="home-promotions-product">
                        <ProductCard
                          product={product}
                          user={user}
                          onAdd={() => addToCart(product)}
                          onSelect={() => onSelect(product)}
                          promotions={promotions}
                        />
                      </div>
                    ))}
                  </div>
                ) : <p className="home-promotions-description">目前沒有可顯示的活動商品。</p>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
