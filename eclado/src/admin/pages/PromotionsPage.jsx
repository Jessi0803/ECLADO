import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import {
  applyPromotionFormula,
  getPromotionDiscountOrder,
  isPromotionLive,
  normProductIds,
} from '../../domain/promotions.js';
import { getPromotionPhase, PromoBadge } from '../components/StatusIndicators.jsx';

export default function Promotions({ products }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | { ...promo } | 'new'

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('promotions')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setList(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel('promotions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promotions' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function remove(p) {
    if (!confirm(`確定要刪除活動「${p.name}」嗎？此操作無法還原。`)) return;
    await supabase.from('promotions').delete().eq('id', p.id);
  }

  if (editing) {
    return <PromotionForm
      promo={editing === 'new' ? null : editing}
      products={products}
      onClose={() => setEditing(null)}
    />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400 }}>活動管理</h1>
        <button onClick={() => setEditing('new')} style={{
          padding: '10px 22px', background: 'var(--dark)', color: '#fff',
          border: 'none', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer',
        }}>+ 新增活動</button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>載入中…</div>
      ) : list.length === 0 ? (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '60px 40px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 16 }}>目前還沒有活動</p>
          <button onClick={() => setEditing('new')} style={{
            padding: '10px 24px', background: 'var(--dark)', color: '#fff',
            border: 'none', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer',
          }}>建立第一個活動</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {list.map(p => {
            const phase = getPromotionPhase(p);
            const productNames = normProductIds(p)
              .map(id => products.find(x => x.id === id)?.nameZh)
              .filter(Boolean);
            return (
              <div key={p.id} style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--dark)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</h3>
                    <PromoBadge phase={phase} />
                  </div>
                </div>

                <div style={{ background: 'var(--off)', padding: '10px 12px', fontSize: 12, color: 'var(--dark)', borderLeft: '2px solid var(--gold)' }}>
                  {getPromotionDiscountOrder(p) === 'amount_then_rate' ? (
                    <>
                      （原價
                      {Number(p.discount_amount) > 0 && <> − <b>NT$ {Number(p.discount_amount).toLocaleString()}</b></>}
                      ） × <b>{p.discount_rate}</b>
                    </>
                  ) : (
                    <>
                      原價 × <b>{p.discount_rate}</b>
                      {Number(p.discount_amount) > 0 && <> − <b>NT$ {Number(p.discount_amount).toLocaleString()}</b></>}
                    </>
                  )}
                </div>

                <div style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 4 }}><b style={{ color: 'var(--dark)' }}>{productNames.length}</b> 件參與商品</div>
                  {productNames.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--mid)' }}>
                      {productNames.slice(0, 3).join('、')}{productNames.length > 3 ? `…等 ${productNames.length} 件` : ''}
                    </div>
                  )}
                </div>

                {(p.start_at || p.end_at) && (
                  <div style={{ fontSize: 11, color: 'var(--mid)', lineHeight: 1.8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    {p.start_at && <div>上架：{new Date(p.start_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                    {p.end_at && <div>下架：{new Date(p.end_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setEditing(p)} style={{
                    flex: 1, padding: '8px', background: 'var(--off)', color: 'var(--dark)',
                    border: '1px solid var(--border)', fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer',
                  }}>編輯</button>
                  <button onClick={() => remove(p)} style={{
                    padding: '8px 14px', background: 'none', color: 'var(--red)',
                    border: '1px solid var(--border)', fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer',
                  }}>刪除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromotionForm({ promo, products, onClose }) {
  const [name, setName] = useState(promo?.name || '');
  const [description, setDescription] = useState(promo?.description || '');
  const [productIds, setProductIds] = useState(new Set((promo?.product_ids || []).map(Number)));
  const [rate, setRate] = useState(promo?.discount_rate ?? 0.95);
  const [amount, setAmount] = useState(promo?.discount_amount ?? 1000);
  const [discountOrder, setDiscountOrder] = useState(getPromotionDiscountOrder(promo));
  const [startAt, setStartAt] = useState(promo?.start_at ? promo.start_at.slice(0, 16) : '');
  const [endAt, setEndAt] = useState(promo?.end_at ? promo.end_at.slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleProduct(id) {
    setProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('請輸入活動名稱'); return; }
    if (productIds.size === 0) { setError('請至少選擇一個參與商品'); return; }
    if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      setError('下架時間必須晚於上架時間');
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      product_ids: Array.from(productIds),
      discount_rate: Number(rate),
      discount_amount: Number(amount),
      discount_order: discountOrder,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      active: true,
    };

    setSaving(true);
    const { error } = promo
      ? await supabase.from('promotions').update(payload).eq('id', promo.id)
      : await supabase.from('promotions').insert(payload);
    setSaving(false);

    if (error) {
      if (String(error.message || '').includes('discount_order')) {
        setError('儲存失敗：請先到 Supabase 執行 supabase-promotions-discount-order.sql，更新 promotions 的 discount_order 欄位後再試一次。');
        return;
      }
      setError('儲存失敗：' + error.message);
      return;
    }
    onClose();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mid)', fontSize: 12, cursor: 'pointer', marginBottom: 6, padding: 0 }}>← 返回活動列表</button>
          <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400 }}>{promo ? '編輯活動' : '新增活動'}</h1>
        </div>
      </div>

      {error && (
        <div style={{ background: 'oklch(0.60 0.18 25 / 0.08)', border: '1px solid oklch(0.60 0.18 25 / 0.3)', padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--red)' }}>{error}</div>
      )}

      <form onSubmit={save} style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: 'clamp(20px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 880 }}>
        {/* 活動名稱 */}
        <div>
          <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>活動名稱 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：五月慶 95折再折千"
            style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none' }} />
        </div>

        {/* 活動說明 */}
        <div>
          <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>活動說明（選填）</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="顯示給顧客看的說明文字"
            style={{ width: '100%', border: '1px solid var(--border)', padding: '10px 12px', fontSize: 13, outline: 'none', background: 'var(--off)', resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* 折扣 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          <div>
            <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>折扣率（乘）</label>
            <input type="number" step="0.01" min="0" max="1" value={rate} onChange={e => setRate(e.target.value)}
              style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none' }} />
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>0.95 = 95 折，1 = 不打折</p>
          </div>
          <div>
            <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>再減金額（NT$）</label>
            <input type="number" step="1" min="0" value={amount} onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none' }} />
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>0 = 不額外減</p>
          </div>
          <div>
            <label htmlFor="promotion-discount-order" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>折扣計算順序</label>
            <select id="promotion-discount-order" value={discountOrder} onChange={e => setDiscountOrder(e.target.value)}
              style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none' }}>
              <option value="rate_then_amount">先打折，再減金額</option>
              <option value="amount_then_rate">先減金額，再打折</option>
            </select>
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>新選項會先折抵固定金額，再套用折扣率</p>
          </div>
        </div>

        <div style={{ background: 'var(--off)', padding: '12px 16px', fontSize: 13, color: 'var(--dark)', borderLeft: '2px solid var(--gold)' }}>
          計算公式：
          {discountOrder === 'amount_then_rate' ? (
            <>（活動商品小計 − <b>NT$ {Number(amount).toLocaleString()}</b>） × <b>{rate}</b></>
          ) : (
            <>活動商品小計 × <b>{rate}</b> − <b>NT$ {Number(amount).toLocaleString()}</b></>
          )}
        </div>

        {/* 排程時間 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          <div>
            <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>上架時間（選填）</label>
            <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
              style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 14, outline: 'none', background: 'none', color: 'var(--dark)' }} />
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>留空表示立即生效</p>
          </div>
          <div>
            <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>下架時間（選填）</label>
            <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
              style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 14, outline: 'none', background: 'none', color: 'var(--dark)' }} />
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>留空表示永不自動下架</p>
          </div>
        </div>

        {/* 商品選擇 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase' }}>參與商品 * <span style={{ color: 'var(--dark)', fontWeight: 500 }}>（已選 {productIds.size} 件）</span></label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" onClick={() => setProductIds(new Set(products.map(p => p.id)))} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer', padding: 0 }}>全選</button>
              <button type="button" onClick={() => setProductIds(new Set())} style={{ background: 'none', border: 'none', color: 'var(--mid)', fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer', padding: 0 }}>清除</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, border: '1px solid var(--border)', padding: 12, background: 'var(--off)' }}>
            {products.map(p => {
              const checked = productIds.has(p.id);
              return (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer',
                  background: checked ? 'var(--white)' : 'transparent',
                  border: `1px solid ${checked ? 'var(--gold)' : 'transparent'}`,
                  fontSize: 12, color: 'var(--dark)',
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleProduct(p.id)} style={{ cursor: 'pointer' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nameZh}</div>
                    <div style={{ fontSize: 10, color: 'var(--mid)', marginTop: 2 }}>NT$ {p.price.toLocaleString()}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* 動作 */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{
            padding: '12px 24px', background: 'none', color: 'var(--mid)',
            border: '1px solid var(--border)', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer',
          }}>取消</button>
          <button type="submit" disabled={saving} style={{
            padding: '12px 28px', background: saving ? 'var(--mid)' : 'var(--dark)', color: '#fff',
            border: 'none', fontSize: 12, letterSpacing: '0.12em', cursor: saving ? 'wait' : 'pointer',
          }}>{saving ? '儲存中…' : (promo ? '儲存變更' : '建立活動')}</button>
        </div>
      </form>
    </div>
  );
}
