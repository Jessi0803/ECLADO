import React, { useEffect, useState } from 'react';
import { PRICING_ROLES, PRICING_LABELS, parseFold, formatFold } from '../../domain/memberPricing.js';
import { fetchMemberPricingSettings, saveMemberPricingSettings } from '../../services/memberPricing.js';

export default function MemberPricingPage({ onSaved }) {
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setBusy(true); setError('');
    try {
      const result = await fetchMemberPricingSettings();
      if (result.error) throw result.error;
      if (!PRICING_ROLES.every(role => Number(result.data?.multipliers?.[role]) > 0)) throw new Error('定價設定不完整');
      setSnapshot(result.data.multipliers);
      setDraft(Object.fromEntries(PRICING_ROLES.map(role => [role, String(formatFold(result.data.multipliers[role]))])));
    } catch (err) {
      setSnapshot(null);
      setError(`無法載入設定：${err.message}。若尚未部署，請先執行 supabase-member-pricing.sql。`);
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(event) {
    event.preventDefault();
    if (busy || !snapshot) return;
    setError(''); setMessage('');
    let values;
    try { values = Object.fromEntries(PRICING_ROLES.map(role => [role, parseFold(draft[role])])); }
    catch (err) { setError(err.message); return; }
    const changes = PRICING_ROLES.filter(role => values[role] !== Number(snapshot[role]));
    if (!changes.length) { setMessage('折數未變更。'); return; }
    if (!window.confirm(`將影響所有沿用全域折數的商品：\n${changes.map(role => `${PRICING_LABELS[role]}：${formatFold(snapshot[role])} 折 → ${formatFold(values[role])} 折`).join('\n')}\n已成立訂單及付款單不受影響。確定儲存？`)) return;
    setBusy(true);
    try {
      const result = await saveMemberPricingSettings(values, snapshot);
      if (result.error) throw result.error;
      setSnapshot(result.data.multipliers);
      setDraft(Object.fromEntries(PRICING_ROLES.map(role => [role, String(formatFold(result.data.multipliers[role]))])));
      setMessage('會員全域折數已儲存。');
      onSaved?.();
    } catch (err) { setError(`儲存失敗：${err.message}；如設定已被他人變更，請重新載入後確認。`); }
    finally { setBusy(false); }
  }
  return <div>
    <h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400, marginBottom:4 }}>系統設定</h1>
    <p style={{ fontSize:13, color:'var(--mid)', marginBottom:28 }}>會員定價：設定師資、經銷商與內部人員的預設折數。</p>
    <form onSubmit={save} style={{ maxWidth:720, padding:24, background:'var(--white)', border:'1px solid var(--border)' }}>
      <h2 style={{ fontSize:18, marginBottom:18 }}>會員定價</h2>
      {PRICING_ROLES.map(role => <label key={role} style={{ display:'block', marginBottom:16, fontSize:13 }}>
        {PRICING_LABELS[role]}預設折數
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
          <input aria-label={`${PRICING_LABELS[role]}預設折數`} type="number" min="0.01" max="10" step="0.01" required value={draft[role] ?? ''} disabled={busy || !snapshot} onChange={e => setDraft(previous => ({ ...previous, [role]:e.target.value }))} style={{ width:150, padding:10, border:'1px solid var(--border)' }}/><span>折</span>
          {draft[role] && <span style={{ color:'var(--mid)' }}>專業價 × {Number(draft[role]) * 10}%</span>}
        </div>
      </label>)}
      <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.8, marginBottom:18 }}>適用於未設定個別折數的商品。10 折代表不打折；修改不影響已成立訂單及付款單。一般會員、美容師及免運等身份待遇不變。</p>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}><button type="submit" disabled={busy || !snapshot} style={{ padding:'10px 20px', background:'var(--dark)', color:'#fff', border:0 }}>儲存全域折數</button><button type="button" disabled={busy} onClick={load} style={{ padding:'10px 20px', border:'1px solid var(--dark)', background:'var(--white)', color:'var(--dark)', fontSize:12, cursor:busy?'not-allowed':'pointer', opacity:busy?0.45:1 }}>重新載入</button></div>
      {error && <p role="alert" style={{ color:'var(--red)', marginTop:16 }}>{error}</p>}
      {message && <p role="status" style={{ color:'var(--green)', marginTop:16 }}>{message}</p>}
    </form>
  </div>;
}
