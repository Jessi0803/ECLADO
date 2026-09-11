import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import { getPromotionPhase, PromoBadge } from '../components/StatusIndicators.jsx';

const ROLES = [['consumer', '一般會員'], ['pro', '專業會員'], ['instructor', '師資'], ['distributor', '經銷']];
const inputStyle = { width:'100%', border:'none', borderBottom:'1px solid var(--border)', padding:'10px 0', fontSize:14, outline:'none', background:'none', boxSizing:'border-box' };
const labelStyle = { fontSize:11, letterSpacing:'0.12em', color:'var(--mid)', display:'block', marginBottom:8 };
const panelStyle = { background:'var(--white)', border:'1px solid var(--border)', padding:'clamp(20px, 4vw, 32px)', maxWidth:920 };
const gridStyle = { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:20 };
const secondaryButton = { flex:1, padding:'8px', background:'var(--off)', color:'var(--dark)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer' };

export default function Promotions({ products }) {
  const [tab, setTab] = useState('promotions');
  const [promotions, setPromotions] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPromotion, setEditingPromotion] = useState(null);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [loadError, setLoadError] = useState('');

  async function load() {
    setLoading(true); setLoadError('');
    const [promotionResult, scopeResult, couponResult, linkResult] = await Promise.all([
      supabase.from('promotions').select('*').is('archived_at', null).order('created_at', { ascending:false }),
      supabase.from('promotion_scopes').select('*'),
      supabase.from('coupon_campaigns').select('*').is('archived_at', null).order('created_at', { ascending:false }),
      supabase.from('coupon_promotions').select('*').order('sort_order'),
    ]);
    const error = promotionResult.error || scopeResult.error || couponResult.error || linkResult.error;
    if (error) setLoadError(`載入失敗：${error.message}`);
    setPromotions(promotionResult.data || []); setScopes(scopeResult.data || []);
    setCoupons(couponResult.data || []); setLinks(linkResult.data || []); setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (editingPromotion) return <DiscountPromotionForm promo={editingPromotion === 'new' ? null : editingPromotion} products={products} scopes={scopes} onClose={() => { setEditingPromotion(null); load(); }} />;
  if (editingCoupon) return <CouponForm coupon={editingCoupon === 'new' ? null : editingCoupon} promotions={promotions.filter(p => p.activation_type === 'coupon_only' && !p.archived_at && ['percentage_discount', 'fixed_discount', 'amount_gift', 'quantity_gift'].includes(p.benefit_type))} linkedIds={editingCoupon === 'new' ? [] : links.filter(link => link.coupon_campaign_id === editingCoupon.id).map(link => link.promotion_id)} onClose={() => { setEditingCoupon(null); load(); }} />;

  return <div>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:16, flexWrap:'wrap' }}>
      <h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400 }}>活動與優惠券</h1>
      <button onClick={() => tab === 'promotions' ? setEditingPromotion('new') : setEditingCoupon('new')} style={{ padding:'10px 22px', background:'var(--dark)', color:'#fff', border:'none', fontSize:12, letterSpacing:'0.12em', cursor:'pointer' }}>+ {tab === 'promotions' ? '新增優惠活動' : '新增優惠券'}</button>
    </div>
    <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:24 }}>
      {[['promotions','優惠活動'],['coupons','優惠券方案']].map(([value,label]) => <button key={value} onClick={() => setTab(value)} style={{ padding:'11px 20px', border:'none', borderBottom:tab === value ? '2px solid var(--dark)' : '2px solid transparent', background:'none', color:tab === value ? 'var(--dark)' : 'var(--mid)', cursor:'pointer', fontSize:13 }}>{label}</button>)}
    </div>
    {loadError && <div role="alert" style={{ marginBottom:16, color:'var(--red)', fontSize:13 }}>{loadError}</div>}
    {loading ? <Empty text="載入中…" /> : tab === 'promotions' ? <PromotionList list={promotions} scopes={scopes} products={products} onEdit={setEditingPromotion} onReload={load} /> : <CouponList list={coupons} links={links} promotions={promotions} onEdit={setEditingCoupon} onReload={load} />}
  </div>;
}

