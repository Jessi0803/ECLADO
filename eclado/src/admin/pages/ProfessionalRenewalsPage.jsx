import React, { useEffect, useState } from 'react';
import {
  EVIDENCE_STATUS_LABELS,
  formatRenewalMoney,
  RENEWAL_STATUS_LABELS,
} from '../../domain/professionalRenewals.js';
import {
  createRenewalEvidenceSignedUrl,
  createProfessionalQuarterlyNoticeCorrection,
  fetchAdminProfessionalRenewals,
  fetchAdminProfessionalQuarterlyNotices,
  finalizeProfessionalRenewalYear,
  openProfessionalEvidenceEntryWindow,
  reviewProfessionalAwardEvidence,
  reviewProfessionalRenewal,
} from '../../services/professionalRenewals.js';
import { supabase } from '../../services/supabase.js';

export default function ProfessionalRenewalsPage({ canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const currentYear = new Date().getFullYear();

  async function load() {
    setLoading(true); setError('');
    const [renewalsResult, noticesResult] = await Promise.all([
      fetchAdminProfessionalRenewals(),
      fetchAdminProfessionalQuarterlyNotices(),
    ]);
    setLoading(false);
    if (renewalsResult.error || noticesResult.error) return setError(`續約資料載入失敗：${renewalsResult.error?.message || noticesResult.error?.message}`);
    setRows(Array.isArray(renewalsResult.data) ? renewalsResult.data : []);
    setNotices(Array.isArray(noticesResult.data) ? noticesResult.data : []);
  }
  useEffect(() => { load(); }, []);

  async function finalize() {
    const yearText = window.prompt('請輸入要結算的資格年度（例如 2026）', String(currentYear - 1));
    if (!yearText) return;
    const year = Number(yearText);
    if (!Number.isInteger(year)) return setMessage('年度格式不正確。');
    if (!window.confirm(`確定結算 ${year} 年度？未申請者將降為一般專業會員。`)) return;
    setBusy('finalize'); setMessage('');
    const { data, error: actionError } = await finalizeProfessionalRenewalYear(year);
    setBusy('');
    setMessage(actionError ? `結算失敗：${actionError.message}` : `結算完成：${data?.finalized_count || 0} 筆待審核、${data?.downgraded_count || 0} 位未申請降級。`);
    if (!actionError) await load();
  }

  async function reviewApplication(row, decision) {
    const reason = window.prompt(decision === 'approved' ? '請輸入核准說明' : '請輸入未通過原因');
    if (!reason?.trim()) return;
    setBusy(row.id); setMessage('');
    const { error: actionError } = await reviewProfessionalRenewal(row.id, decision, reason.trim());
    if (!actionError) {
      const session = await supabase.auth.getSession();
      const token = session.data?.session?.access_token;
      const response = await fetch('/api/professional-renewal-notice', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify({ applicationId:row.id }),
      });
      const notice = await response.json().catch(() => ({}));
      setMessage(response.ok ? `審核完成，已透過 ${notice.channel === 'line' ? 'LINE' : 'Email'} 通知。` : `審核完成，但通知失敗：${notice.error || response.status}`);
    } else setMessage(`審核失敗：${actionError.message}`);
    setBusy('');
    if (!actionError) await load();
  }

  async function reviewEvidence(item, status) {
    const reason = status === 'rejected' ? window.prompt('請輸入不採計原因') : (window.prompt('核准說明（可留空）') || '');
    if (status === 'rejected' && !reason?.trim()) return;
    setBusy(item.id); setMessage('');
    const { error: actionError } = await reviewProfessionalAwardEvidence(item.id, status, reason.trim());
    setBusy(''); setMessage(actionError ? `獎狀審核失敗：${actionError.message}` : '獎狀審核已更新。');
    if (!actionError) await load();
  }

  async function openImage(path) {
    const { data, error: signedError } = await createRenewalEvidenceSignedUrl(path);
    if (signedError || !data?.signedUrl) return setMessage(`圖片開啟失敗：${signedError?.message || '無法取得網址'}`);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function openLateWindow(row) {
    const deadline = window.prompt('補件截止時間（例如 2027-01-10T23:59:59+08:00）');
    if (!deadline) return;
    const reason = window.prompt('請輸入開放補件原因');
    if (!reason?.trim()) return;
    setBusy(`window-${row.id}`);
    const { error: actionError } = await openProfessionalEvidenceEntryWindow(row.user_id, row.assessment_year, deadline, reason.trim());
    setBusy(''); setMessage(actionError ? `開放失敗：${actionError.message}` : '已開放例外補件期間。');
  }

  async function correctNotice(row, notice) {
    const reason = window.prompt('請輸入季度通知更正原因');
    if (!reason?.trim()) return;
    setBusy(`notice-${notice.id}`);
    const { error: actionError } = await createProfessionalQuarterlyNoticeCorrection(row.user_id, notice.quarter_start, reason.trim());
    setBusy(''); setMessage(actionError ? `更正建立失敗：${actionError.message}` : '已建立新版季度通知，排程將重新發送並保留原版本。');
    if (!actionError) await load();
  }

  async function correctStandaloneNotice(notice) {
    return correctNotice({ user_id:notice.user_id }, notice);
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, marginBottom:24 }}>
        <div><p style={{ fontSize:11, color:'var(--gold)', letterSpacing:'0.18em', marginBottom:6 }}>PROFESSIONAL RENEWAL</p><h1 style={{ fontSize:34, fontWeight:300 }}>專業資格續約</h1></div>
        {canWrite && <button type="button" onClick={finalize} disabled={busy === 'finalize'} style={{ border:'none', background:'var(--black)', color:'#fff', padding:'12px 18px' }}>{busy === 'finalize' ? '結算中…' : '執行年度結算'}</button>}
      </div>
      {message && <div role="status" style={{ padding:12, border:'1px solid var(--border)', marginBottom:14 }}>{message}</div>}
      {error && <div role="alert" style={{ color:'var(--red)' }}>{error}</div>}
      {loading && <p>載入中…</p>}
      {!loading && rows.length === 0 && <p style={{ color:'var(--text-muted)' }}>目前尚無續約申請。</p>}
      <div style={{ display:'grid', gap:16 }}>
        {rows.map(row => {
          const assessment = row.assessment || {};
          return (
            <article key={row.id} style={{ border:'1px solid var(--border)', background:'#fff', padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:14 }}>
                <div><strong>{row.member_name || row.member_email || row.user_id}</strong><div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>{row.role} · 申請 {row.renewal_year} 年度</div></div>
                <strong>{RENEWAL_STATUS_LABELS[row.status] || row.status}</strong>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, fontSize:13, marginBottom:14 }}>
                <div>年度營業額<br/><strong>{formatRenewalMoney(assessment.annual_sales_amount)}</strong></div>
                <div>年度門檻<br/><strong>{formatRenewalMoney(assessment.annual_threshold)}</strong></div>
                <div>A 條件<br/><strong>{assessment.a_qualified ? '符合' : '未符合'}</strong></div>
                <div>已核准學員<br/><strong>{assessment.student_approved_count || row.b_approved_count || 0} / 8</strong></div>
              </div>
              {(row.evidence || []).map(item => (
                <div key={item.id} style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', padding:'9px 0', borderTop:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ flex:1 }}>{item.student_name} · {item.award_number} · {item.completed_on}</span>
                  <span>{EVIDENCE_STATUS_LABELS[item.status] || item.status}</span>
                  <button type="button" onClick={() => openImage(item.storage_path)}>查看圖片</button>
                  {canWrite && item.status === 'pending' && <><button type="button" disabled={busy === item.id} onClick={() => reviewEvidence(item, 'approved')}>採計</button><button type="button" disabled={busy === item.id} onClick={() => reviewEvidence(item, 'rejected')}>不採計</button></>}
                </div>
              ))}
              {(row.recent_notices || []).length > 0 && <details style={{ marginTop:14 }}>
                <summary style={{ cursor:'pointer', fontSize:13 }}>季度通知紀錄</summary>
                {(row.recent_notices || []).map(notice => <div key={notice.id} style={{ display:'flex', justifyContent:'space-between', gap:10, padding:'8px 0', borderTop:'1px solid var(--border)', fontSize:12 }}>
                  <span>{notice.quarter_start} · 版本 {notice.version} · {notice.status}</span>
                  {canWrite && <button type="button" disabled={busy === `notice-${notice.id}`} onClick={() => correctNotice(row, notice)}>建立更正版</button>}
                </div>)}
              </details>}
              {canWrite && <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
                {row.status === 'pending_review' && <><button type="button" disabled={busy === row.id} onClick={() => reviewApplication(row, 'approved')}>核准續約</button><button type="button" disabled={busy === row.id} onClick={() => reviewApplication(row, 'rejected')}>拒絕續約</button></>}
                <button type="button" disabled={busy === `window-${row.id}`} onClick={() => openLateWindow(row)}>開放例外補件</button>
              </div>}
            </article>
          );
        })}
      </div>
      <details style={{ marginTop:24, border:'1px solid var(--border)', background:'#fff', padding:16 }}>
        <summary style={{ cursor:'pointer', fontWeight:600 }}>全部季度通知紀錄（{notices.length}）</summary>
        {notices.map(notice => <div key={notice.id} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:12, padding:'10px 0', borderTop:'1px solid var(--border)', fontSize:12 }}>
          <span>{notice.member_name || notice.member_email || notice.user_id} · {notice.quarter_start} · 版本 {notice.version}</span>
          <span>{notice.status}{notice.channel ? ` · ${notice.channel}` : ''}</span>
          {canWrite && <button type="button" disabled={busy === `notice-${notice.id}`} onClick={() => correctStandaloneNotice(notice)}>建立更正版</button>}
        </div>)}
      </details>
    </div>
  );
}
