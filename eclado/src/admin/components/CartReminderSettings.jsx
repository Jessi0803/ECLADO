import React, { useEffect, useState } from 'react';
import { cartReminderConfig as config, previewCartReminder, fetchCartReminderSettings, saveCartReminderSettings } from '../../services/cartReminderSettings.js';

export default function CartReminderSettings() {
  const [snapshot, setSnapshot] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [content, setContent] = useState(config.defaultContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    fetchCartReminderSettings().then(({ data, error }) => {
      if (error) throw error;
      if (!data || typeof data.enabled !== 'boolean' || !Number.isInteger(data.version) || typeof data.content !== 'string') throw new Error('設定資料不完整');
      if (alive) { setSnapshot(data); setEnabled(data.enabled); setContent(data.content); }
    }).catch(() => { if (alive) setError('無法載入購物車提醒設定，請確認已安裝購物車提醒資料庫遷移後重新整理。'); });
    return () => { alive = false; };
  }, []);
  async function save(event) {
    event.preventDefault();
    if (!snapshot || busy) return;
    setError(''); setMessage('');
    const text = content.trim();
    if (!text.includes(config.placeholder)) { setError(`通知內容須保留 ${config.placeholder}，系統會自動替換為返回購物車的網址。`); return; }
    if ([...previewCartReminder(text)].length > config.maxExpandedLength) { setError('購物車連結重複過多，請縮短通知內容後再儲存。'); return; }
    setBusy(true);
    try {
      const { data, error } = await saveCartReminderSettings(enabled, text, snapshot.version);
      if (error) throw error;
      if (!data || typeof data.enabled !== 'boolean' || typeof data.content !== 'string' || !Number.isInteger(data.version)) throw new Error('設定回應不完整');
      setSnapshot(data); setEnabled(data.enabled); setContent(data.content);
      setMessage('購物車未結帳提醒設定已儲存。');
    } catch (error) { setError(`儲存失敗：${error.message}。若已被其他管理員修改，請重新整理後確認。`); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} aria-label="購物車未結帳提醒" style={{ maxWidth:720, padding:24, marginBottom:24, background:'var(--white)', border:'1px solid var(--border)' }}>
    <h2 style={{ fontSize:18, marginBottom:18 }}>購物車未結帳提醒</h2>
    <label style={{ display:'flex', gap:10, alignItems:'center', fontSize:13 }}>
      <input type="checkbox" role="switch" aria-label="啟用購物車未結帳提醒" checked={enabled} disabled={!snapshot || busy} onChange={event => { setEnabled(event.target.checked); setMessage(''); }} />啟用 24 小時自動提醒
    </label>
    <p style={{ color:'var(--mid)', fontSize:12, lineHeight:1.8, margin:'12px 0 18px' }}>會員最後一次變更購物車內容滿 24 小時後，由系統每 10 分鐘檢查。LINE 優先，無法使用時改寄已驗證的 Email；同一輪購物車只提醒一次。已成立訂單則不再發送購物車提醒。重新啟用時，現有購物車也會至少等待 24 小時。</p>
    <label style={{ display:'block', fontSize:13 }}>自訂通知內容
      <textarea aria-label="購物車提醒通知內容" value={content} disabled={!snapshot || busy} required maxLength={config.maxLength} rows={10} onChange={event => { setContent(event.target.value); setMessage(''); }} style={{ display:'block', width:'100%', boxSizing:'border-box', padding:12, marginTop:8, border:'1px solid var(--border)', lineHeight:1.8, font:'inherit', resize:'vertical' }} />
    </label>
    <p style={{ fontSize:12, color:'var(--mid)', marginTop:8 }}>請保留 {config.placeholder}；最多 {config.maxLength} 字。儲存後會套用至尚未開始發送的提醒。</p>
    <details style={{ margin:'16px 0', fontSize:13 }}><summary style={{ cursor:'pointer' }}>預覽通知內容</summary><div data-testid="cart-reminder-preview" style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', padding:16, background:'var(--off-white)', lineHeight:1.8, marginTop:10 }}>{previewCartReminder(content)}</div></details>
    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
      <button type="submit" disabled={!snapshot || busy} style={{ padding:'10px 20px', background:'var(--dark)', color:'#fff', border:0 }}>{busy ? '儲存中…' : '儲存購物車提醒設定'}</button>
      <button type="button" disabled={!snapshot || busy} onClick={() => { setContent(config.defaultContent); setMessage(''); }} style={{ padding:'10px 20px', background:'var(--white)', color:'var(--dark)', border:'1px solid var(--border)' }}>恢復公版內容</button>
    </div>
    {error && <p role="alert" style={{ color:'var(--red)', fontSize:13, marginTop:16 }}>{error}</p>}
    {message && <p role="status" style={{ color:'var(--green)', fontSize:13, marginTop:16 }}>{message}</p>}
  </form>;
}
