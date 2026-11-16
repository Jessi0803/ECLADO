import React, { useEffect, useState } from 'react';
import { canAccessProfessionalCatalog } from '../../domain/catalog.jsx';
import { normProductIds } from '../../domain/promotions.js';
import ProductCard from './ProductCard.jsx';
import ProductImage from './ProductImage.jsx';
import { fetchStorefrontPromotionGifts } from '../../services/promotions.js';
import './PromoSection.css';

export default function PromoSection({ livePromotions, user, addToCart, onSelect, promotions, products }) {
  const [giftDisplay, setGiftDisplay] = useState(null);
  const viewerKey = `${user?.uid ?? ''}:${user?.role ?? ''}`;
  const giftPromotionIds = livePromotions
    .filter(promo => ['amount_gift', 'quantity_gift'].includes(promo.benefit_type))
    .map(promo => promo.id)
    .join(',');

  useEffect(() => {
    if (!giftPromotionIds) return;
    let cancelled = false;
    fetchStorefrontPromotionGifts().then(gifts => {
      if (!cancelled) setGiftDisplay({ viewerKey, gifts });
    });
    return () => { cancelled = true; };
  }, [giftPromotionIds, promotions, viewerKey]);

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
            const gifts = giftDisplay?.viewerKey === viewerKey ? giftDisplay.gifts[promo.id] ?? [] : [];

            return (
              <article key={promo.id} className="home-promotions-group" aria-labelledby={titleId}>
                <header className="home-promotions-heading">
                  <h3 id={titleId}>{promo.name}</h3>
                  {promo.description && <p className="home-promotions-description">{promo.description}</p>}
                </header>
                {items.length || gifts.length ? (
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
                    {gifts.length > 0 && (
                      <div className="home-promotions-gifts" role="group" aria-label="贈品">
                        <span className="home-promotions-gift-label" aria-hidden="true">贈</span>
                        {gifts.map(gift => {
                          const product = gift.publication_status === 'active'
                            ? products.find(product => product.id === Number(gift.product_id))
                            : null;

                          return (
                            <div key={gift.variant_id} className="home-promotions-product">
                              {product ? (
                                <ProductCard
                                  product={product}
                                  user={user}
                                  onAdd={() => addToCart(product)}
                                  onSelect={() => onSelect(product)}
                                  promotions={promotions}
                                />
                              ) : (
                                <>
                                  <ProductImage
                                    src={gift.imageUrl}
                                    alt={gift.name}
                                    loading="lazy"
                                    style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', marginBottom: 14 }}
                                  />
                                  <div>
                                    <span className="home-promotions-gift-name">{[gift.name, gift.size].filter(Boolean).join(' · ')}</span>
                                    <div className="home-promotions-gift-quantity"><span>贈品 × {gift.quantity}</span></div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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
