import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import { getPromotionPhase } from '../components/StatusIndicators.jsx';

import PromotionLabel from '../../components/product/PromotionLabel.jsx';
import { DEFAULT_PROMOTION_LABEL_COLOR, getPromotionLabelColor } from '../../domain/promotions.js';

import SiteAnnouncementSettings from '../components/SiteAnnouncementSettings.jsx';

const ROLES = [['consumer', '一般會員'], ['pro', '美容師'], ['instructor', '師資'], ['distributor', '經銷商'], ['staff', '內部人員']];
const DEFAULT_AUDIENCE_ROLES = ROLES.filter(([role]) => role !== 'staff').map(([role]) => role);
const inputStyle = { width:'100%', border:'none', borderBottom:'1px solid var(--border)', padding:'10px 0', fontSize:14, outline:'none', background:'none', boxSizing:'border-box' };
const labelStyle = { fontSize:11, letterSpacing:'0.12em', color:'var(--mid)', display:'block', marginBottom:8 };
const panelStyle = { background:'var(--white)', border:'1px solid var(--border)', padding:'clamp(20px, 4vw, 32px)', maxWidth:920 };
const gridStyle = { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:20 };
const secondaryButton = { flex:1, padding:'8px', background:'var(--off)', color:'var(--dark)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer' };

export default function Promotions({ products }) {
  const [tab, setTab] = useState('promotions');
  const [showArchived, setShowArchived] = useState(false);
  const [promotions, setPromotions] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [links, setLinks] = useState([]);
  const [couponMembers, setCouponMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPromotion, setEditingPromotion] = useState(null);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [policyInstalled, setPolicyInstalled] = useState(false);

  async function load() {
    setLoading(true); setLoadError('');
    const [promotionResult, scopeResult, couponResult, linkResult, memberLinkResult, policyResult] = await Promise.all([
      supabase.from('promotions').select('*').order('created_at', { ascending:false }),
      supabase.from('promotion_scopes').select('*'),
      supabase.from('coupon_campaigns').select('*').order('created_at', { ascending:false }),
      supabase.from('coupon_promotions').select('*').order('sort_order'),
      supabase.from('coupon_campaign_members').select('coupon_campaign_id,user_id'),
      supabase.from('promotions').select('allow_student_price_stacking,instructor_reward_eligible').limit(0),
    ]);
    const error = promotionResult.error || scopeResult.error || couponResult.error || linkResult.error || memberLinkResult.error;
    if (error) setLoadError(`載入失敗：${error.message}`);
    setPromotions(promotionResult.data || []); setScopes(scopeResult.data || []);
    setCoupons(couponResult.data || []); setLinks(linkResult.data || []);
    setCouponMembers(memberLinkResult.data || []); setLoading(false);
    setPolicyInstalled(!policyResult.error);
  }

  function copyPromotion(promo) {
    const sourceScopes = scopes.filter(scope => scope.promotion_id === promo.id);
    const benefitScopes = sourceScopes.filter(scope => scope.scope_role === 'benefit');
    const representable = benefitScopes.every(scope => scope.target_type === 'product') || benefitScopes.length === 1;
    const supported = representable && sourceScopes.every(scope => scope.mode === 'include'
      && ['product','all_regular','all_sellable'].includes(scope.target_type) && !scope.product_variant_id);
    const scopeKeys = role => sourceScopes.filter(scope => scope.scope_role === role)
      .map(scope => `${scope.target_type}:${scope.product_id ?? ''}`).sort().join('|');
    if (!supported || !scopeKeys('benefit') || scopeKeys('benefit') !== scopeKeys('qualification')) {
      alert('此活動含目前表單不支援的商品範圍，無法直接複製。請新增活動並重新設定範圍。');
      return;
    }
    setEditingPromotion({ ...promo, copySourceId:promo.id, id:null, name:`${promo.name}（副本）`, active:false, archived_at:null });
  }

  useEffect(() => { load(); }, []);

  if (editingPromotion) return <DiscountPromotionForm policyInstalled={policyInstalled} promo={editingPromotion === 'new' ? null : editingPromotion} products={products} scopes={scopes} onClose={() => { setEditingPromotion(null); load(); }} />;
  if (editingCoupon) return <CouponForm coupon={editingCoupon === 'new' ? null : editingCoupon} promotions={promotions.filter(p => p.activation_type === 'coupon_only' && !p.archived_at && ['percentage_discount', 'fixed_discount', 'amount_gift', 'quantity_gift', 'buy_x_get_y'].includes(p.benefit_type))} linkedIds={editingCoupon === 'new' ? [] : links.filter(link => link.coupon_campaign_id === editingCoupon.id).map(link => link.promotion_id)} linkedMemberIds={editingCoupon === 'new' ? [] : couponMembers.filter(link => link.coupon_campaign_id === editingCoupon.id).map(link => link.user_id)} onClose={() => { setEditingCoupon(null); load(); }} />;

  return <div>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:16, flexWrap:'wrap' }}>
      <h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400 }}>活動與優惠券</h1>
      {tab !== 'announcement' && <button onClick={() => tab === 'promotions' ? setEditingPromotion('new') : setEditingCoupon('new')} style={{ padding:'10px 22px', background:'var(--dark)', color:'#fff', border:'none', fontSize:12, letterSpacing:'0.12em', cursor:'pointer' }}>+ {tab === 'promotions' ? '新增優惠活動' : '新增優惠券'}</button>}
    </div>
    <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:24 }}>
      {[['promotions','優惠活動'],['coupons','優惠券方案'],['announcement','全站公告']].map(([value,label]) => <button key={value} onClick={() => setTab(value)} style={{ padding:'11px 20px', border:'none', borderBottom:tab === value ? '2px solid var(--dark)' : '2px solid transparent', background:'none', color:tab === value ? 'var(--dark)' : 'var(--mid)', cursor:'pointer', fontSize:13 }}>{label}</button>)}
    </div>
    {tab !== 'announcement' && <div aria-label="封存篩選" style={{ display:'flex', gap:8, marginBottom:18 }}>{[[false,tab === 'promotions' ? '活動列表' : '優惠券列表'],[true,tab === 'promotions' ? '封存活動' : '封存優惠券']].map(([value,label]) => <button key={label} type="button" aria-pressed={showArchived === value} onClick={() => setShowArchived(value)} style={{ ...secondaryButton, flex:'none', borderColor:showArchived === value ? 'var(--dark)' : 'var(--border)' }}>{label}</button>)}</div>}
    {tab !== 'announcement' && loadError && <div role="alert" style={{ marginBottom:16, color:'var(--red)', fontSize:13 }}>{loadError}</div>}
    {tab === 'announcement' ? <SiteAnnouncementSettings /> : loading ? <Empty text="載入中…" /> : tab === 'promotions' ? <PromotionList list={promotions.filter(p => Boolean(p.archived_at) === showArchived)} scopes={scopes} products={products} onEdit={setEditingPromotion} onCopy={copyPromotion} onReload={load} /> : <CouponList list={coupons.filter(c => Boolean(c.archived_at) === showArchived)} links={links} memberLinks={couponMembers} promotions={promotions} onEdit={setEditingCoupon} onReload={load} />}
  </div>;
}