function PromotionList({ list, scopes, products, onEdit, onReload }) {
  async function archive(promo) {
    if (!confirm(`確定停用活動「${promo.name}」？既有訂單快照不受影響。`)) return;
    const { error } = await supabase.from('promotions').update({ active:false, archived_at:new Date().toISOString() }).eq('id', promo.id);
    if (error) alert(`停用失敗：${error.message}`); else onReload();
  }
  if (!list.length) return <Empty text="目前還沒有優惠活動" />;
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
    {list.map(promo => {
      const promoScopes = scopes.filter(scope => scope.promotion_id === promo.id && scope.scope_role === 'benefit' && scope.mode === 'include');
      const allRegular = promoScopes.some(scope => scope.target_type === 'all_regular');
      const names = promoScopes.filter(scope => scope.target_type === 'product').map(scope => products.find(product => product.id === scope.product_id)?.nameZh).filter(Boolean);
      const legacy = !promo.benefit_type || promo.benefit_type === 'legacy_discount';
      return <Card key={promo.id}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}><div><h3 style={{ fontSize:15, fontWeight:500, marginBottom:6 }}>{promo.name}</h3><PromoBadge phase={getPromotionPhase(promo)} /></div><span style={{ fontSize:10, color:'var(--mid)' }}>{promo.activation_type === 'coupon_only' ? '優惠券專用' : '自動活動'}</span></div>
        <div style={{ background:'var(--off)', padding:'11px 12px', borderLeft:'2px solid var(--gold)', fontSize:12 }}>{getBenefitLabel(promo, products)}</div>
        <div style={{ fontSize:11, color:'var(--mid)', lineHeight:1.7 }}>適用：{legacy ? `${(promo.product_ids || []).length} 件既有指定商品` : allRegular ? '全館一般商品' : names.length ? names.join('、') : '尚未設定範圍'}{promo.threshold_value && <div>門檻：{promo.benefit_type === 'quantity_gift' || promo.threshold_type === 'quantity' ? `滿 ${Number(promo.threshold_value)} 件` : `滿 NT$ ${Number(promo.threshold_value).toLocaleString()}`}</div>}</div>
        <div style={{ display:'flex', gap:8, marginTop:'auto' }}><button onClick={() => legacy ? alert('舊版複合活動維持唯讀；請建立新的單一優惠活動取代。') : onEdit(promo)} style={secondaryButton}>編輯</button><button onClick={() => archive(promo)} disabled={!!promo.archived_at} style={{ ...secondaryButton, flex:'none', color:'var(--red)', opacity:promo.archived_at ? 0.45 : 1 }}>停用</button></div>
      </Card>;
    })}
  </div>;
}

function CouponList({ list, links, promotions, onEdit, onReload }) {
  async function archive(coupon) {
    if (!confirm(`確定停用優惠券「${coupon.name}」？既有訂單與核銷紀錄會保留。`)) return;
    const { error } = await supabase.from('coupon_campaigns').update({ active:false, archived_at:new Date().toISOString() }).eq('id', coupon.id);
    if (error) alert(`停用失敗：${error.message}`); else onReload();
  }
  if (!list.length) return <Empty text="目前還沒有優惠券方案" />;
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>{list.map(coupon => {
    const benefitNames = links.filter(link => link.coupon_campaign_id === coupon.id).map(link => promotions.find(p => p.id === link.promotion_id)?.name).filter(Boolean);
    return <Card key={coupon.id}><div style={{ display:'flex', justifyContent:'space-between', gap:12 }}><div><h3 style={{ fontSize:15, marginBottom:5 }}>{coupon.name}</h3><code style={{ color:'var(--gold)', letterSpacing:'0.12em' }}>{coupon.code}</code></div><span style={{ fontSize:11, color:coupon.active ? '#287a50' : 'var(--mid)' }}>{coupon.active ? '啟用' : '停用'}</span></div><div style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>{benefitNames.join(' ＋ ') || '尚未連結折扣活動'}</div><div style={{ fontSize:11, color:'var(--mid)', lineHeight:1.7 }}>每人上限：{coupon.per_member_limit || '不限'} 次 · 總上限：{coupon.total_usage_limit || '不限'} 次<br />訪客：{coupon.allow_guest ? '可使用' : '不可使用'} · 疊加：{stackingLabel(coupon.stacking_policy)}</div><div style={{ display:'flex', gap:8, marginTop:'auto' }}><button onClick={() => onEdit(coupon)} style={secondaryButton}>編輯</button><button onClick={() => archive(coupon)} style={{ ...secondaryButton, flex:'none', color:'var(--red)' }}>停用</button></div></Card>;
  })}</div>;
}

