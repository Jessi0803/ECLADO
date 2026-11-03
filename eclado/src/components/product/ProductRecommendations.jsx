import React, { useEffect, useRef, useState } from 'react';
import { applyVariantToProduct, getCartKey, getFulfillmentInfo, getMemberPrice, getProductImage, getProductVariants } from '../../domain/catalog.jsx';
import { getProductRecommendations } from '../../domain/productRecommendations.js';
import ProductCard from './ProductCard.jsx';
import ProductImage from './ProductImage.jsx';
import './ProductRecommendations.css';

function CheckoutRecommendation({ product, label, cart, user, onAdd, disabled }) {
  const [variantId, setVariantId] = useState('');
  const [added, setAdded] = useState(false);
  const feedbackTimer = useRef(null);
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);
  const variants = getProductVariants(product).filter(variant => variant.active);
  const variant = variants.find(variant => String(variant.id) === variantId)
    || variants.find(variant => variant.isDefault) || variants[0];
  const selected = applyVariantToProduct(product, variant);
  const quantity = cart.find(item => getCartKey(item) === getCartKey(selected))?.qty || 0;
  return (
    <article className="recommendation-row" aria-label={product.nameZh}>
      <div className="recommendation-row-image">
        <ProductImage src={getProductImage(product, 150)} alt={product.nameZh} fallbackText="暫無圖片" fallbackStyle={{ padding:2, fontSize:9 }} style={{ width:'100%', height:'100%', objectFit:'contain' }} />
      </div>
      <div className="recommendation-row-info">
        <p className="recommendation-label">{label}</p>
        <p className="recommendation-row-name" title={product.nameZh}>{product.nameZh}</p>
        <div className="recommendation-row-details">
          {variants.length > 1 ? (
            <select aria-label={`${product.nameZh}容量規格`} value={String(variant.id)} disabled={disabled} onChange={event => setVariantId(event.target.value)}>
              {variants.map(option => <option key={option.id} value={String(option.id)}>{option.size}</option>)}
            </select>
          ) : <span>{selected.size}</span>}
          <span>NT$ {getMemberPrice(selected, user).toLocaleString()}</span>
        </div>
      </div>
      <button type="button" className={`recommendation-add${added ? ' recommendation-add--added' : ''}`}
        disabled={disabled || quantity >= 99 || getFulfillmentInfo(selected).type === 'loading'}
        title={added ? '已加入訂單明細' : '加入購物車'}
        onClick={() => {
          onAdd(selected);
          setAdded(true);
          clearTimeout(feedbackTimer.current);
          feedbackTimer.current = setTimeout(() => setAdded(false), 1500);
        }} aria-label={`加購${product.nameZh}`}>
        <span key={added ? `added-${quantity}` : 'plus'} className="recommendation-add-symbol" aria-hidden="true">
          {added ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg> : '＋'}
        </span>
      </button>
    </article>
  );
}

export default function ProductRecommendations({ sources, products, cart = [], user, onAdd, onSelect, promotions = [], compact = false, disabled = false }) {
  const groups = getProductRecommendations({ sources, products, user });
  const recommendations = groups.flatMap(group => group.options.map(product => ({ product, label:group.label })));
  if (!recommendations.length) return null;
  return (
    <section aria-label="搭配選購" className={`product-recommendations${compact ? ' product-recommendations--compact' : ''}`}>
      <h2>搭配選購</h2>
      {compact ? (
        <div className="recommendation-list" tabIndex={0} role="region" aria-label="推薦商品列表">
          {recommendations.map(({ product, label }) => <CheckoutRecommendation key={product.id} product={product} label={label} cart={cart} user={user} onAdd={onAdd} disabled={disabled} />)}
        </div>
      ) : (
        <div className="recommendation-grid">
          {recommendations.map(({ product, label }) => {
            const variants = getProductVariants(product).filter(variant => variant.active);
            const selected = applyVariantToProduct(product, variants.find(variant => variant.isDefault) || variants[0]);
            return <div key={product.id}>
              <p className="recommendation-label">{label}</p>
              <ProductCard product={selected} user={user} promotions={promotions} onAdd={() => onAdd(selected)} onSelect={() => onSelect(product)} />
            </div>;
          })}
        </div>
      )}
    </section>
  );
}