function LifecycleActions({ item, table, noun, onReload, children, actions }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(action) {
    const messages = {
      toggle: item.active ? `確定停用${noun}「${item.name}」？仍可編輯並重新啟用。` : `確定啟用${noun}「${item.name}」？符合活動時間與資格後即可使用。`,
      archive: `確定封存${noun}「${item.name}」？將停止使用並移至已封存列表，既有訂單與紀錄保留。`,
      restore: `確定還原${noun}「${item.name}」？還原後保持停用，確認設定後再啟用。`,
    };
    if (busy || !confirm(messages[action])) return;
    setBusy(true); setError('');
    try {
      const patch = action === 'toggle' ? { active:!item.active }
        : { active:false, archived_at:action === 'archive' ? new Date().toISOString() : null };
      let query = supabase.from(table).update(patch).eq('id', item.id).eq('active', item.active);
      query = item.archived_at ? query.eq('archived_at', item.archived_at) : query.is('archived_at', null);
      const { data, error:writeError } = await query.select('id');
      if (writeError) throw writeError;
      if (!data?.length) throw new Error('狀態已變更或沒有操作權限，請重新整理後再試。');
      await onReload();
    } catch (failure) { setError(`操作失敗：${failure.message}`); }
    finally { setBusy(false); }
  }
  const phase = getPromotionPhase(item);
  const dateText = value => new Date(value).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
  return <>
    {item.archived_at ? <span style={{ fontSize:12, color:'var(--mid)' }}>已封存</span> : <div style={{ padding:'2px 0 12px', borderBottom:'1px solid var(--border)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <span style={{ padding:'4px 9px', borderRadius:3, fontSize:12, fontWeight:500, background:!item.active || phase === 'expired' ? '#f0f0ee' : phase === 'scheduled' ? '#f5f0e5' : '#edf6ef', color:!item.active || phase === 'expired' ? '#686864' : phase === 'scheduled' ? '#8a713b' : '#287a50' }}>{!item.active ? '已停用' : phase === 'scheduled' ? '排程中' : phase === 'live' ? '進行中' : '已結束'}</span>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ fontSize:11, color:'var(--mid)' }}>{item.active ? '已啟用' : '已停用'}</span>
          <button type="button" role="switch" aria-label={`${noun}啟用狀態`} aria-checked={!!item.active} disabled={busy} onClick={() => change('toggle')} style={{ position:'relative', width:36, height:22, border:0, borderRadius:20, background:item.active ? '#287a50' : '#aaa', cursor:busy ? 'wait' : 'pointer', opacity:busy ? 0.6 : 1, flexShrink:0 }}><span style={{ position:'absolute', top:3, left:item.active ? 17 : 3, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left .15s' }} /></button>
        </div>
      </div>
      <div style={{ marginTop:8, fontSize:11, color:'var(--mid)', lineHeight:1.6 }}>
        {phase === 'scheduled' && item.start_at && <span>{!item.active ? '原排程：' : ''}{dateText(item.start_at)} 開始（台灣時間）</span>}
        {phase === 'live' && <span>{!item.active ? '活動期間內' : '活動期間'}{item.end_at ? ` · 至 ${dateText(item.end_at)}（台灣時間）` : ' · 未設定結束時間'}</span>}
        {phase === 'expired' && item.end_at && <span>{dateText(item.end_at)} 已結束（台灣時間）</span>}
      </div>
      {!item.active && <p style={{ margin:'5px 0 0', fontSize:11, color:'var(--mid)' }}>{phase === 'scheduled' ? '到達開始時間仍不生效，需手動啟用。' : '目前不會套用，啟用後仍須符合活動期間與資格。'}</p>}
    </div>}
    {children}
    <div style={{ marginTop:'auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {item.archived_at ? <button disabled={busy} onClick={() => change('restore')} style={secondaryButton}>還原</button> : <>
          {actions}
          <button disabled={busy} onClick={() => change('archive')} style={{ padding:'8px 4px', marginLeft:'auto', border:0, background:'transparent', color:'var(--mid)', cursor:'pointer', fontSize:12 }}>封存</button>
        </>}
      </div>
      {error && <p role="alert" style={{ fontSize:12, color:'var(--red)' }}>{error}</p>}
    </div>
  </>;

}

function PromotionList({ list, scopes, products, onEdit, onCopy, onReload }) {
  if (!list.length) return <Empty text="目前還沒有優惠活動" />;
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
    {list.map(promo => {
      const promoScopes = scopes.filter(scope => scope.promotion_id === promo.id && scope.scope_role === 'benefit' && scope.mode === 'include');
      const allRegular = promoScopes.some(scope => scope.target_type === 'all_regular');
      const allSellable = promoScopes.some(scope => scope.target_type === 'all_sellable');
      const names = promoScopes.filter(scope => scope.target_type === 'product').map(scope => products.find(product => product.id === scope.product_id)?.nameZh).filter(Boolean);
      const legacy = !promo.benefit_type || promo.benefit_type === 'legacy_discount';
      return <Card key={promo.id}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}><div><h3 style={{ fontSize:15, fontWeight:500, marginBottom:6 }}>{promo.name}</h3></div><span style={{ fontSize:10, color:'var(--mid)' }}>{promo.activation_type === 'coupon_only' ? '優惠券專用' : '自動活動'}</span></div>
        <LifecycleActions item={promo} table="promotions" noun="活動" onReload={onReload} actions={<>
          <button onClick={() => onEdit(promo)} style={{ ...secondaryButton, background:'var(--dark)', color:'#fff' }}>編輯活動</button>
          {!legacy && <button onClick={() => onCopy(promo)} style={secondaryButton}>複製</button>}
        </>}>
        {supportsStudentPolicy(promo) && <p style={{ fontSize:11, color:'var(--mid)' }}>學生價：{promo.allow_student_price_stacking === false ? '不疊加，與學生價擇優' : '可疊加'} · 活動參與件：{promo.instructor_reward_eligible === false ? '不計師資返饋' : '正常計師資返饋'}</p>}
        <div style={{ background:'var(--off)', padding:'11px 12px', borderLeft:'2px solid var(--gold)', fontSize:12 }}>{getBenefitLabel(promo, products)}</div>
        <div style={{ fontSize:11, color:'var(--mid)', lineHeight:1.7 }}>適用：{legacy ? `${(promo.product_ids || []).length} 件既有指定商品` : allSellable ? '全館商品（含活動限定）' : allRegular ? '全館一般商品' : names.length ? names.join('、') : '尚未設定範圍'}{promo.threshold_value && <div>門檻：{promo.benefit_type === 'quantity_gift' || promo.threshold_type === 'quantity' ? `滿 ${Number(promo.threshold_value)} 件` : `滿 NT$ ${Number(promo.threshold_value).toLocaleString()}`}</div>}</div>
        {promo.activation_type !== 'coupon_only' && <div style={{ fontSize:11, color:'var(--mid)', lineHeight:1.7 }}>適用對象：{[...ROLES.filter(([role]) => (promo.audience_roles ?? ROLES.map(([key]) => key)).includes(role)).map(([,label]) => label), ...((promo.allow_guest ?? true) ? ['訪客'] : [])].join('、') || '無'}</div>}
        </LifecycleActions>
      </Card>;
    })}
  </div>;
}

function CouponList({ list, links, memberLinks, promotions, onEdit, onReload }) {
  if (!list.length) return <Empty text="目前還沒有優惠券方案" />;
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>{list.map(coupon => {
    const benefitNames = links.filter(link => link.coupon_campaign_id === coupon.id).map(link => promotions.find(p => p.id === link.promotion_id)?.name).filter(Boolean);
    const targetMemberCount = memberLinks.filter(link => link.coupon_campaign_id === coupon.id).length;
    const audienceLabel = coupon.audience_mode === 'members' ? `指定會員 ${targetMemberCount} 位` : `依會員身分${coupon.allow_guest ? '（含訪客）' : ''}`;
    return <Card key={coupon.id}><div style={{ display:'flex', justifyContent:'space-between', gap:12 }}><div><h3 style={{ fontSize:15, marginBottom:5 }}>{coupon.name}</h3><code style={{ color:'var(--gold)', letterSpacing:'0.12em' }}>{coupon.code}</code></div></div><LifecycleActions item={coupon} table="coupon_campaigns" noun="優惠券" onReload={onReload} actions={<button onClick={() => onEdit(coupon)} style={{ ...secondaryButton, background:'var(--dark)', color:'#fff' }}>編輯優惠券</button>}><div style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>{benefitNames.join(' ＋ ') || '尚未連結折扣活動'}</div><div style={{ fontSize:11, color:'var(--mid)', lineHeight:1.7 }}>適用：{audienceLabel}<br />每人上限：{coupon.per_member_limit || '不限'} 次 · 總上限：{coupon.total_usage_limit || '不限'} 次<br />疊加：{stackingLabel(coupon.stacking_policy)}</div></LifecycleActions></Card>;
  })}</div>;
}

function DiscountPromotionForm({ promo, products, scopes, onClose, policyInstalled = false }) {
  const legacy = Boolean(promo?.id && (!promo.benefit_type || promo.benefit_type === 'legacy_discount'));
  const benefitScopes = scopes.filter(scope => scope.promotion_id === (promo?.copySourceId || promo?.id) && scope.scope_role === 'benefit' && scope.mode === 'include');
  const initialAllRegular = benefitScopes.some(scope => scope.target_type === 'all_regular') || !promo;
  const initialAllSellable = benefitScopes.some(scope => scope.target_type === 'all_sellable');
  const [form, setForm] = useState({ allow_student_price_stacking:promo?.allow_student_price_stacking ?? true, instructor_reward_eligible:promo?.instructor_reward_eligible ?? true, name:promo?.name || '', label_text:promo?.label_text || '', label_color:getPromotionLabelColor(promo?.label_color), description:promo?.description || '', benefit_type:promo?.benefit_type || 'percentage_discount', activation_type:promo?.activation_type || 'automatic', percent:promo ? Number(((1 - Number(promo.discount_rate)) * 100).toFixed(10)) : 10, amount:promo?.discount_amount || 100, threshold_value:promo?.threshold_value || '', threshold_type:promo?.threshold_type || (promo?.benefit_type === 'quantity_gift' ? 'quantity' : 'amount'), threshold_basis:promo?.threshold_basis || 'before_bundle_discount', gift_variant_id:promo?.gift_variant_id || '', gift_quantity:promo?.gift_quantity || 1, buy_quantity:promo?.buy_quantity || 3, repeat_mode:promo?.repeat_mode || 'once', scope_type:initialAllSellable ? 'all_sellable' : initialAllRegular ? 'all_regular' : 'products', product_ids:new Set(benefitScopes.filter(scope => scope.target_type === 'product').map(scope => scope.product_id)), start_at:toLocalInput(promo?.start_at), end_at:toLocalInput(promo?.end_at), active:promo?.active ?? true, audience_roles:new Set(promo?.audience_roles ?? ROLES.map(([role]) => role)), allow_guest:promo?.allow_guest ?? true });
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
  const isBuyXGetY = form.benefit_type === 'buy_x_get_y';
  const set = (key,value) => setForm(current => ({ ...current, [key]:value }));
  function toggle(id) { const next = new Set(form.product_ids); next.has(id) ? next.delete(id) : next.add(id); set('product_ids', next); }
  async function save(event) {
    event.preventDefault(); setError('');
    if (legacy) {
      if (!policyInstalled || !supportsStudentPolicy(promo)) return;
      setSaving(true);
      const { error:saveError } = await supabase.rpc('save_promotion_student_policy', {
        p_id:promo.id, p_allow_stacking:form.allow_student_price_stacking,
        p_reward_eligible:form.instructor_reward_eligible, p_expected_updated_at:promo.updated_at,
      });
      setSaving(false);
      if (saveError) setError(`儲存失敗：${saveError.message}`); else onClose();
      return;
    }
    if (!form.name.trim()) return setError('請輸入活動名稱');
    if (form.activation_type === 'automatic' && !form.audience_roles.size && !form.allow_guest) return setError('請至少選擇一種會員身分或允許訪客');
    if (form.scope_type === 'products' && !form.product_ids.size) return setError('請至少選擇一件商品');
    if (isGift && (!form.gift_variant_id || Number(form.threshold_value) <= 0 || Number(form.gift_quantity) <= 0)) return setError('請設定門檻、贈品與贈送數量');
    if (isBuyXGetY && (!Number.isInteger(Number(form.buy_quantity)) || Number(form.buy_quantity) < 1 || !Number.isInteger(Number(form.gift_quantity)) || Number(form.gift_quantity) < 1 || Number(form.buy_quantity) + Number(form.gift_quantity) > 2147483647)) return setError('買入與免費件數必須為正整數，且合計不可超出整數範圍');
    if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) return setError('結束時間必須晚於開始時間');
    setSaving(true);
    const thresholdType = (form.benefit_type === 'quantity_gift' || isBuyXGetY) ? 'quantity' : form.benefit_type === 'amount_gift' ? 'amount' : form.threshold_type;
    const payload = { id:promo?.id || null, priority:promo?.priority ?? 100, name:form.name.trim(), label_text:form.label_text.trim(), label_color:form.label_color, description:form.description.trim(), benefit_type:form.benefit_type, activation_type:form.activation_type, discount_rate:form.benefit_type === 'percentage_discount' ? 1 - Number(form.percent) / 100 : 1, discount_amount:form.benefit_type === 'fixed_discount' ? Number(form.amount) : 0, threshold_value:isBuyXGetY ? Number(form.buy_quantity) + Number(form.gift_quantity) : form.threshold_value === '' ? null : Number(form.threshold_value), threshold_type:thresholdType, threshold_basis:!isGift && !isBuyXGetY && thresholdType === 'amount' && form.threshold_value !== '' ? form.threshold_basis : null, gift_variant_id:isGift ? Number(form.gift_variant_id) : null, gift_quantity:(isGift || isBuyXGetY) ? Number(form.gift_quantity) : null, buy_quantity:isBuyXGetY ? Number(form.buy_quantity) : null, repeat_mode:(isGift || isBuyXGetY) ? form.repeat_mode : 'once', scope_type:form.scope_type, product_ids:[...form.product_ids], start_at:form.start_at ? new Date(form.start_at).toISOString() : null, end_at:form.end_at ? new Date(form.end_at).toISOString() : null, active:form.active };
    if (policyInstalled) {
      payload.allow_student_price_stacking = supportsStudentPolicy(form) ? form.allow_student_price_stacking : true;
      payload.instructor_reward_eligible = supportsStudentPolicy(form) ? form.instructor_reward_eligible : true;
    }
    if (form.activation_type === 'automatic') { payload.audience_roles = [...form.audience_roles]; payload.allow_guest = form.allow_guest; }
    const { error:saveError } = await supabase.rpc('save_discount_promotion', { p_payload:payload }); setSaving(false);
    if (saveError) setError(`儲存失敗：${saveError.message}`); else onClose();
  }
  return <Editor title={promo?.copySourceId ? '複製優惠活動' : promo?.id ? '編輯優惠活動' : '新增優惠活動'} back="返回活動列表" onClose={onClose} error={error}><form onSubmit={save} style={{ ...panelStyle, display:'flex', flexDirection:'column', gap:22 }}>
    {promo?.copySourceId && <p role="status" style={{ fontSize:12, color:'var(--mid)' }}>已帶入原活動設定，儲存後建立獨立且預設停用的活動；請確認名稱、適用對象與活動時間。</p>}
    {legacy ? <>
      <Field label="活動名稱"><input aria-label="活動名稱" style={inputStyle} value={promo.name} disabled /></Field>
      <Field label="優惠內容"><p style={{ fontSize:13, lineHeight:1.7 }}>{getBenefitLabel(promo, products)}</p></Field>
      <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.7 }}>此為舊版複合活動，原優惠條件與商品範圍維持唯讀；可在此調整學生價與師資返饋設定。</p>
    </> : <>
    <Field label="活動狀態"><label style={{ fontSize:13 }}><input type="checkbox" checked={form.active} onChange={e => set('active',e.target.checked)} /> 啟用活動</label></Field>
    <Field label="活動名稱 *"><input style={inputStyle} value={form.name} onChange={e => set('name',e.target.value)} placeholder="例：秋季保養 9 折" /></Field>
    <Field label="活動標籤（選填）">
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <input aria-label="活動標籤" maxLength={20} value={form.label_text} onChange={e => set('label_text',e.target.value)} placeholder="例：限時 9 折" style={{ ...inputStyle, flex:'1 1 180px', width:'auto' }} />
        <input aria-label="活動標籤顏色" type="color" value={form.label_color || DEFAULT_PROMOTION_LABEL_COLOR} onChange={e => set('label_color',e.target.value)} style={{ width:34, height:34, padding:2, border:'1px solid var(--border)', background:'none', cursor:'pointer' }} />
        <div aria-label="活動標籤預覽" style={{ minWidth:110 }}><PromotionLabel text={form.label_text.trim() || '標籤預覽'} color={form.label_color} /></div>
      </div>
      <p style={{ fontSize:11, color:'var(--mid)', marginTop:7 }}>最多 20 字；生效的指定商品自動活動會顯示在商品小卡左上角，留空則不顯示標籤。全館活動暫不顯示。</p>
    </Field>
    <Field label="顧客說明（選填）"><textarea aria-label="顧客說明" placeholder="顯示於指定商品詳情的完整活動說明" style={{ ...inputStyle, border:'1px solid var(--border)', padding:10 }} rows={2} value={form.description} onChange={e => set('description',e.target.value)} /></Field>
    <div style={gridStyle}><Field label="啟用方式"><select aria-label="啟用方式" style={inputStyle} value={form.activation_type} onChange={e => set('activation_type',e.target.value)}><option value="automatic">自動活動</option><option value="coupon_only">優惠券專用</option></select></Field><Field label="優惠類型"><select aria-label="優惠類型" style={inputStyle} value={form.benefit_type} onChange={e => set('benefit_type',e.target.value)}><option value="percentage_discount">百分比折扣</option><option value="fixed_discount">固定金額折抵</option><option value="amount_gift">滿額贈</option><option value="quantity_gift">滿件贈</option><option value="buy_x_get_y">買 X 送 Y（最低價免費）</option></select></Field>{form.benefit_type === 'percentage_discount' ? <Field label="折扣百分比（% OFF）"><input aria-label="折扣百分比（% OFF）" type="number" step="any" min="1" max="100" style={inputStyle} value={form.percent} onChange={e => set('percent',e.target.value)} /></Field> : form.benefit_type === 'fixed_discount' ? <Field label="折抵金額（NT$）"><input aria-label="折抵金額（NT$）" type="number" min="1" style={inputStyle} value={form.amount} onChange={e => set('amount',e.target.value)} /></Field> : null}</div>
    <div style={gridStyle}>{!isGift && !isBuyXGetY && <Field label="門檻類型"><select aria-label="門檻類型" style={inputStyle} value={form.threshold_type} onChange={e => set('threshold_type',e.target.value)}><option value="amount">滿額</option><option value="quantity">滿件</option></select></Field>}{!isBuyXGetY && <Field label={form.benefit_type === 'quantity_gift' ? '滿幾件贈送 *' : isGift ? '滿額門檻（NT$）*' : form.threshold_type === 'quantity' ? '最低適用件數（選填）' : '最低適用金額（選填）'}><input type="number" min="1" step={form.threshold_type === 'quantity' ? '1' : undefined} style={inputStyle} value={form.threshold_value} onChange={e => set('threshold_value',e.target.value)} /></Field>}{isBuyXGetY && <><Field label="買入件數 X *"><input aria-label="買入件數 X" type="number" min="1" step="1" required style={inputStyle} value={form.buy_quantity} onChange={e => set('buy_quantity',e.target.value)} /></Field><Field label="免費件數 Y *"><input aria-label="免費件數 Y" type="number" min="1" step="1" required style={inputStyle} value={form.gift_quantity} onChange={e => set('gift_quantity',e.target.value)} /></Field></>}{isGift && <><Field label="贈品庫存 *"><select aria-label="贈品庫存" style={inputStyle} value={form.gift_variant_id} onChange={e => set('gift_variant_id',e.target.value)}><option value="">請選擇贈品</option>{giftVariants.map(variant => <option key={variant.id} value={variant.id}>[{variant.sourceLabel}] {variant.productName} · {variant.size} · {variant.sku}（庫存 {variant.giftStock}）</option>)}</select></Field><Field label="每次贈送數量 *"><input type="number" min="1" style={inputStyle} value={form.gift_quantity} onChange={e => set('gift_quantity',e.target.value)} /></Field></>}{(isGift || isBuyXGetY) && <Field label="達標方式"><select aria-label="達標方式" style={inputStyle} value={form.repeat_mode} onChange={e => set('repeat_mode',e.target.value)}><option value="once">每筆訂單只贈一次</option><option value="repeat">每達門檻重複贈送</option></select></Field>}<Field label="開始時間（選填）"><input type="datetime-local" style={inputStyle} value={form.start_at} onChange={e => set('start_at',e.target.value)} /></Field><Field label="結束時間（選填）"><input type="datetime-local" style={inputStyle} value={form.end_at} onChange={e => set('end_at',e.target.value)} /></Field></div>
    {isBuyXGetY && <p data-testid="buy-x-get-y-explanation" style={{ fontSize:12, color:'var(--mid)', lineHeight:1.7 }}>顧客需選滿 {Number(form.buy_quantity) + Number(form.gift_quantity) || 0} 件活動商品，其中最低價的 {Number(form.gift_quantity) || 0} 件免費。{form.repeat_mode === 'repeat' ? '每滿一組可再次贈送，不另設每筆上限。' : '每筆訂單只贈送一組。'}使用一般販售庫存；自動活動與其他自動折扣擇優套用。</p>}
    {form.activation_type === 'automatic' && <Field label="適用對象"><div data-testid="promotion-audience" style={{ display:'flex', flexWrap:'wrap', gap:16 }}>{ROLES.map(([role,label]) => <label key={role} style={{ fontSize:13 }}><input type="checkbox" checked={form.audience_roles.has(role)} onChange={() => { const next = new Set(form.audience_roles); next.has(role) ? next.delete(role) : next.add(role); set('audience_roles',next); }} /> {label}</label>)}<label style={{ fontSize:13 }}><input type="checkbox" checked={form.allow_guest} onChange={e => set('allow_guest',e.target.checked)} /> 允許訪客</label></div><p style={{ fontSize:11, color:'var(--mid)', marginTop:7 }}>只對勾選的會員身分或訪客自動套用；優惠券專用活動由優惠券方案設定適用對象。</p></Field>}
    {isGift && !giftVariants.length && <p role="alert" style={{ fontSize:12, color:'var(--red)' }}>目前沒有啟用中的贈品庫存，請先到商品與庫存的商品編輯頁設定。</p>}
    <Field label="適用範圍"><div style={{ display:'flex', gap:18, fontSize:13, flexWrap:'wrap' }}><label><input type="radio" checked={form.scope_type === 'all_regular'} onChange={() => set('scope_type','all_regular')} /> 全館一般商品</label><label><input type="radio" checked={form.scope_type === 'all_sellable'} onChange={() => set('scope_type','all_sellable')} /> 全館商品（含活動限定）</label><label><input type="radio" checked={form.scope_type === 'products'} onChange={() => set('scope_type','products')} /> 指定商品</label></div><p style={{ fontSize:11, color:'var(--mid)', marginTop:7 }}>兩種全館範圍都不包含贈品專用、草稿與已下架商品；「全館一般商品」另排除活動限定商品。</p></Field>
    {form.scope_type === 'products' && <ProductPicker
      products={selectableProducts}
      selected={form.product_ids}
      onToggle={toggle}
      onSelectAll={() => set('product_ids', new Set(selectableProducts.map(product => product.id)))}
      onClear={() => set('product_ids', new Set())}
    />}
    </>}
    <StudentPolicyFields form={legacy ? { ...form, benefit_type:promo.benefit_type || 'legacy_discount' } : form} set={set} installed={policyInstalled} />
    <SaveButtons saving={saving} disabled={legacy && (!policyInstalled || !supportsStudentPolicy(promo))} onClose={onClose} label={promo?.id ? '儲存變更' : '建立活動'} />
  </form></Editor>;
}

function CouponForm({ coupon, promotions, linkedIds, linkedMemberIds, onClose }) {
  const [form,setForm] = useState({ name:coupon?.name || '', code:coupon?.code || '', description:coupon?.description || '', promotion_ids:[...new Set(linkedIds)], audience_mode:coupon?.audience_mode || 'roles', member_ids:[...new Set(linkedMemberIds)], start_at:toLocalInput(coupon?.start_at), end_at:toLocalInput(coupon?.end_at), total_usage_limit:coupon?.total_usage_limit || '', per_member_limit:coupon?.per_member_limit || '', audience_roles:new Set(coupon?.audience_roles || DEFAULT_AUDIENCE_ROLES), allow_guest:coupon?.allow_guest ?? true, stacking_policy:coupon?.stacking_policy || 'allow_auto_gifts', active:coupon?.active ?? true });
  const [saving,setSaving] = useState(false); const [error,setError] = useState('');
  const [memberQuery,setMemberQuery] = useState(''); const [memberResults,setMemberResults] = useState([]);
  const [selectedMembers,setSelectedMembers] = useState([]); const [memberSearchLoading,setMemberSearchLoading] = useState(false);
  const set = (key,value) => setForm(current => ({ ...current, [key]:value }));
  function toggleSet(key,value) { const next = new Set(form[key]); next.has(value) ? next.delete(value) : next.add(value); set(key,next); }
  function togglePromotion(id) {
    setForm(current => ({
      ...current,
      promotion_ids:current.promotion_ids.includes(id)
        ? current.promotion_ids.filter(promotionId => promotionId !== id)
        : [...current.promotion_ids, id],
    }));
  }
  function movePromotion(id, offset) {
    setForm(current => {
      const index = current.promotion_ids.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.promotion_ids.length) return current;
      const promotionIds = [...current.promotion_ids];
      [promotionIds[index], promotionIds[target]] = [promotionIds[target], promotionIds[index]];
      return { ...current, promotion_ids:promotionIds };
    });
  }
  useEffect(() => {
    if (!coupon?.id || coupon.audience_mode !== 'members') return;
    supabase.rpc('get_coupon_campaign_members', { p_coupon_campaign_id:coupon.id }).then(({ data, error:loadError }) => {
      if (loadError) setError(`指定會員載入失敗：${loadError.message}`);
      else setSelectedMembers(data || []);
    });
  }, [coupon?.id, coupon?.audience_mode]);
  async function searchMembers() {
    const query = memberQuery.trim();
    setError(''); setMemberSearchLoading(true);
    const { data, error:searchError } = await supabase.rpc('search_coupon_members', { p_query:query, p_limit:20 });
    setMemberSearchLoading(false);
    if (searchError) return setError(`會員搜尋失敗：${searchError.message}`);
    setMemberResults(data || []);
  }
  function toggleMember(member) {
    const removing = form.member_ids.includes(member.user_id);
    setForm(current => {
      const exists = current.member_ids.includes(member.user_id);
      return { ...current, member_ids:exists ? current.member_ids.filter(id => id !== member.user_id) : [...current.member_ids, member.user_id] };
    });
    setSelectedMembers(current => removing ? current.filter(item => item.user_id !== member.user_id) : current.some(item => item.user_id === member.user_id) ? current : [...current, member]);
  }
  async function save(event) {
    event.preventDefault(); setError('');
    if (!form.name.trim() || !form.code.trim()) return setError('請輸入優惠券名稱與代碼');
    if (!form.promotion_ids.length) return setError('請至少打包一個優惠券專用活動');
    if (form.audience_mode === 'roles' && !form.audience_roles.size) return setError('請至少選擇一種適用會員');
    if (form.audience_mode === 'members' && !form.member_ids.length) return setError('請至少指定一位會員');
    if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) return setError('結束時間必須晚於開始時間');
    setSaving(true);
    const payload = { id:coupon?.id || null, ...form, code:form.code.trim().toUpperCase(), promotion_ids:form.promotion_ids, member_ids:form.audience_mode === 'members' ? form.member_ids : [], audience_roles:form.audience_mode === 'roles' ? [...form.audience_roles] : [], allow_guest:form.audience_mode === 'roles' && form.allow_guest, total_usage_limit:form.total_usage_limit === '' ? null : Number(form.total_usage_limit), per_member_limit:form.per_member_limit === '' ? null : Number(form.per_member_limit), start_at:form.start_at ? new Date(form.start_at).toISOString() : null, end_at:form.end_at ? new Date(form.end_at).toISOString() : null };
    const { error:saveError } = await supabase.rpc('save_coupon_campaign', { p_payload:payload }); setSaving(false);
    if (saveError) {
      const message = String(saveError.message || '請稍後再試');
      const duplicateCode = message.includes('coupon_campaigns_code_unique_idx')
        || /duplicate key value/i.test(message);
      setError(duplicateCode
        ? `儲存失敗：優惠碼「${payload.code}」已存在（可能已停用），請使用其他優惠碼。`
        : `儲存失敗：${message}`);
    } else onClose();
  }
  return <Editor title={coupon ? '編輯優惠券' : '新增優惠券'} back="返回優惠券列表" onClose={onClose} error={error}><form onSubmit={save} style={{ ...panelStyle, display:'flex', flexDirection:'column', gap:22 }}>
    <div style={gridStyle}><Field label="優惠券名稱 *"><input aria-label="優惠券名稱 *" style={inputStyle} value={form.name} onChange={e => set('name',e.target.value)} /></Field><Field label="優惠碼 *"><input aria-label="優惠碼 *" style={{ ...inputStyle, textTransform:'uppercase', letterSpacing:'0.12em' }} value={form.code} onChange={e => set('code',e.target.value.toUpperCase())} /></Field></div>
    <Field label="顧客說明（選填）"><textarea style={{ ...inputStyle, border:'1px solid var(--border)', padding:10 }} rows={2} value={form.description} onChange={e => set('description',e.target.value)} /></Field>
    <Field label={`打包優惠活動 *（已選 ${form.promotion_ids.length}）`}><CouponPromotionPicker promotions={promotions} selectedIds={form.promotion_ids} onToggle={togglePromotion} onMove={movePromotion} /></Field>
    <div style={gridStyle}><Field label="總使用上限（選填）"><input type="number" min="1" style={inputStyle} value={form.total_usage_limit} onChange={e => set('total_usage_limit',e.target.value)} /></Field><Field label="每位會員／訪客上限（選填）"><input type="number" min="1" style={inputStyle} value={form.per_member_limit} onChange={e => set('per_member_limit',e.target.value)} /></Field><Field label="與自動活動疊加"><select style={inputStyle} value={form.stacking_policy} onChange={e => set('stacking_policy',e.target.value)}><option value="coupon_only">只套用優惠券</option><option value="allow_auto_gifts">優惠券＋自動贈品</option><option value="allow_all">優惠券＋自動折扣＋自動贈品</option></select></Field></div>
    <Field label="適用對象"><div style={{ display:'flex', flexWrap:'wrap', gap:18, marginBottom:14 }}><label style={{ fontSize:13 }}><input type="radio" name="audience-mode" checked={form.audience_mode === 'roles'} onChange={() => set('audience_mode','roles')} /> 依會員身分</label><label style={{ fontSize:13 }}><input type="radio" name="audience-mode" checked={form.audience_mode === 'members'} onChange={() => set('audience_mode','members')} /> 指定會員</label></div>{form.audience_mode === 'roles' ? <div style={{ display:'flex', flexWrap:'wrap', gap:16 }}>{ROLES.map(([role,label]) => <label key={role} style={{ fontSize:13 }}><input type="checkbox" checked={form.audience_roles.has(role)} onChange={() => toggleSet('audience_roles',role)} /> {label}</label>)}<label style={{ fontSize:13 }}><input type="checkbox" checked={form.allow_guest} onChange={e => set('allow_guest',e.target.checked)} /> 允許訪客</label></div> : <MemberPicker query={memberQuery} setQuery={setMemberQuery} loading={memberSearchLoading} results={memberResults} selected={selectedMembers} selectedIds={form.member_ids} onSearch={searchMembers} onToggle={toggleMember} onClear={() => { set('member_ids',[]); setSelectedMembers([]); }} />}</Field>
    <div style={gridStyle}><Field label="開始時間（選填）"><input type="datetime-local" style={inputStyle} value={form.start_at} onChange={e => set('start_at',e.target.value)} /></Field><Field label="結束時間（選填）"><input type="datetime-local" style={inputStyle} value={form.end_at} onChange={e => set('end_at',e.target.value)} /></Field></div>
    <SaveButtons saving={saving} onClose={onClose} label={coupon ? '儲存變更' : '建立優惠券'} />
  </form></Editor>;
}

