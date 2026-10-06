import React, { useState } from 'react';
import {
  EVIDENCE_STATUS_LABELS,
  formatRenewalMoney,
  RENEWAL_STATUS_LABELS,
  renewalQualificationText,
} from '../../domain/professionalRenewals.js';
import {
  deleteProfessionalAwardEvidence,
  submitProfessionalRenewal,
  uploadProfessionalAwardEvidence,
  validateRenewalEvidenceFile,
} from '../../services/professionalRenewals.js';

const emptyForm = { studentName: '', completedOn: '', awardNumber: '', consentAcknowledged: false };

export default function ProfessionalRenewalPanel({ user, renewal, loading, error, isMobile, onReload }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const assessment = renewal?.assessment || {};
  const application = renewal?.currentApplication || renewal?.latestApplication;
  const evidence = renewal?.evidence || [];
  const provisionalCount = Number(assessment.student_provisional_count) || 0;

  if (loading) return <p style={{ padding:'22px 0', color:'var(--dark)', fontSize:13 }}>正在載入續約資料…</p>;
  if (error) return <div role="alert" style={{ border:'1px solid #fecaca', color:'#991b1b', padding:14 }}>{error}</div>;
  if (!renewal) return null;

  async function submitRenewal() {
    if (!window.confirm(`確定送出 ${renewal.currentYear + 1} 年度續約申請？送出後不可撤回。`)) return;
    setBusy('application'); setMessage('');
    const { error: submitError } = await submitProfessionalRenewal();
    setBusy('');
    setMessage(submitError ? `送出失敗：${submitError.message}` : '續約申請已送出。');
    if (!submitError) await onReload();
  }

  async function saveEvidence(event) {
    event.preventDefault();
    const fileError = validateRenewalEvidenceFile(file);
    if (!form.studentName.trim() || !form.completedOn || !form.awardNumber.trim()) return setMessage('請完整填寫學員、結業日期與獎狀編號。');
    if (!form.consentAcknowledged) return setMessage('請先確認已告知學員資料用途。');
    if (fileError) return setMessage(fileError);
    setBusy('evidence'); setMessage('');
    const { error: saveError } = await uploadProfessionalAwardEvidence(user.uid, {
      ...form,
      studentName: form.studentName.trim(),
      awardNumber: form.awardNumber.trim(),
    }, file);
    setBusy('');
    setMessage(saveError ? `儲存失敗：${saveError.message}` : '學員獎狀資料已送出，核准前僅列入暫估。');
    if (!saveError) {
      setForm(emptyForm); setFile(null);
      event.currentTarget.reset();
      await onReload();
    }
  }

  async function removeEvidence(item) {
    if (!window.confirm('確定刪除這筆待審核資料？')) return;
    setBusy(item.id); setMessage('');
    const { error: deleteError } = await deleteProfessionalAwardEvidence(item);
    setBusy(''); setMessage(deleteError ? `刪除失敗：${deleteError.message}` : '資料已刪除。');
    if (!deleteError) await onReload();
  }

  const inputStyle = { border:'1px solid var(--light)', padding:'11px 12px', fontSize:13, fontFamily:'var(--font-body)', width:'100%', boxSizing:'border-box', background:'var(--white)' };
  return (
    <section aria-label="專業資格續約" style={{ borderTop:'1px solid var(--black)', paddingTop:24, marginBottom:isMobile ? 34 : 44 }}>
      <p style={{ fontSize:10, color:'var(--accent)', letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:6 }}>Professional Renewal</p>
      <h2 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 24 : 30, fontWeight:300, marginBottom:18 }}>專業資格續約</h2>

      <div style={{ border:'1px solid var(--light)', padding:isMobile ? 16 : 22, marginBottom:18 }}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap:14 }}>
          <div><small>年度累計</small><div>{formatRenewalMoney(assessment.annual_sales_amount)}</div></div>
          <div><small>年度暫估門檻</small><div>{formatRenewalMoney(assessment.annual_threshold)}</div></div>
          <div><small>尚差</small><div>{formatRenewalMoney(assessment.annual_remaining_amount)}</div></div>
          <div><small>品牌專班學員</small><div>{provisionalCount} 位（暫估）</div></div>
        </div>
        <p style={{ fontSize:12, color:'var(--dark)', marginTop:14, lineHeight:1.7 }}>{renewalQualificationText(assessment)}</p>
      </div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:24 }}>
        <div style={{ fontSize:13 }}>
          {application ? `${application.renewal_year} 年度：${RENEWAL_STATUS_LABELS[application.status] || application.status}` : `${renewal.currentYear + 1} 年度尚未申請`}
        </div>
        {!renewal.currentApplication && renewal.applicationWindowOpen && (
          <button type="button" onClick={submitRenewal} disabled={busy === 'application'} style={{ border:'none', background:'var(--black)', color:'var(--white)', padding:'11px 18px', cursor:'pointer' }}>
            {busy === 'application' ? '送出中…' : '送出下一年度續約申請'}
          </button>
        )}
        {!renewal.currentApplication && !renewal.applicationWindowOpen && <span style={{ fontSize:11, color:'var(--dark)' }}>申請期間：10/1–12/31</span>}
      </div>

      <h3 style={{ fontSize:16, fontWeight:500, marginBottom:12 }}>品牌專班學員獎狀</h3>
      <form onSubmit={saveEvidence} style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 160px 1fr', gap:10, border:'1px solid var(--light)', padding:isMobile ? 14 : 18 }}>
        <input aria-label="學員姓名" placeholder="學員姓名" value={form.studentName} onChange={e => setForm(v => ({ ...v, studentName:e.target.value }))} maxLength={100} style={inputStyle} />
        <input aria-label="結業日期" type="date" value={form.completedOn} onChange={e => setForm(v => ({ ...v, completedOn:e.target.value }))} style={inputStyle} />
        <input aria-label="獎狀編號" placeholder="獎狀編號" value={form.awardNumber} onChange={e => setForm(v => ({ ...v, awardNumber:e.target.value }))} maxLength={100} style={inputStyle} />
        <input aria-label="獎狀圖片" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, gridColumn:isMobile ? 'auto' : '1 / 3' }} />
        <button type="submit" disabled={busy === 'evidence'} style={{ border:'none', background:'var(--black)', color:'var(--white)', padding:11, cursor:'pointer' }}>{busy === 'evidence' ? '上傳中…' : '新增資料'}</button>
        <label style={{ gridColumn:'1 / -1', fontSize:11, color:'var(--dark)', lineHeight:1.6 }}>
          <input type="checkbox" checked={form.consentAcknowledged} onChange={e => setForm(v => ({ ...v, consentAcknowledged:e.target.checked }))} />{' '}
          我已告知學員其姓名、獎狀編號與影像將用於 ECLADO 專業資格續約審核。
        </label>
      </form>

      {message && <p role="status" style={{ fontSize:12, color:message.includes('失敗') ? '#b91c1c' : '#166534', marginTop:10 }}>{message}</p>}
      <div style={{ marginTop:14 }}>
        {evidence.length === 0 ? <p style={{ fontSize:12, color:'var(--dark)' }}>本年度尚無學員獎狀資料。</p> : evidence.map(item => (
          <div key={item.id} style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr auto' : '1fr 140px 120px auto', gap:10, alignItems:'center', padding:'11px 0', borderBottom:'1px solid var(--light)', fontSize:12 }}>
            <span>{item.student_name} · {item.award_number} · {item.assessment_year} 年</span>
            {!isMobile && <span>{item.completed_on}</span>}
            <span>{EVIDENCE_STATUS_LABELS[item.status] || item.status}</span>
            {item.status === 'pending' && <button type="button" disabled={busy === item.id} onClick={() => removeEvidence(item)} style={{ border:'none', background:'none', color:'#b91c1c', cursor:'pointer' }}>刪除</button>}
          </div>
        ))}
      </div>
    </section>
  );
}
