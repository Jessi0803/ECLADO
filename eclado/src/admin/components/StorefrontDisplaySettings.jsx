import React, { useEffect, useState } from 'react';
import { fetchStorefrontDisplay, saveStorefrontDisplay } from '../../services/storefrontDisplay.js';

export default function StorefrontDisplaySettings() {
  const [value, setValue] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let disposed = false;
    fetchStorefrontDisplay().then(({ data, error }) => {
      if (error || typeof data?.show_fulfillment !== 'boolean') throw error || new Error('設定資料不完整');
      if (!disposed) { setValue(data.show_fulfillment); setReady(true); }
    }).catch(() => {
      if (!disposed) setError('無法載入前台顯示設定，請確認已安裝 supabase-storefront-display-settings.sql 後重新整理。');
    });
    return () => { disposed = true; };
  }, []);
  async function save(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveStorefrontDisplay(value);
      if (result.error) throw result.error;
      if (typeof result.data?.show_fulfillment !== 'boolean') throw new Error('設定回應不完整');
      setValue(result.data.show_fulfillment);
      setMessage('前台商品顯示設定已儲存。');
    } catch (error) { setError(`儲存失敗：${error.message}`); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} aria-label="前台商品顯示" style={{ maxWidth:720, padding:24, marginBottom:24, background:'var(--white)', border:'1px solid var(--border)' }}>
    <h2 style={{ fontSize:18, marginBottom:18 }}>前台商品顯示</h2>
    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
      <input type="checkbox" role="switch" checked={value} disabled={!ready || busy} onChange={event => { setValue(event.target.checked); setMessage(''); }} />
      顯示現貨／預購與出貨時間
    </label>
    <p style={{ fontSize:12, color:'var(--mid)', lineHeight:1.8, marginTop:12 }}>控制商品詳情與購物車的供貨標籤及出貨時間。關閉後，結帳仍會針對預購品項顯示一次交期提醒；購物須知與既有訂單紀錄保留。</p>
    {error && <p role="alert" style={{ color:'var(--red)', fontSize:13, marginTop:16 }}>{error}</p>}
    {message && <p role="status" style={{ color:'var(--green)', fontSize:13, marginTop:16 }}>{message}</p>}
    <button type="submit" disabled={!ready || busy} style={{ marginTop:18, padding:'10px 20px', background:'var(--dark)', color:'#fff', border:0 }}>{busy ? '儲存中…' : '儲存顯示設定'}</button>
  </form>;
}