function CouponPromotionPicker({ promotions, selectedIds, onToggle, onMove }) {
  if (!promotions.length) return <p style={{ fontSize:12, color:'var(--red)' }}>請先到「優惠活動」建立啟用方式為「優惠券專用」的活動。</p>;
  const selected = selectedIds.map(id => promotions.find(promotion => promotion.id === id)).filter(Boolean);
  const available = promotions.filter(promotion => !selectedIds.includes(promotion.id));
  return <div style={{ display:'grid', gap:12 }}>
    <p style={{ fontSize:11, color:'var(--mid)', lineHeight:1.6 }}>系統會由上往下依序計算；折扣基準與共用贈品庫存可能受順序影響。</p>
    {selected.length > 0 && <div aria-label="已選優惠活動執行順序" style={{ display:'grid', gap:7 }}>
      {selected.map((promotion, index) => <div key={promotion.id} style={{ display:'grid', gridTemplateColumns:'28px minmax(0,1fr) auto', alignItems:'center', gap:9, border:'1px solid var(--gold)', padding:'9px 10px', background:'var(--off)', fontSize:12 }}>
        <strong aria-label={`執行順序 ${index + 1}`} style={{ textAlign:'center', fontSize:11 }}>{index + 1}</strong>
        <label style={{ minWidth:0 }}><input type="checkbox" checked onChange={() => onToggle(promotion.id)} /> <span>{promotion.name} · {getBenefitLabel(promotion, [])}</span></label>
        <div style={{ display:'flex', gap:5 }}>
          <button type="button" aria-label={`將「${promotion.name}」上移`} disabled={index === 0} onClick={() => onMove(promotion.id, -1)} style={{ ...secondaryButton, flex:'none', padding:'5px 9px', opacity:index === 0 ? 0.4 : 1 }}>↑</button>
          <button type="button" aria-label={`將「${promotion.name}」下移`} disabled={index === selected.length - 1} onClick={() => onMove(promotion.id, 1)} style={{ ...secondaryButton, flex:'none', padding:'5px 9px', opacity:index === selected.length - 1 ? 0.4 : 1 }}>↓</button>
        </div>
      </div>)}
    </div>}
    {available.length > 0 && <div>
      <span style={{ ...labelStyle, marginBottom:6 }}>可加入活動</span>
      <div style={{ display:'grid', gap:7 }}>{available.map(promotion => <label key={promotion.id} style={{ border:'1px solid var(--border)', padding:'9px 12px', fontSize:12, background:'#fff' }}><input type="checkbox" checked={false} onChange={() => onToggle(promotion.id)} /> {promotion.name} · {getBenefitLabel(promotion, [])}</label>)}</div>
    </div>}
  </div>;
}

