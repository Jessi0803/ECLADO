import React, { useState } from 'react';

const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase();

export default function SearchableOrderProduct({ products, value, onChange, label, style, required = false, children }) {
  const [query, setQuery] = useState('');
  const keyword = normalize(query);
  const matches = products.filter(product => normalize([
    product.nameZh, product.name, product.nameEn, product.sku,
    ...(product.variants || []).map(variant => variant.sku),
  ].filter(Boolean).join(' ')).includes(keyword));
  // Keep the selected option mounted: searching must not silently clear a line.
  const selected = products.find(product => String(product.id) === String(value));
  const options = selected && !matches.includes(selected) ? [selected, ...matches] : matches;

  const selector = <select aria-label={label} required={required} value={value} style={style}
      onChange={event => { onChange(event.target.value); setQuery(''); }}>
      <option value="">{keyword ? '請選擇搜尋結果' : '請選擇商品'}</option>
      {options.map(product => <option key={product.id} value={product.id}>{product.nameZh || product.name}</option>)}
    </select>;
  return <div style={{ display: 'grid', gap: 10 }}>
    <input type="search" aria-label={`搜尋${label}`} placeholder="搜尋商品名稱／SKU" value={query}
      onChange={event => setQuery(event.target.value)} style={style} />
    {keyword && matches.length === 0 && <span role="status" style={{ color: 'var(--mid)', fontSize: 11 }}>找不到符合的商品，請換個關鍵字。</span>}
    {children ? children(selector) : selector}
  </div>;
}