function DiscountPromotionForm({ promo, products, scopes, onClose }) {
  const benefitScopes = scopes.filter(scope => scope.promotion_id === promo?.id && scope.scope_role === 'benefit' && scope.mode === 'include');
  const initialAllRegular = benefitScopes.some(scope => scope.target_type === 'all_regular') || !promo;
  const [form, setForm] = useState({ name:promo?.name || '', description:promo?.description || '', benefit_type:promo?.benefit_type || 'percentage_discount', activation_type:promo?.activation_type || 'automatic', percent:promo ? Math.round((1 - Number(promo.discount_rate)) * 100) : 10, amount:promo?.discount_amount || 100, threshold_value:promo?.threshold_value || '', threshold_type:promo?.threshold_type || (promo?.benefit_type === 'quantity_gift' ? 'quantity' : 'amount'), threshold_basis:promo?.threshold_basis || 'before_bundle_discount', gift_variant_id:promo?.gift_variant_id || '', gift_quantity:promo?.gift_quantity || 1, repeat_mode:promo?.repeat_mode || 'once', scope_type:initialAllRegular ? 'all_regular' : 'products', product_ids:new Set(benefitScopes.filter(scope => scope.target_type === 'product').map(scope => scope.product_id)), start_at:toLocalInput(promo?.start_at), end_at:toLocalInput(promo?.end_at), active:promo?.active ?? true });
  const [saving,setSaving] = useState(false); const [error,setError] = useState('');
  const selectableProducts = useMemo(() => products.filter(product => product.publicationStatus !== 'archived' && product.publicationStatus !== 'gift_only'), [products]);
  const giftVariants = useMemo(() => products
    .filter(product => ['active', 'event_only', 'gift_only'].includes(product.publicationStatus))
    .flatMap(product => (product.variants || [])
      .filter(variant => variant.active !== false && variant.giftEnabled)
      .map(variant => ({
        ...variant,
        productName: product.nameZh,
        sourceLabel: product.publicationStatus === 'gift_only' ? '贈品專用商品' : '商品贈品庫存',
      }))), [products]);
  const isGift = ['amount_gift', 'quantity_gift'].includes(form.benefit_type);
  const set = (key,value) => setForm(current => ({ ...current, [key]:value }));
  function toggle(id) { const next = new Set(form.product_ids); next.has(id) ? next.delete(id) : next.add(id); set('product_ids', next); }
  async function save(event) {
    event.preventDefault(); setError('');
    if (!form.name.trim()) return setError('請輸入活動名稱');
    if (form.scope_type === 'products' && !form.product_ids.size) return setError('請至少選擇一件商品');
    if (isGift && (!form.gift_variant_id || Number(form.threshold_value) <= 0 || Number(form.gift_quantity) <= 0)) return setError('請設定門檻、贈品與贈送數量');
    if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) return setError('結束時間必須晚於開始時間');
    setSaving(true);
    const thresholdType = form.benefit_type === 'quantity_gift' ? 'quantity' : form.benefit_type === 'amount_gift' ? 'amount' : form.threshold_type;
    const payload = { id:promo?.id || null, name:form.name.trim(), description:form.description.trim(), benefit_type:form.benefit_type, activation_type:form.activation_type, discount_rate:form.benefit_type === 'percentage_discount' ? 1 - Number(form.percent) / 100 : 1, discount_amount:form.benefit_type === 'fixed_discount' ? Number(form.amount) : 0, threshold_value:form.threshold_value === '' ? null : Number(form.threshold_value), threshold_type:thresholdType, threshold_basis:!isGift && thresholdType === 'amount' && form.threshold_value !== '' ? form.threshold_basis : null, gift_variant_id:isGift ? Number(form.gift_variant_id) : null, gift_quantity:isGift ? Number(form.gift_quantity) : null, repeat_mode:isGift ? form.repeat_mode : 'once', scope_type:form.scope_type, product_ids:[...form.product_ids], start_at:form.start_at ? new Date(form.start_at).toISOString() : null, end_at:form.end_at ? new Date(form.end_at).toISOString() : null, active:form.active };
    const { error:saveError } = await supabase.rpc('save_discount_promotion', { p_payload:payload }); setSaving(false);
    if (saveError) setError(`儲存失敗：${saveError.message}`); else onClose();
  }
  return <Editor title={promo ? '編輯優惠活動' : '新增優惠活動'} back="返回活動列表" onClose={onClose} error={error}><form onSubmit={save} style={{ ...panelStyle, display:'flex', flexDirection:'column', gap:22 }}>
    <Field label="活動名稱 *"><input style={inputStyle} value={form.name} onChange={e => set('name',e.target.value)} placeholder="例：秋季保養 9 折" /></Field>
    <Field label="顧客說明（選填）"><textarea style={{ ...inputStyle, border:'1px solid var(--border)', padding:10 }} rows={2} value={form.description} onChange={e => set('description',e.target.value)} /></Field>
    <div style={gridStyle}><Field label="啟用方式"><select aria-label="啟用方式" style={inputStyle} value={form.activation_type} onChange={e => set('activation_type',e.target.value)}><option value="automatic">自動活動</option><option value="coupon_only">優惠券專用</option></select></Field><Field label="優惠類型"><select aria-label="優惠類型" style={inputStyle} value={form.benefit_type} onChange={e => set('benefit_type',e.target.value)}><option value="percentage_discount">百分比折扣</option><option value="fixed_discount">固定金額折抵</option><option value="amount_gift">滿額贈</option><option value="quantity_gift">滿件贈</option></select></Field>{form.benefit_type === 'percentage_discount' ? <Field label="折扣百分比（% OFF）"><input aria-label="折扣百分比（% OFF）" type="number" min="1" max="100" style={inputStyle} value={form.percent} onChange={e => set('percent',e.target.value)} /></Field> : form.benefit_type === 'fixed_discount' ? <Field label="折抵金額（NT$）"><input aria-label="折抵金額（NT$）" type="number" min="1" style={inputStyle} value={form.amount} onChange={e => set('amount',e.target.value)} /></Field> : null}</div>
    <div style={gridStyle}>{!isGift && <Field label="門檻類型"><select aria-label="門檻類型" style={inputStyle} value={form.threshold_type} onChange={e => set('threshold_type',e.target.value)}><option value="amount">滿額</option><option value="quantity">滿件</option></select></Field>}<Field label={form.benefit_type === 'quantity_gift' ? '滿幾件贈送 *' : isGift ? '滿額門檻（NT$）*' : form.threshold_type === 'quantity' ? '最低適用件數（選填）' : '最低適用金額（選填）'}><input type="number" min="1" step={form.threshold_type === 'quantity' ? '1' : undefined} style={inputStyle} value={form.threshold_value} onChange={e => set('threshold_value',e.target.value)} /></Field>{isGift && <><Field label="贈品庫存 *"><select aria-label="贈品庫存" style={inputStyle} value={form.gift_variant_id} onChange={e => set('gift_variant_id',e.target.value)}><option value="">請選擇贈品</option>{giftVariants.map(variant => <option key={variant.id} value={variant.id}>[{variant.sourceLabel}] {variant.productName} · {variant.size} · {variant.sku}（庫存 {variant.giftStock}）</option>)}</select></Field><Field label="每次贈送數量 *"><input type="number" min="1" style={inputStyle} value={form.gift_quantity} onChange={e => set('gift_quantity',e.target.value)} /></Field><Field label="達標方式"><select style={inputStyle} value={form.repeat_mode} onChange={e => set('repeat_mode',e.target.value)}><option value="once">每筆訂單只贈一次</option><option value="repeat">每達門檻重複贈送</option></select></Field></>}<Field label="開始時間（選填）"><input type="datetime-local" style={inputStyle} value={form.start_at} onChange={e => set('start_at',e.target.value)} /></Field><Field label="結束時間（選填）"><input type="datetime-local" style={inputStyle} value={form.end_at} onChange={e => set('end_at',e.target.value)} /></Field></div>
    {isGift && !giftVariants.length && <p role="alert" style={{ fontSize:12, color:'var(--red)' }}>目前沒有啟用中的贈品庫存，請先到商品與庫存的商品編輯頁設定。</p>}
    <Field label="適用範圍"><div style={{ display:'flex', gap:18, fontSize:13 }}><label><input type="radio" checked={form.scope_type === 'all_regular'} onChange={() => set('scope_type','all_regular')} /> 全館一般商品</label><label><input type="radio" checked={form.scope_type === 'products'} onChange={() => set('scope_type','products')} /> 指定商品</label></div><p style={{ fontSize:11, color:'var(--mid)', marginTop:7 }}>「全館一般商品」不包含活動限定與贈品；活動限定商品可在指定商品中單獨選取。</p></Field>
    {form.scope_type === 'products' && <ProductPicker
      products={selectableProducts}
      selected={form.product_ids}
      onToggle={toggle}
      onSelectAll={() => set('product_ids', new Set(selectableProducts.map(product => product.id)))}
      onClear={() => set('product_ids', new Set())}
    />}
    <SaveButtons saving={saving} onClose={onClose} label={promo ? '儲存變更' : '建立活動'} />
  </form></Editor>;
}