function MemberPicker({ query, setQuery, loading, results, selected, selectedIds, onSearch, onToggle, onClear }) {
  const roleLabel = role => ROLES.find(([value]) => value === role)?.[1] || (role === 'pending' ? '審核中' : role || '一般會員');
  const contactLabel = member => member?.contact_name ? <span style={{ color:'var(--mid)', fontWeight:400 }}> · 聯絡人 {member.contact_name}</span> : null;
  const handleKeyDown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSearch();
    }
  };
  return <div style={{ display:'grid', gap:12 }}>
    <p style={{ fontSize:11, lineHeight:1.7, color:'var(--mid)' }}>只有被指定且已登入的會員可以使用；指定會員模式不開放訪客。</p>
    <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) auto', gap:8 }}>
      <input aria-label="搜尋指定會員" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="輸入姓名、聯絡人、皮膚管理院、Email 或手機" style={{ ...inputStyle, border:'1px solid var(--border)', padding:'10px 12px' }} />
      <button type="button" onClick={onSearch} disabled={loading} style={{ ...secondaryButton, flex:'none', minWidth:76 }}>{loading ? '搜尋中…' : '搜尋'}</button>
    </div>
    {results.length > 0 && <div aria-label="會員搜尋結果" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))', gap:7, maxHeight:260, overflow:'auto' }}>{results.map(member => {
      const checked = selectedIds.includes(member.user_id);
      return <label key={member.user_id} style={{ border:`1px solid ${checked ? 'var(--gold)' : 'var(--border)'}`, padding:'9px 11px', background:checked ? 'var(--off)' : '#fff', fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={checked} onChange={() => onToggle(member)} /> <strong style={{ fontWeight:500 }}>{member.name || '未填姓名'}</strong>{contactLabel(member)} · {roleLabel(member.role)}<small style={{ display:'block', marginLeft:18, marginTop:4, color:'var(--mid)', overflowWrap:'anywhere' }}>{member.email || '無 Email'}{member.phone ? `｜${member.phone}` : ''}</small></label>;
    })}</div>}
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}><span style={{ fontSize:12, color:'var(--dark)' }}>已指定 {selectedIds.length} 位會員</span>{selectedIds.length > 0 && <button type="button" onClick={onClear} style={{ border:'none', background:'none', color:'var(--red)', fontSize:11, cursor:'pointer' }}>全部清除</button>}</div>
    {selectedIds.length > 0 && <div aria-label="已指定會員" style={{ display:'grid', gap:7 }}>{selectedIds.map(userId => {
      const member = selected.find(item => item.user_id === userId);
      return <div key={userId} style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) auto', gap:10, alignItems:'center', padding:'9px 11px', background:'var(--off)', border:'1px solid var(--border)', fontSize:12 }}><div><strong style={{ fontWeight:500 }}>{member?.name || '會員資料載入中'}</strong>{contactLabel(member)}{member && <small style={{ display:'block', color:'var(--mid)', marginTop:3, overflowWrap:'anywhere' }}>{roleLabel(member.role)} · {member.email || '無 Email'}{member.phone ? `｜${member.phone}` : ''}</small>}</div><button type="button" onClick={() => onToggle(member || { user_id:userId })} style={{ border:'none', background:'none', color:'var(--red)', fontSize:11, cursor:'pointer' }}>移除</button></div>;
    })}</div>}
  </div>;
}

