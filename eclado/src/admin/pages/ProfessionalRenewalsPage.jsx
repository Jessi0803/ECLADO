import React, { useEffect, useRef, useState } from 'react';
import { getMemberTier } from '../../domain/catalog.jsx';
import {
  EVIDENCE_STATUS_LABELS,
  formatRenewalMoney,
  getTaipeiYear,
  RENEWAL_STATUS_LABELS,
} from '../../domain/professionalRenewals.js';
import {
  createRenewalEvidenceSignedUrl,
  createProfessionalQuarterlyNoticeCorrection,
  fetchAdminProfessionalRenewalRoster,
  fetchAdminProfessionalQuarterlyNotices,
  finalizeProfessionalRenewalApplication,
  downgradeProfessionalRenewalNonapplicant,
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
  const [lateWindowForm, setLateWindowForm] = useState(null);
  const [lateWindowError, setLateWindowError] = useState('');
  const currentYear = getTaipeiYear();
  const [renewalYear, setRenewalYear] = useState(currentYear + 1);
  const [filter, setFilter] = useState('all');
  const [roster, setRoster] = useState(null);
  const loadVersion = useRef(0);
  const migrationReady = roster?.migrationReady === true;
  const visibleRows = rows.filter(row => filter === 'all'
    || (filter === 'submitted' && row.application_id)
    || (filter === 'not_applied' && ['not_applied','overdue'].includes(row.status))
    || (filter === 'unprocessed' && ['submitted','pending_review','not_applied','overdue'].includes(row.status))
    || (filter === 'processed' && ['approved','rejected','not_applied_downgraded','qualification_changed'].includes(row.status)));

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    const [renewalsResult, noticesResult] = await Promise.all([
      fetchAdminProfessionalRenewalRoster(renewalYear),
      fetchAdminProfessionalQuarterlyNotices(),
    ]);
    if (version !== loadVersion.current) return;
    setLoading(false);
    if (renewalsResult.error || noticesResult.error) {
      setRows([]); setRoster(null);
      return setError(`續約資料載入失敗：${renewalsResult.error?.message || noticesResult.error?.message}`);
    }
    setRoster(renewalsResult.data);
    setRows(Array.isArray(renewalsResult.data?.rows) ? renewalsResult.data.rows : []);
    setNotices(Array.isArray(noticesResult.data) ? noticesResult.data : []);
  }
  useEffect(() => {
    setRows([]); setRoster(null); setMessage(''); setLateWindowForm(null); setFilter('all');
    load();
    return () => { loadVersion.current += 1; };
  }, [renewalYear]);

  async function finalize(row) {
    if (busy || !migrationReady || !row.can_finalize) return;
    if (!window.confirm(`確定結算 ${row.member_name || row.member_email} 的 ${row.assessment_year} 年度採購資料？只處理此會員，不會變更其他會員資格。結算後採購快照不會因重複執行而重算。`)) return;
    setBusy(`finalize-${row.id}`); setMessage('');
    try {
      const { data, error: actionError } = await finalizeProfessionalRenewalApplication(row.application_id);
      setMessage(actionError ? `結算失敗：${actionError.message}` : data?.changed === false ? '此申請已處理，已重新載入最新狀態。' : '此會員已結算，請接著審核續約。');
      if (!actionError) await load();
    } catch (actionError) { setMessage(`結算失敗：${actionError.message}`); }
    finally { setBusy(''); }
  }

  async function downgrade(row) {
    if (busy || !migrationReady || !row.can_downgrade) return;
    const reason = window.prompt(`請輸入 ${row.member_name || row.member_email} 未申請 ${row.renewal_year} 年度續約的降級原因`, '逾期未提交年度續約申請');
    if (!reason?.trim()) return;
    if (reason.trim().length > 500) return setMessage('降級原因不可超過 500 字。');
    if (!window.confirm(`確定將 ${row.member_name || row.member_email} 降回美容師？從本次處理起不再享有師資／經銷商優惠，且會保留年度處理紀錄。`)) return;
    setBusy(`downgrade-${row.id}`); setMessage('');
    try {
      const { data, error: actionError } = await downgradeProfessionalRenewalNonapplicant(row.user_id, row.renewal_year, reason.trim());
      setMessage(actionError ? `降級失敗：${actionError.message}` : data?.changed === false ? '此會員已處理，已重新載入最新狀態。' : '已降回美容師，年度紀錄已保留。');
      if (!actionError) await load();
    } catch (actionError) { setMessage(`降級失敗：${actionError.message}`); }
    finally { setBusy(''); }
  }

  async function reviewApplication(row, decision) {
    if (busy || !migrationReady) return;
    const reason = window.prompt(decision === 'approved' ? '請輸入核准說明' : '請輸入未通過原因');
    if (!reason?.trim()) return;
    setBusy(row.id); setMessage('');
    try {
      const { error: actionError } = await reviewProfessionalRenewal(row.application_id, decision, reason.trim());
      if (actionError) return setMessage(`審核失敗：${actionError.message}`);
      // Review is already committed. A delivery failure must not invite a second review.
      try {
      const session = await supabase.auth.getSession();
      const token = session.data?.session?.access_token;
      const response = await fetch('/api/professional-renewal-notice', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify({ applicationId:row.application_id }),
      });
      const notice = await response.json().catch(() => ({}));
      setMessage(response.ok ? `審核完成，已透過 ${notice.channel === 'line' ? 'LINE' : 'Email'} 通知。` : `審核完成，但通知失敗：${notice.error || response.status}`);
      } catch (noticeError) { setMessage(`審核完成，但通知失敗：${noticeError.message}`); }
      await load();
    } catch (actionError) { setMessage(`審核失敗：${actionError.message}`); }
    finally { setBusy(''); }
  }

  async function reviewEvidence(item, status) {
    if (busy || !migrationReady) return;
    const reason = status === 'rejected' ? window.prompt('請輸入不採計原因') : (window.prompt('核准說明（可留空）') || '');
    if (status === 'rejected' && !reason?.trim()) return;
    setBusy(item.id); setMessage('');
    try {
      const { error: actionError } = await reviewProfessionalAwardEvidence(item.id, status, reason.trim());
      setMessage(actionError ? `獎狀審核失敗：${actionError.message}` : '獎狀審核已更新。');
      if (!actionError) await load();
    } catch (actionError) { setMessage(`獎狀審核失敗：${actionError.message}`); }
    finally { setBusy(''); }
  }

  async function openImage(path) {
    const { data, error: signedError } = await createRenewalEvidenceSignedUrl(path);
    if (signedError || !data?.signedUrl) return setMessage(`圖片開啟失敗：${signedError?.message || '無法取得網址'}`);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function openLateWindow(event, row) {
    event.preventDefault();
    if (busy || !migrationReady) return;
    const deadline = `${lateWindowForm.date}T${lateWindowForm.time}:00+08:00`;
    const reason = lateWindowForm.reason.trim();
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) {
      return setLateWindowError('請選擇未來的補件截止日期與時間。');
    }
    if (!reason) return setLateWindowError('請填寫開放補件原因。');
    setLateWindowError('');
    setBusy(`window-${row.id}`);
    try {
      const { error: actionError } = await openProfessionalEvidenceEntryWindow(row.user_id, row.assessment_year, deadline, reason);
      if (actionError) return setLateWindowError(`開放失敗：${actionError.message}`);
      setLateWindowForm(null);
      setMessage('已開放學員獎狀補件期間。');
    } catch (actionError) {
      setLateWindowError(`開放失敗：${actionError.message || '請稍後再試'}`);
    } finally {
      setBusy('');
    }
  }

  async function correctNotice(row, notice) {
    if (busy) return;
    const reason = window.prompt('請輸入季度通知更正原因');
    if (!reason?.trim()) return;
    setBusy(`notice-${notice.id}`);
    try {
      const { error: actionError } = await createProfessionalQuarterlyNoticeCorrection(row.user_id, notice.quarter_start, reason.trim());
      setMessage(actionError ? `更正建立失敗：${actionError.message}` : '已建立新版季度通知，排程將重新發送並保留原版本。');
      if (!actionError) await load();
    } catch (actionError) { setMessage(`更正建立失敗：${actionError.message}`); }
    finally { setBusy(''); }
  }

  async function correctStandaloneNotice(notice) {
    return correctNotice({ user_id:notice.user_id }, notice);
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:16, marginBottom:24 }}>
        <div style={{ flex:'1 1 480px' }}>
          <h1 style={{ fontFamily:'var(--font-d)', fontSize:28, fontWeight:400, marginBottom:4 }}>專業資格續約</h1>
          <p style={{ fontSize:13, color:'var(--mid)', lineHeight:1.7 }}>{renewalYear > currentYear ? `${renewalYear - 1} 年度尚未結束，不可提前結算或因未申請降級。` : '年度結算及未申請降級均由管理員逐人處理；未處理前保留原資格與優惠。'}<br/>逐人結算及未申請降級限當年度續約；歷史紀錄保留供查閱。</p>
        </div>
        <label style={{ display:'grid', gap:6, fontSize:12 }}>續約年度
          <select aria-label="續約年度" value={renewalYear} disabled={Boolean(busy)} onChange={event => setRenewalYear(Number(event.target.value))} style={{ border:'1px solid var(--border)', background:'#fff', padding:'10px 14px' }}>
            {Array.from({ length:currentYear - 2019 }, (_, index) => currentYear + 1 - index).map(year => <option key={year} value={year}>{year} 年度續約（採計 {year - 1} 年）</option>)}
          </select>
        </label>
      </div>
      {!loading && roster && <>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12, marginBottom:16 }}>
          {[
            ['當前師資＋經銷商', (roster.current_instructors || 0) + (roster.current_distributors || 0), `師資 ${roster.current_instructors || 0} 位／經銷商 ${roster.current_distributors || 0} 位`],
            [`${renewalYear} 年度續約名單`, roster.eligible_count, '降級與審核後仍保留在名單'],
            ['已提交申請', roster.submitted_count, '包含待結算、待審核及已審核'],
            ['未提交申請', roster.not_submitted_count, '包含已完成未申請降級者'],
            ['尚待處理', roster.unprocessed_count, '未提交、待結算及待審核'],
          ].map(([label, count, note]) => <div key={label} style={{ padding:16, border:'1px solid var(--border)', background:'#fff' }}>
            <div style={{ fontSize:12, color:'var(--mid)' }}>{label}</div><strong style={{ fontSize:26 }}>{count || 0} 位</strong>
            <div style={{ fontSize:11, color:'var(--mid)', marginTop:5 }}>{note}</div>
          </div>)}
        </div>
        {!migrationReady && <p role="alert" style={{ color:'#92400e', border:'1px solid var(--border)', padding:12, marginBottom:14 }}>目前為唯讀預覽：請先執行 supabase-professional-renewals-manual-processing.sql，才能使用逐人結算與未申請降級。未申請者的採購及獎狀資料將於 SQL 部署後載入。</p>}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:18 }}>
          {[['all','全部名單'],['submitted','已提交'],['not_applied','未提交待處理'],['unprocessed','尚待處理'],['processed','已處理／資格已變更']].map(([value,label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ padding:'8px 12px', border:'1px solid var(--border)', background:filter === value ? 'var(--dark)' : '#fff', color:filter === value ? '#fff' : 'var(--dark)' }}>{label}</button>)}
        </div>
      </>}
      {message && <div role="status" style={{ padding:12, border:'1px solid var(--border)', marginBottom:14 }}>{message}</div>}
      {error && <div role="alert" style={{ color:'var(--red)' }}>{error}</div>}
      {loading && <p>載入中…</p>}
      {!loading && !error && visibleRows.length === 0 && <p style={{ color:'var(--mid)' }}>此年度或篩選條件下尚無會員。</p>}
      <div style={{ display:'grid', gap:16 }}>
        {visibleRows.map(row => {
          const assessment = row.assessment || {};
          return (
            <article key={row.id} style={{ border:'1px solid var(--border)', background:'#fff', padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:14 }}>
                <div><strong>{row.member_name || row.member_email || row.user_id}</strong><div style={{ fontSize:12, color:'var(--mid)', marginTop:4 }}>{getMemberTier({ role: row.role }).label} · {row.renewal_year} 年度續約</div>
                  {row.member_role && row.member_role !== row.role && <div style={{ fontSize:12, color:'var(--mid)', marginTop:4 }}>目前身分：{getMemberTier({ role:row.member_role }).label}</div>}
                </div>
                <strong>{RENEWAL_STATUS_LABELS[row.status] || row.status}</strong>
              </div>
              {row.assessment && <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, fontSize:13, marginBottom:14 }}>
                <div>年度營業額<br/><strong>{formatRenewalMoney(assessment.annual_sales_amount)}</strong></div>
                <div>年度門檻<br/><strong>{formatRenewalMoney(assessment.annual_threshold)}</strong></div>
                <div>續約條件（採購）<br/><strong style={{ color:assessment.a_qualified ? '#166534' : '#b91c1c' }}>{assessment.a_qualified ? '符合' : '未符合'}</strong>
                  <div style={{ marginTop:4, fontSize:12, color:'var(--text-muted)' }}>
                    {assessment.quarterly_route_qualified && assessment.annual_route_qualified
                      ? '季度與年度累計皆達標'
                      : assessment.quarterly_route_qualified
                        ? '各有效季度達標'
                        : assessment.annual_route_qualified
                          ? '年度累計達標且各季非零'
                          : '季度與年度累計路徑皆未達標'}
                  </div>
                </div>
                <div>已核准學員<br/><strong>{row.b_approved_count ?? assessment.student_approved_count ?? 0} / 8</strong></div>
              </div>}
              {row.decision_reason && <p style={{ fontSize:12, marginBottom:12, color:'var(--mid)' }}>處理原因：{row.decision_reason}{row.reviewed_at ? ` · ${new Date(row.reviewed_at).toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })}` : ''}</p>}
              {row.status === 'qualification_changed' && <p style={{ fontSize:12, color:'var(--mid)', marginBottom:12 }}>資格已另行調整，請先確認會員資格紀錄，不提供未申請降級操作。</p>}
              {row.assessment && <details style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginBottom:14 }}>
                <summary style={{ fontSize:13, fontWeight:600, cursor:'pointer' }}>各有效季度採購進度</summary>
                <p style={{ fontSize:12, color:'#777', lineHeight:1.7, marginTop:10, marginBottom:10 }}>每季 NT$30,000、年度 NT$120,000，皆依有效資格天數比例計算。各有效季度達標，或年度累計達標且各有效季度皆有進貨，即符合續約條件。</p>
                {(assessment.quarters || []).length === 0 ? <p style={{ fontSize:12, color:'var(--text-muted)' }}>目前尚無有效季度資料。</p> : (
                  <div style={{ display:'grid', gap:8 }}>
                    {assessment.quarters.map(quarter => (
                      <div key={quarter.quarter_start} style={{ display:'flex', alignItems:'baseline', flexWrap:'wrap', gap:'6px 16px', fontSize:12 }}>
                        <strong>{quarter.quarter_start?.slice(0, 4)} 年 Q{quarter.calendar_quarter}</strong>
                        <span>採購 {formatRenewalMoney(quarter.sales_amount)}</span>
                        <span>門檻 {formatRenewalMoney(quarter.threshold_amount)}</span>
                        <span style={{ color:quarter.has_zero_sales ? 'var(--red)' : quarter.meets_quarter_threshold ? '#166534' : 'var(--text-muted)' }}>{quarter.has_zero_sales ? '零進貨' : quarter.meets_quarter_threshold ? '季度達標' : '季度未達標'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </details>}
              {(row.evidence || []).map(item => (
                <div key={item.id} style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', padding:'9px 0', borderTop:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ flex:1 }}>{item.student_name} · {item.award_number} · {item.completed_on}</span>
                  <span>{EVIDENCE_STATUS_LABELS[item.status] || item.status}</span>
                  <button type="button" onClick={() => openImage(item.storage_path)}>查看圖片</button>
                  {canWrite && item.status === 'pending' && <><button type="button" disabled={Boolean(busy) || !migrationReady} onClick={() => reviewEvidence(item, 'approved')}>採計</button><button type="button" disabled={Boolean(busy) || !migrationReady} onClick={() => reviewEvidence(item, 'rejected')}>不採計</button></>}
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
                {row.status === 'submitted' && <button type="button" disabled={Boolean(busy) || !migrationReady || !row.can_finalize} onClick={() => finalize(row)}>{busy === `finalize-${row.id}` ? '結算中…' : '結算此會員'}</button>}
                {row.status === 'overdue' && <button type="button" disabled={Boolean(busy) || !migrationReady || !row.can_downgrade} onClick={() => downgrade(row)}>{busy === `downgrade-${row.id}` ? '處理中…' : '未申請降回美容師'}</button>}
                {row.status === 'pending_review' && <><button type="button" disabled={Boolean(busy) || !migrationReady} onClick={() => reviewApplication(row, 'approved')}>核准續約</button><button type="button" disabled={Boolean(busy) || !migrationReady} onClick={() => reviewApplication(row, 'rejected')}>拒絕續約</button></>}
                {row.application_id && ['submitted','pending_review'].includes(row.status) && <button type="button" disabled={Boolean(busy) || !migrationReady} onClick={() => { setLateWindowError(''); setLateWindowForm({ id:row.id, date:'', time:'23:59', reason:'' }); }}>開放學員獎狀補件</button>}
              </div>}
              {canWrite && lateWindowForm?.id === row.id && (
                <form onSubmit={event => openLateWindow(event, row)} style={{ marginTop:16, padding:16, border:'1px solid var(--border)', background:'var(--bg)' }}>
                  <strong>開放學員獎狀補件</strong>
                  <p style={{ fontSize:12, color:'var(--text-muted)', margin:'8px 0 12px' }}>僅開放此會員 {row.assessment_year} 年度的學員獎狀補件，不延長續約申請期限。</p>
                  <fieldset disabled={busy === `window-${row.id}`} style={{ border:0, padding:0, margin:0, minWidth:0 }}>
                    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                      <label style={{ display:'grid', gap:6 }}>截止日期（台灣時間）
                        <input type="date" required value={lateWindowForm.date} onChange={event => setLateWindowForm(previous => ({ ...previous, date:event.target.value }))} style={{ padding:10, border:'1px solid var(--border)', background:'#fff' }} />
                      </label>
                      <label style={{ display:'grid', gap:6 }}>截止時間
                        <input type="time" required step="60" value={lateWindowForm.time} onChange={event => setLateWindowForm(previous => ({ ...previous, time:event.target.value }))} style={{ padding:10, border:'1px solid var(--border)', background:'#fff' }} />
                      </label>
                    </div>
                    <label style={{ display:'grid', gap:6, marginTop:12 }}>開放原因
                      <textarea required rows={3} value={lateWindowForm.reason} onChange={event => setLateWindowForm(previous => ({ ...previous, reason:event.target.value }))} placeholder="請說明本次開放補件的原因" style={{ width:'100%', boxSizing:'border-box', padding:10, border:'1px solid var(--border)', resize:'vertical' }} />
                    </label>
                    {lateWindowError && <p role="alert" style={{ color:'#b91c1c', marginTop:10 }}>{lateWindowError}</p>}
                    <div style={{ display:'flex', gap:8, marginTop:12 }}>
                      <button type="submit">{busy === `window-${row.id}` ? '儲存中…' : '確認開放'}</button>
                      <button type="button" onClick={() => { setLateWindowForm(null); setLateWindowError(''); }}>取消</button>
                    </div>
                  </fieldset>
                </form>
              )}
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