function CouponForm({ coupon, promotions, linkedIds, onClose }) {
  const [form,setForm] = useState({ name:coupon?.name || '', code:coupon?.code || '', description:coupon?.description || '', promotion_ids:new Set(linkedIds), start_at:toLocalInput(coupon?.start_at), end_at:toLocalInput(coupon?.end_at), total_usage_limit:coupon?.total_usage_limit || '', per_member_limit:coupon?.per_member_limit || '', audience_roles:new Set(coupon?.audience_roles || ROLES.map(([role]) => role)), allow_guest:coupon?.allow_guest ?? true, stacking_policy:coupon?.stacking_policy || 'allow_auto_gifts', active:coupon?.active ?? true });
  const [saving,setSaving] = useState(false); const [error,setError] = useState('');
  const set = (key,value) => setForm(current => ({ ...current, [key]:value }));
  function toggleSet(key,value) { const next = new Set(form[key]); next.has(value) ? next.delete(value) : next.add(value); set(key,next); }
  async function save(event) {
    event.preventDefault(); setError('');
    if (!form.name.trim() || !form.code.trim()) return setError('請輸入優惠券名稱與代碼');
    if (!form.promotion_ids.size) return setError('請至少打包一個優惠券專用活動');
    if (!form.audience_roles.size) return setError('請至少選擇一種適用會員');
    if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) return setError('結束時間必須晚於開始時間');
    setSaving(true);
    const payload = { id:coupon?.id || null, ...form, code:form.code.trim().toUpperCase(), promotion_ids:[...form.promotion_ids], audience_roles:[...form.audience_roles], total_usage_limit:form.total_usage_limit === '' ? null : Number(form.total_usage_limit), per_member_limit:form.per_member_limit === '' ? null : Number(form.per_member_limit), start_at:form.start_at ? new Date(form.start_at).toISOString() : null, end_at:form.end_at ? new Date(form.end_at).toISOString() : null };
    const { error:saveError } = await supabase.rpc('save_coupon_campaign', { p_payload:payload }); setSaving(false);
    if (saveError) setError(`儲存失敗：${saveError.message}`); else onClose();
  }
  return <Editor title={coupon ? '編輯優惠券' : '新增優惠券'} back="返回優惠券列表" onClose={onClose} error={error}><form onSubmit={save} style={{ ...panelStyle, display:'flex', flexDirection:'column', gap:22 }}>
    <div style={gridStyle}><Field label="優惠券名稱 *"><input aria-label="優惠券名稱 *" style={inputStyle} value={form.name} onChange={e => set('name',e.target.value)} /></Field><Field label="優惠碼 *"><input aria-label="優惠碼 *" style={{ ...inputStyle, textTransform:'uppercase', letterSpacing:'0.12em' }} value={form.code} onChange={e => set('code',e.target.value.toUpperCase())} /></Field></div>
    <Field label="顧客說明（選填）"><textarea style={{ ...inputStyle, border:'1px solid var(--border)', padding:10 }} rows={2} value={form.description} onChange={e => set('description',e.target.value)} /></Field>
    <Field label={`打包優惠活動 *（已選 ${form.promotion_ids.size}）`}>{!promotions.length ? <p style={{ fontSize:12, color:'var(--red)' }}>請先到「優惠活動」建立啟用方式為「優惠券專用」的活動。</p> : <div style={{ display:'grid', gap:8 }}>{promotions.map(promotion => <label key={promotion.id} style={{ border:'1px solid var(--border)', padding:'10px 12px', fontSize:12, background:form.promotion_ids.has(promotion.id) ? 'var(--off)' : '#fff' }}><input type="checkbox" checked={form.promotion_ids.has(promotion.id)} onChange={() => toggleSet('promotion_ids',promotion.id)} /> {promotion.name} · {getBenefitLabel(promotion, [])}</label>)}</div>}</Field>
    <div style={gridStyle}><Field label="總使用上限（選填）"><input type="number" min="1" style={inputStyle} value={form.total_usage_limit} onChange={e => set('total_usage_limit',e.target.value)} /></Field><Field label="每位會員／訪客上限（選填）"><input type="number" min="1" style={inputStyle} value={form.per_member_limit} onChange={e => set('per_member_limit',e.target.value)} /></Field><Field label="與自動活動疊加"><select style={inputStyle} value={form.stacking_policy} onChange={e => set('stacking_policy',e.target.value)}><option value="coupon_only">只套用優惠券</option><option value="allow_auto_gifts">優惠券＋自動贈品</option><option value="allow_all">優惠券＋自動折扣＋自動贈品</option></select></Field></div>
    <Field label="適用會員"><div style={{ display:'flex', flexWrap:'wrap', gap:16 }}>{ROLES.map(([role,label]) => <label key={role} style={{ fontSize:13 }}><input type="checkbox" checked={form.audience_roles.has(role)} onChange={() => toggleSet('audience_roles',role)} /> {label}</label>)}<label style={{ fontSize:13 }}><input type="checkbox" checked={form.allow_guest} onChange={e => set('allow_guest',e.target.checked)} /> 允許訪客</label></div></Field>
    <div style={gridStyle}><Field label="開始時間（選填）"><input type="datetime-local" style={inputStyle} value={form.start_at} onChange={e => set('start_at',e.target.value)} /></Field><Field label="結束時間（選填）"><input type="datetime-local" style={inputStyle} value={form.end_at} onChange={e => set('end_at',e.target.value)} /></Field></div>
    <SaveButtons saving={saving} onClose={onClose} label={coupon ? '儲存變更' : '建立優惠券'} />
  </form></Editor>;
}