function ProductPicker({ products, selected, onToggle, onSelectAll, onClear }) {
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLocaleLowerCase();
  const filteredProducts = products.filter(product => [product.nameZh, product.name].some(name => String(name || '').toLocaleLowerCase().includes(keyword)));
  const allSelected = products.length > 0 && products.every(product => selected.has(product.id));
  return <div>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:8, flexWrap:'wrap' }}>
      <span style={{ ...labelStyle, marginBottom:0 }}>指定商品（已選 {selected.size}）</span>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', flex:'1 1 300px' }}>
        <div style={{ position:'relative', flex:'1 1 140px', minWidth:120 }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--mid)', pointerEvents:'none' }}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input type="search" aria-label="搜尋指定商品" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} style={{ ...inputStyle, width:'100%', minWidth:0, padding:'6px 10px 6px 32px' }} />
        </div>
        <button type="button" onClick={onSelectAll} disabled={allSelected || !products.length} style={{ ...secondaryButton, flex:'none', padding:'6px 12px', opacity:allSelected || !products.length ? 0.45 : 1 }}>全選</button>
        <button type="button" onClick={onClear} disabled={!selected.size} style={{ ...secondaryButton, flex:'none', padding:'6px 12px', opacity:selected.size ? 1 : 0.45 }}>全取消</button>
      </div>
    </div>
    {keyword && <p role="status" style={{ fontSize:11, color:'var(--mid)', margin:'0 0 8px' }}>找到 {filteredProducts.length} 件商品；搜尋不影響已選項目。全選／全取消仍適用全部商品。</p>}
    <div style={{ maxHeight:360, overflow:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))', gap:7, border:'1px solid var(--border)', padding:10 }}>{filteredProducts.map(product => <label key={product.id} style={{ padding:'8px 9px', fontSize:12, border:`1px solid ${selected.has(product.id) ? 'var(--gold)' : 'transparent'}`, background:selected.has(product.id) ? '#fff' : 'var(--off)' }}><input type="checkbox" checked={selected.has(product.id)} onChange={() => onToggle(product.id)} /> {product.nameZh}<small style={{ display:'block', color:'var(--mid)', marginLeft:18 }}>{product.publicationStatus === 'event_only' ? '活動限定' : '一般商品'}</small></label>)}</div>
    {!filteredProducts.length && <p style={{ fontSize:12, color:'var(--mid)', padding:12 }}>找不到符合的商品</p>}
  </div>;
}
function getBenefitLabel(promotion, products) {
  if (!promotion?.benefit_type || promotion.benefit_type === 'legacy_discount') return `舊版複合折扣 · × ${promotion?.discount_rate} − NT$ ${Number(promotion?.discount_amount || 0).toLocaleString()}`;
  if (promotion.benefit_type === 'percentage_discount') return `${Math.round((1 - Number(promotion.discount_rate)) * 100)}% OFF`;
  if (promotion.benefit_type === 'buy_x_get_y') return `買 ${promotion.buy_quantity} 送 ${promotion.gift_quantity} · 最低價免費 · ${promotion.repeat_mode === 'repeat' ? '每滿一組重複贈送' : '每筆只贈一次'}`;
  if (promotion.benefit_type === 'fixed_discount') return `折抵 NT$ ${Number(promotion.discount_amount).toLocaleString()}`;
  const giftProduct = products.find(product => (product.variants || []).some(variant => Number(variant.id) === Number(promotion.gift_variant_id)));
  const giftVariant = giftProduct?.variants?.find(variant => Number(variant.id) === Number(promotion.gift_variant_id));
  return `${promotion.benefit_type === 'amount_gift' ? '滿額贈' : '滿件贈'} · ${giftProduct?.nameZh || '贈品'}${giftVariant?.size ? ` ${giftVariant.size}` : ''} × ${promotion.gift_quantity || 1}`;
}
function Editor({ title, back, onClose, error, children }) { return <div><button onClick={onClose} style={{ background:'none', border:'none', padding:0, color:'var(--mid)', cursor:'pointer', fontSize:12, marginBottom:7 }}>← {back}</button><h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400, marginBottom:24 }}>{title}</h1>{error && <div role="alert" style={{ maxWidth:920, color:'var(--red)', background:'oklch(0.60 0.18 25 / 0.08)', border:'1px solid oklch(0.60 0.18 25 / 0.3)', padding:'10px 14px', marginBottom:16, fontSize:13 }}>{error}</div>}{children}</div>; }
function Field({ label, children }) { return <div><label style={labelStyle}>{label}</label>{children}</div>; }
function Card({ children }) { return <div style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'20px 22px', display:'flex', flexDirection:'column', gap:13, minHeight:190 }}>{children}</div>; }
function Empty({ text }) { return <div style={{ padding:48, textAlign:'center', color:'var(--mid)', border:'1px solid var(--border)', background:'var(--white)', fontSize:13 }}>{text}</div>; }
function SaveButtons({ saving, disabled = false, onClose, label }) { return <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}><button type="button" onClick={onClose} style={{ ...secondaryButton, flex:'none', padding:'11px 22px' }}>取消</button><button disabled={saving || disabled} style={{ padding:'11px 26px', border:'none', background:saving ? 'var(--mid)' : 'var(--dark)', color:'#fff', cursor:saving ? 'wait' : 'pointer', fontSize:12 }}>{saving ? '儲存中…' : label}</button></div>; }
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0,16); }
function stackingLabel(value) { return value === 'allow_all' ? '含自動折扣' : value === 'allow_auto_gifts' ? '僅自動贈品' : '只用優惠券'; }


