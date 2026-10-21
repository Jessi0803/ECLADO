import React, { useEffect, useState } from 'react';
import AnnouncementMarquee from '../../components/layout/AnnouncementMarquee.jsx';
import { EMPTY_ANNOUNCEMENT, fetchSiteAnnouncement, saveSiteAnnouncement } from '../../services/siteAnnouncement.js';

export default function SiteAnnouncementSettings() {
  const [form, setForm] = useState(EMPTY_ANNOUNCEMENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let disposed = false;
    fetchSiteAnnouncement().then(({ data, error }) => {
      if (disposed) return;
      if (error) setError(`載入失敗：${error.message}`);
      else setForm(data || EMPTY_ANNOUNCEMENT);
      setLoading(false);
    });
    return () => { disposed = true; };
  }, []);
  function update(key, value) { setForm(current => ({ ...current, [key]:value })); setSaved(false); if (!error.startsWith('載入失敗')) setError(''); }
  async function save(event) {
    event.preventDefault(); setError(''); setSaved(false);
    if (form.enabled && !form.content.trim()) return setError('請輸入公告文字，或關閉跑馬燈。');
    setSaving(true);
    const { data, error } = await saveSiteAnnouncement(form.content, form.enabled);
    setSaving(false);
    if (error) setError(`儲存失敗：${error.message}`);
    else { setForm(data || { ...form, content:form.content.trim() }); setSaved(true); }
  }
  if (loading) return <p style={{ fontSize:13, color:'var(--mid)' }}>載入中…</p>;
  return <form onSubmit={save} style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'clamp(20px, 4vw, 32px)', maxWidth:920 }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:20, flexWrap:'wrap', marginBottom:28 }}>
      <h2 style={{ fontFamily:'var(--font-d)', fontSize:20, fontWeight:400 }}>公告內容</h2>
      <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, cursor:'pointer' }}>
        <button type="button" disabled={saving} role="switch" aria-label="顯示跑馬燈" aria-checked={form.enabled} onClick={() => update('enabled', !form.enabled)} style={{ width:38, height:22, padding:3, border:'none', borderRadius:20, background:form.enabled ? 'var(--dark)' : 'var(--border)', cursor:'pointer' }}>
          <span style={{ display:'block', width:16, height:16, borderRadius:'50%', background:'#fff', transform:form.enabled ? 'translateX(16px)' : 'translateX(0)', transition:'transform 0.2s' }} />
        </button>
        顯示跑馬燈
      </label>
    </div>
    <label htmlFor="site-announcement-content" style={{ display:'block', fontSize:11, letterSpacing:'0.12em', color:'var(--mid)', marginBottom:8 }}>公告文字</label>
    <textarea id="site-announcement-content" maxLength={200} rows={5} disabled={saving} value={form.content} onChange={event => update('content', event.target.value)} placeholder="例：任選 2 件即免運" style={{ width:'100%', border:'1px solid var(--border)', padding:12, fontSize:14, fontFamily:'inherit', lineHeight:1.8, background:'none', resize:'vertical', boxSizing:'border-box' }} />
    <p style={{ textAlign:'right', fontSize:11, color:'var(--mid)', marginTop:6 }}>{form.content.length}/200</p>
    <p style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--mid)', marginTop:26, marginBottom:10 }}>前台預覽</p>
    <div style={{ border:'1px solid var(--border)', background:'var(--off)', minHeight:36 }}>
      {form.enabled && form.content.trim() ? <AnnouncementMarquee announcement={form} preview /> : <p style={{ padding:'10px 16px', fontSize:12, color:'var(--mid)' }}>跑馬燈目前不顯示</p>}
    </div>
    <p style={{ fontSize:11, color:'var(--mid)', marginTop:10, lineHeight:1.8 }}>儲存後顯示於前台主導覽列下方，首頁配色隨導覽列切換。公告僅供展示，實際優惠請於活動或運費設定中設定。</p>
    {error && <p role="alert" style={{ color:'var(--red)', fontSize:13, marginTop:18 }}>{error}</p>}
    {saved && <p role="status" style={{ color:'var(--dark)', fontSize:13, marginTop:18 }}>公告設定已儲存</p>}
    <div style={{ display:'flex', justifyContent:'flex-end', marginTop:24 }}><button type="submit" disabled={saving || Boolean(error.startsWith('載入失敗'))} style={{ padding:'11px 26px', border:'none', background:'var(--dark)', color:'#fff', fontSize:12, fontFamily:'inherit', cursor:saving ? 'wait' : 'pointer' }}>{saving ? '儲存中…' : '儲存設定'}</button></div>
  </form>;
}
