import React, { useState } from 'react';
import { normalizeProductImageScale } from '../domain/mappers.js';

const PRODUCT_CATEGORIES = ['清潔卸妝', '化妝水', '安瓶精華', '乳霜', '面膜', '防曬底妝', '其他', '院線課程儀器（含試用包）'];
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

export default function Catalog({ products, setProducts, onSaveProduct, onArchiveProduct, onRestoreProduct }) {
  const [editing, setEditing] = useState(null); // product being edited (draft copy)
  const [listMode, setListMode] = useState('active');
  const [stockFilter, setStockFilter] = useState('all');
  const [bulkListScale, setBulkListScale] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activeProducts = products.filter(p => p.active !== false);
  const archivedProducts = products.filter(p => p.active === false);
  const baseProducts = listMode === 'archived' ? archivedProducts : activeProducts;
  const getStockStatus = p => p.stock === 0 ? 'out' : p.stock <= p.minStock ? 'low' : 'ok';
  const shownProducts = stockFilter === 'all' ? baseProducts : baseProducts.filter(p => getStockStatus(p) === stockFilter);
  const stockCounts = {
    all: baseProducts.length,
    ok: baseProducts.filter(p => getStockStatus(p) === 'ok').length,
    low: baseProducts.filter(p => getStockStatus(p) === 'low').length,
    out: baseProducts.filter(p => getStockStatus(p) === 'out').length,
  };
  const lowStock = activeProducts.filter(p => p.stock <= p.minStock);

  const lbl = { fontSize: 11, letterSpacing: '0.1em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 6 };
  const inp = { width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 0', fontSize: 13, background: 'none', color: 'var(--dark)', outline: 'none', boxSizing: 'border-box' };
  const ta  = { ...inp, resize: 'vertical', minHeight: 72, padding: '6px 0' };

  function openEdit(p) {
    setError('');
    setEditing({
      ...p,
      variants: (p.variants || []).map(variant => ({ ...variant })),
    });
  }

  function openNew() {
    setError('');
    setEditing({
      id: null,
      name: '',
      nameZh: '',
      category: PRODUCT_CATEGORIES[0],
      minStock: 3,
      isProOnly: false,
      img: '',
      imageUrls: [],
      desc: '',
      skinType: '',
      ingredients: '',
      features: [],
      variants: [{
        id: `new-${Date.now()}`,
        sku: '',
        size: '',
        price: 0,
        proPrice: 0,
        stock: 0,
        isDefault: true,
        sortOrder: 0,
        active: true,
      }],
      sourceFolderName: '',
      importedFromDrive: false,
      listImageScale: null,
      active: true,
      isNew: true,
    });
  }

  function setF(field) {
    return e => setEditing(prev => ({ ...prev, [field]: e.target.value }));
  }

  function setImageUrls(e) {
    const imageUrls = e.target.value.split('\n').map(line => line.trim()).filter(Boolean);
    setEditing(prev => ({ ...prev, imageUrls }));
  }

  function updateVariant(index, field, value) {
    setEditing(prev => ({
      ...prev,
      variants: prev.variants.map((variant, variantIndex) => (
        variantIndex === index ? { ...variant, [field]: value } : variant
      )),
    }));
  }

  function addVariant() {
    setEditing(prev => ({
      ...prev,
      variants: [
        ...prev.variants,
        {
          id: `new-${Date.now()}-${prev.variants.length}`,
          sku: '',
          size: '',
          price: 0,
          proPrice: 0,
          stock: 0,
          isDefault: prev.variants.length === 0,
          sortOrder: prev.variants.length,
          active: true,
        },
      ],
    }));
  }

  function removeVariant(index) {
    setEditing(prev => {
      const removed = prev.variants[index];
      const variants = prev.variants.filter((_, variantIndex) => variantIndex !== index);
      if (removed?.isDefault && variants.length > 0) {
        const firstActive = variants.findIndex(variant => variant.active !== false);
        const nextDefault = firstActive >= 0 ? firstActive : 0;
        variants[nextDefault] = { ...variants[nextDefault], active: true, isDefault: true };
      }
      return { ...prev, variants };
    });
  }

  function setDefaultVariant(index) {
    setEditing(prev => ({
      ...prev,
      variants: prev.variants.map((variant, variantIndex) => ({
        ...variant,
        active: variantIndex === index ? true : variant.active,
        isDefault: variantIndex === index,
      })),
    }));
  }

  function moveVariant(index, direction) {
    setEditing(prev => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.variants.length) return prev;
      const variants = [...prev.variants];
      [variants[index], variants[nextIndex]] = [variants[nextIndex], variants[index]];
      return { ...prev, variants };
    });
  }

  async function setImageFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('請選擇圖片檔案');
      return;
    }
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      setError('圖片大小不可超過 2 MB');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) {
      setError('圖片讀取失敗，請重新選擇');
      return;
    }
    setEditing(prev => ({ ...prev, img: dataUrl }));
  }

  async function saveEdit() {
    setError('');
    if (!editing.nameZh.trim() || !editing.name.trim() || (editing.isNew && !editing.img.trim())) {
      setError('請輸入中文名稱、英文名稱並選擇商品圖片');
      return;
    }
    if (!editing.variants.length) {
      setError('商品至少需要一個規格');
      return;
    }
    const normalizedVariants = editing.variants.map((variant, index) => ({
      ...variant,
      sku: String(variant.sku || '').trim(),
      size: String(variant.size || '').trim(),
      price: Number(variant.price) || 0,
      proPrice: Number(variant.proPrice) || 0,
      stock: Math.max(0, Number(variant.stock) || 0),
      sortOrder: index,
      active: variant.active !== false,
    }));
    const invalidVariant = normalizedVariants.find(variant => (
      !variant.sku || !variant.size || variant.price < 0 || variant.proPrice < 0 || variant.stock < 0
    ));
    if (invalidVariant) {
      setError('每個規格都必須填寫 SKU、規格名稱、非負價格與庫存');
      return;
    }
    const activeDefaults = normalizedVariants.filter(variant => variant.active && variant.isDefault);
    if (activeDefaults.length !== 1) {
      setError('請指定一個啟用中的預設規格');
      return;
    }
    const normalizedSkus = normalizedVariants.map(variant => variant.sku.toLowerCase());
    if (new Set(normalizedSkus).size !== normalizedSkus.length) {
      setError('同一商品的 SKU 不可重複');
      return;
    }

    const updated = {
      ...editing,
      variants: normalizedVariants,
      minStock: Math.max(0, Number(editing.minStock) || 0),
      listImageScale: normalizeProductImageScale(editing.listImageScale),
    };
    setSaving(true);
    const saveError = await onSaveProduct(updated);
    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setEditing(null);
  }

  function applyBulkImageScale(field, value, label) {
    setError('');
    const scale = normalizeProductImageScale(value);
    if (!scale) {
      setError(`請輸入有效的${label}縮放比例，例如 1、1.08、0.95`);
      return;
    }
    if (!confirm(`確定將所有商品的「${label}」調整為 ${scale} 倍嗎？`)) return;
    setProducts(prev => prev.map(product => ({ ...product, [field]: scale })));
    setEditing(prev => prev ? { ...prev, [field]: scale } : prev);
  }

  function clearBulkImageScale(field, label) {
    setError('');
    if (!confirm(`確定將所有商品的「${label}」恢復為自動校正嗎？`)) return;
    setProducts(prev => prev.map(product => ({ ...product, [field]: null })));
    setEditing(prev => prev ? { ...prev, [field]: null } : prev);
  }

  async function archiveProduct(p) {
    if (!confirm(`確定要下架商品「${p.nameZh}」嗎？下架後前台將不顯示此商品。`)) return;
    setError('');
    setSaving(true);
    const archiveError = await onArchiveProduct(p);
    setSaving(false);
    if (archiveError) setError(archiveError);
  }

  async function restoreProduct(p) {
    setError('');
    setSaving(true);
    const restoreError = await onRestoreProduct(p);
    setSaving(false);
    if (restoreError) setError(restoreError);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400 }}>商品 & 庫存</h1>
          <span style={{ fontSize: 12, color: 'var(--mid)' }}>{activeProducts.length} 件上架中</span>
          {lowStock.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500 }}>⚠ {lowStock.length} 件庫存不足</span>
          )}
        </div>
        <button onClick={openNew} style={{ padding: '10px 24px', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 12, letterSpacing: '0.1em', cursor: 'pointer' }}>+ 新增商品</button>
      </div>

      {error && (
        <div style={{ background: 'oklch(0.60 0.18 25 / 0.05)', border: '1px solid oklch(0.60 0.18 25 / 0.2)', padding: '12px 16px', marginBottom: 20, fontSize: 12, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--border)', width: 'fit-content', background: 'var(--white)' }}>
        {[['active', `上架中 (${activeProducts.length})`], ['archived', `已下架 (${archivedProducts.length})`]].map(([value, label]) => (
          <button key={value} onClick={() => { setListMode(value); setEditing(null); }} style={{
            padding: '9px 18px', border: 'none', background: listMode === value ? 'var(--dark)' : 'transparent',
            color: listMode === value ? '#fff' : 'var(--mid)', fontSize: 12, cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>批次圖片縮放</div>
            <div style={{ fontSize: 11, color: 'var(--mid)' }}>透明背景圖片會自動校正商品本體大小；填數值會改為手動覆寫商品列表圖。1 為原尺寸，大於 1 放大，小於 1 縮小。</div>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <label htmlFor="bulkListScale" style={{ ...lbl, marginBottom: 5 }}>商品列表圖片</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="bulkListScale" type="number" min="0.1" max="3" step="0.01" value={bulkListScale} onChange={e => setBulkListScale(e.target.value)} style={{ ...inp, width: 92, border: '1px solid var(--border)', padding: '7px 9px' }} placeholder="1.08" />
                <button onClick={() => applyBulkImageScale('listImageScale', bulkListScale, '商品列表圖片')} style={{ padding: '7px 12px', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer' }}>套用</button>
                <button onClick={() => clearBulkImageScale('listImageScale', '商品列表圖片')} style={{ padding: '7px 12px', background: 'none', color: 'var(--mid)', border: '1px solid var(--border)', fontSize: 11, cursor: 'pointer' }}>自動</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Low stock warning */}
      {lowStock.length > 0 && (
        <div style={{ background: 'oklch(0.60 0.18 25 / 0.05)', border: '1px solid oklch(0.60 0.18 25 / 0.2)', padding: '14px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--red)', marginBottom: 8 }}>⚠ 庫存不足警示 — 以下商品需要補貨</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {lowStock.map(p => (
              <div key={p.id} style={{ fontSize: 12, background: 'var(--white)', border: '1px solid var(--border)', padding: '5px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--dark)' }}>{p.nameZh}</span>
                <span style={{ fontWeight: 700, color: p.stock === 0 ? 'var(--red)' : 'var(--yellow)' }}>{p.stock} 件</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={'detail-grid' + (editing ? '' : ' no-panel')}>
        {/* Table */}
        <div>
          <div className="table-scroll" style={{ background: 'var(--white)', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--off)' }}>
                  {['商品名稱', '分類', '規格', '售價', '專業價', '院線', '庫存'].map(h => (
                    <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                      <span>狀態</span>
                      <select
                        aria-label="庫存狀態篩選"
                        value={stockFilter}
                        onChange={e => { setStockFilter(e.target.value); setEditing(null); }}
                        style={{
                          width: 104,
                          border: '1px solid var(--border)',
                          background: 'var(--white)',
                          color: 'var(--dark)',
                          fontSize: 11,
                          padding: '5px 8px',
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="all">全部 ({stockCounts.all})</option>
                        <option value="ok">正常 ({stockCounts.ok})</option>
                        <option value="low">低庫存 ({stockCounts.low})</option>
                        <option value="out">缺貨 ({stockCounts.out})</option>
                      </select>
                    </div>
                  </th>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {shownProducts.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>
                      {stockFilter === 'all'
                        ? (listMode === 'archived' ? '目前沒有已下架商品' : '目前沒有上架商品')
                        : '目前沒有符合此庫存狀態的商品'}
                    </td>
                  </tr>
                )}
                {shownProducts.map(p => {
                  const isLow = p.stock <= p.minStock;
                  const isEditing = editing?.id === p.id;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: isEditing ? 'var(--off)' : p.stock === 0 ? 'oklch(0.60 0.18 25 / 0.03)' : 'transparent' }}>
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{p.nameZh}</div>
                        <div style={{ fontSize: 11, color: 'var(--mid)' }}>{p.name}</div>
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: 'var(--mid)' }}>{p.category}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12 }}>{p.size}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, fontWeight: 500 }}>NT$ {p.price.toLocaleString()}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: 'var(--gold)' }}>NT$ {p.proPrice.toLocaleString()}</td>
                      <td style={{ padding: '13px 14px' }}>
                        <span style={{ fontSize: 11, color: p.isProOnly ? 'var(--dark)' : 'var(--mid)', fontWeight: p.isProOnly ? 600 : 400 }}>
                          {p.isProOnly ? '● 院線' : '○ 一般'}
                        </span>
                      </td>
                      <td style={{ padding: '13px 14px' }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: p.stock === 0 ? 'var(--red)' : isLow ? 'var(--yellow)' : 'var(--dark)' }}>{p.stock}</span>
                      </td>
                      <td style={{ padding: '13px 14px' }}>
                        {p.active === false
                          ? <span style={{ fontSize: 11, color: 'var(--mid)', fontWeight: 500 }}>已下架</span>
                          : p.stock === 0
                          ? <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 500 }}>缺貨</span>
                          : isLow
                            ? <span style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 500 }}>低庫存</span>
                            : <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>正常</span>}
                      </td>
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => openEdit(p)}
                            style={{ padding: '5px 12px', fontSize: 11, background: isEditing ? 'var(--dark)' : 'none', border: '1px solid var(--border)', color: isEditing ? '#fff' : 'var(--dark)', cursor: 'pointer' }}>編輯</button>
                          {p.active === false ? (
                            <button onClick={() => restoreProduct(p)} disabled={saving}
                              style={{ padding: '5px 12px', fontSize: 11, background: 'var(--dark)', border: '1px solid var(--dark)', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>重新上架</button>
                          ) : (
                            <button onClick={() => archiveProduct(p)} disabled={saving}
                              style={{ padding: '5px 12px', fontSize: 11, background: 'none', border: '1px solid var(--border)', color: 'var(--mid)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>下架</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit panel */}
        {editing && (
          <div className="detail-panel" style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--mid)', textTransform: 'uppercase', marginBottom: 4 }}>{editing.isNew ? '新增商品' : '編輯商品'}</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--dark)' }}>{editing.nameZh || '新商品'}</div>
              </div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--mid)', lineHeight: 1, padding: '0 0 0 8px' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label htmlFor="productNameZh" style={lbl}>中文名稱</label>
                  <input id="productNameZh" value={editing.nameZh} onChange={setF('nameZh')} style={inp} />
                </div>
                <div>
                  <label htmlFor="productName" style={lbl}>英文名稱</label>
                  <input id="productName" value={editing.name} onChange={setF('name')} style={inp} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label htmlFor="productCategory" style={lbl}>分類</label>
                  <select id="productCategory" value={editing.category} onChange={setF('category')}
                    style={{ ...inp, cursor: 'pointer' }}>
                    {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="productMinStock" style={lbl}>低庫存警示值</label>
                  <input id="productMinStock" type="number" min="0" value={editing.minStock} onChange={setF('minStock')} style={inp} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" id="isProOnly" checked={editing.isProOnly}
                  onChange={e => setEditing(prev => ({ ...prev, isProOnly: e.target.checked }))}
                  style={{ width: 15, height: 15, cursor: 'pointer' }} />
                <label htmlFor="isProOnly" style={{ fontSize: 13, color: 'var(--dark)', cursor: 'pointer' }}>院線限定（一般會員可看介紹，不顯示價格且不可購買）</label>
              </div>

              <div style={{ height: 1, background: 'var(--border)' }} />

              <div>
                <label htmlFor="productImageFile" style={lbl}>上傳商品圖片</label>
                <input id="productImageFile" type="file" accept="image/*" onChange={setImageFile} style={{ ...inp, padding: '8px 0', cursor: 'pointer' }} />
                <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 6 }}>JPG、PNG、WebP，檔案上限 2 MB</p>
              </div>

              <div>
                <label htmlFor="productImage" style={lbl}>或貼上圖片網址</label>
                <input id="productImage" value={editing.img.startsWith('data:') ? '' : editing.img} onChange={setF('img')} style={inp} placeholder="https://..." />
                {editing.img && (
                  <img src={editing.img} alt={editing.nameZh || '商品圖片預覽'} style={{ width: 84, height: 84, objectFit: 'cover', marginTop: 10, border: '1px solid var(--border)', background: 'var(--off)' }} />
                )}
              </div>

              <div>
                <label htmlFor="productImageUrls" style={lbl}>商品圖庫（一行一個圖片網址）</label>
                <textarea id="productImageUrls" value={(editing.imageUrls || []).join('\n')} onChange={setImageUrls} style={{ ...ta, minHeight: 84 }} placeholder="https://..." />
              </div>

              <div>
                <div>
                  <label htmlFor="productListImageScale" style={lbl}>商品列表圖片縮放</label>
                  <input id="productListImageScale" type="number" min="0.1" max="3" step="0.01" value={editing.listImageScale ?? ''} onChange={setF('listImageScale')} style={inp} placeholder="空白自動校正" />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div>
                    <div style={{ ...lbl, marginBottom: 4 }}>商品規格</div>
                    <p style={{ fontSize: 11, color: 'var(--mid)', margin: 0 }}>價格與庫存以規格資料為準；師資與經銷價由專業價套用會員倍率。</p>
                  </div>
                  <button type="button" onClick={addVariant}
                    style={{ padding: '7px 12px', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + 新增規格
                  </button>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                    <thead>
                      <tr style={{ background: 'var(--off)', borderBottom: '1px solid var(--border)' }}>
                        {['順序', '規格', 'SKU', '市場價', '專業價', '庫存', '預設', '啟用', '操作'].map(header => (
                          <th key={header} style={{ padding: '9px 8px', textAlign: 'left', fontSize: 10, color: 'var(--mid)', fontWeight: 500, whiteSpace: 'nowrap' }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editing.variants.map((variant, index) => (
                        <tr key={variant.id || index} style={{ borderBottom: '1px solid var(--border)', opacity: variant.active === false ? 0.55 : 1 }}>
                          <td style={{ padding: '8px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button type="button" aria-label={`規格 ${index + 1} 上移`} disabled={index === 0} onClick={() => moveVariant(index, -1)}
                                style={{ border: '1px solid var(--border)', background: 'none', cursor: index === 0 ? 'not-allowed' : 'pointer', color: 'var(--mid)', padding: '3px 6px' }}>↑</button>
                              <button type="button" aria-label={`規格 ${index + 1} 下移`} disabled={index === editing.variants.length - 1} onClick={() => moveVariant(index, 1)}
                                style={{ border: '1px solid var(--border)', background: 'none', cursor: index === editing.variants.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--mid)', padding: '3px 6px' }}>↓</button>
                            </div>
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input aria-label={`規格 ${index + 1} 名稱`} value={variant.size} onChange={e => updateVariant(index, 'size', e.target.value)}
                              style={{ ...inp, minWidth: 110 }} placeholder="例如 500ml" />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input aria-label={`規格 ${index + 1} SKU`} value={variant.sku || ''} onChange={e => updateVariant(index, 'sku', e.target.value)}
                              style={{ ...inp, minWidth: 120 }} placeholder="例如 PHA-500" />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input aria-label={`規格 ${index + 1} 市場價`} type="number" min="0" value={variant.price} onChange={e => updateVariant(index, 'price', e.target.value)}
                              style={{ ...inp, width: 82 }} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input aria-label={`規格 ${index + 1} 專業價`} type="number" min="0" value={variant.proPrice} onChange={e => updateVariant(index, 'proPrice', e.target.value)}
                              style={{ ...inp, width: 82 }} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input aria-label={`規格 ${index + 1} 庫存`} type="number" min="0" value={variant.stock} onChange={e => updateVariant(index, 'stock', e.target.value)}
                              style={{ ...inp, width: 70 }} />
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <input aria-label={`規格 ${index + 1} 設為預設`} type="radio" name="defaultVariant" checked={!!variant.isDefault}
                              onChange={() => setDefaultVariant(index)} />
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <input aria-label={`規格 ${index + 1} 啟用`} type="checkbox" checked={variant.active !== false}
                              disabled={!!variant.isDefault}
                              onChange={e => updateVariant(index, 'active', e.target.checked)} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <button type="button" onClick={() => removeVariant(index)} disabled={editing.variants.length === 1}
                              style={{ padding: '5px 9px', background: 'none', border: '1px solid var(--border)', color: 'var(--mid)', fontSize: 10, cursor: editing.variants.length === 1 ? 'not-allowed' : 'pointer' }}>
                              移除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 7 }}>移除既有規格後，資料庫會將它停用並保留歷史紀錄；預設規格不可停用。</p>
              </div>

              <div>
                <label htmlFor="productDescription" style={lbl}>商品描述</label>
                <textarea id="productDescription" value={editing.desc} onChange={setF('desc')} style={{ ...ta, minHeight: 96 }} />
              </div>

              <div>
                <label htmlFor="productIngredients" style={lbl}>主要成分</label>
                <textarea id="productIngredients" value={editing.ingredients} onChange={setF('ingredients')} style={{ ...ta, minHeight: 72 }} />
              </div>

              <div>
                <label htmlFor="productSkinType" style={lbl}>適合膚質</label>
                <input id="productSkinType" value={editing.skinType} onChange={setF('skinType')} style={inp} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={saveEdit} disabled={saving}
                style={{ flex: 1, padding: '12px 0', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 12, letterSpacing: '0.1em', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? '儲存中…' : editing.isNew ? '建立商品' : '儲存'}
              </button>
              <button onClick={() => setEditing(null)}
                style={{ padding: '12px 20px', background: 'none', border: '1px solid var(--border)', fontSize: 12, color: 'var(--mid)', cursor: 'pointer' }}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