function supportsStudentPolicy(promo) {
  return (promo.activation_type || 'automatic') === 'automatic'
    && ['legacy_discount', 'percentage_discount', 'fixed_discount', 'buy_x_get_y'].includes(promo.benefit_type || 'legacy_discount');
}

function StudentPolicyFields({ form, set, installed = true }) {
  if (!supportsStudentPolicy(form)) return <p style={{ fontSize:12, color:'var(--mid)' }}>學生價與返饋排除設定僅適用自動價格活動；滿額贈、滿件贈及優惠券專用活動維持原規則。</p>;
  return <Field label="學生價與師資返饋">
    <div style={{ marginBottom:18 }}>
      <label style={{ display:'block', fontSize:13 }}><input type="checkbox" disabled={!installed} checked={form.allow_student_price_stacking} onChange={e => set('allow_student_price_stacking', e.target.checked)} /> 活動優惠可再享學生價</label>
      <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.7, marginTop:8 }}>勾選：學生價可再套用活動優惠。<br />未勾選：活動優惠與學生價擇一，系統自動選較便宜的方案；同額時選活動優惠。</p>
    </div>
    <div>
      <label style={{ display:'block', fontSize:13 }}><input type="checkbox" disabled={!installed} checked={form.instructor_reward_eligible} onChange={e => set('instructor_reward_eligible', e.target.checked)} /> 活動商品照常計算師資返饋</label>
      <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.7, marginTop:8 }}>勾選：套用活動優惠的商品仍計算師資返饋，返饋金額不因活動折抵而減少。<br />未勾選：套用活動優惠的商品不計師資返饋。</p>
    </div>
    <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.7, marginTop:14 }}>{installed ? '買贈活動以整組商品（含贈送件）套用上述設定。未套用活動的商品與剩餘件數，仍依原規則享學生價及師資返饋。' : '學生價與返饋設定尚未安裝，目前維持原規則。'}</p>
  </Field>;
}