function ProductPicker({ products, selected, onToggle, onSelectAll, onClear }) {
  const allSelected = products.length > 0 && products.every(product => selected.has(product.id));
  return <div>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:8, flexWrap:'wrap' }}>
      <span style={{ ...labelStyle, marginBottom:0 }}>指定商品（已選 {selected.size}）</span>
      <div style={{ display:'flex', gap:6 }}>
        <button type="button" onClick={onSelectAll} disabled={allSelected || !products.length} style={{ ...secondaryButton, flex:'none', padding:'6px 12px', opacity:allSelected || !products.length ? 0.45 : 1 }}>全選</button>
        <button type="button" onClick={onClear} disabled={!selected.size} style={{ ...secondaryButton, flex:'none', padding:'6px 12px', opacity:selected.size ? 1 : 0.45 }}>全取消</button>
      </div>
    </div>
    <div style={{ maxHeight:360, overflow:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))', gap:7, border:'1px solid var(--border)', padding:10 }}>{products.map(product => <label key={product.id} style={{ padding:'8px 9px', fontSize:12, border:`1px solid ${selected.has(product.id) ? 'var(--gold)' : 'transparent'}`, background:selected.has(product.id) ? '#fff' : 'var(--off)' }}><input type="checkbox" checked={selected.has(product.id)} onChange={() => onToggle(product.id)} /> {product.nameZh}<small style={{ display:'block', color:'var(--mid)', marginLeft:18 }}>{product.publicationStatus === 'event_only' ? '活動限定' : '一般商品'}</small></label>)}</div>
  </div>;
}
function getBenefitLabel(promotion, products) {
  if (!promotion?.benefit_type || promotion.benefit_type === 'legacy_discount') return `舊版複合折扣 · × ${promotion?.discount_rate} − NT$ ${Number(promotion?.discount_amount || 0).toLocaleString()}`;
  if (promotion.benefit_type === 'percentage_discount') return `${Math.round((1 - Number(promotion.discount_rate)) * 100)}% OFF`;
  if (promotion.benefit_type === 'fixed_discount') return `折抵 NT$ ${Number(promotion.discount_amount).toLocaleString()}`;
  const giftProduct = products.find(product => (product.variants || []).some(variant => Number(variant.id) === Number(promotion.gift_variant_id)));
  const giftVariant = giftProduct?.variants?.find(variant => Number(variant.id) === Number(promotion.gift_variant_id));
  return `${promotion.benefit_type === 'amount_gift' ? '滿額贈' : '滿件贈'} · ${giftProduct?.nameZh || '贈品'}${giftVariant?.size ? ` ${giftVariant.size}` : ''} × ${promotion.gift_quantity || 1}`;
}
function Editor({ title, back, onClose, error, children }) { return <div><button onClick={onClose} style={{ background:'none', border:'none', padding:0, color:'var(--mid)', cursor:'pointer', fontSize:12, marginBottom:7 }}>← {back}</button><h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400, marginBottom:24 }}>{title}</h1>{error && <div role="alert" style={{ maxWidth:920, color:'var(--red)', background:'oklch(0.60 0.18 25 / 0.08)', border:'1px solid oklch(0.60 0.18 25 / 0.3)', padding:'10px 14px', marginBottom:16, fontSize:13 }}>{error}</div>}{children}</div>; }
function Field({ label, children }) { return <div><label style={labelStyle}>{label}</label>{children}</div>; }
function Card({ children }) { return <div style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'20px 22px', display:'flex', flexDirection:'column', gap:13, minHeight:190 }}>{children}</div>; }
function Empty({ text }) { return <div style={{ padding:48, textAlign:'center', color:'var(--mid)', border:'1px solid var(--border)', background:'var(--white)', fontSize:13 }}>{text}</div>; }
function SaveButtons({ saving, onClose, label }) { return <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}><button type="button" onClick={onClose} style={{ ...secondaryButton, flex:'none', padding:'11px 22px' }}>取消</button><button disabled={saving} style={{ padding:'11px 26px', border:'none', background:saving ? 'var(--mid)' : 'var(--dark)', color:'#fff', cursor:saving ? 'wait' : 'pointer', fontSize:12 }}>{saving ? '儲存中…' : label}</button></div>; }
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0,16); }
function stackingLabel(value) { return value === 'allow_all' ? '含自動折扣' : value === 'allow_auto_gifts' ? '僅自動贈品' : '只用優惠券'; }
