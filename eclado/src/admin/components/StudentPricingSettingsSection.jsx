import '../../components/account/InstructorRewards.css';
import React, { useEffect, useState } from 'react';
import { parseFold, formatFold } from '../../domain/memberPricing.js';
import { fetchStudentPricingSettings, fetchStudentPricingHistory, saveStudentPricingSettings } from '../../services/instructorStudents.js';

export default function StudentPricingSettingsSection() {
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState({});
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setBusy(true); setError(''); setMessage('');
    try {
      const [settings, entries] = await Promise.all([fetchStudentPricingSettings(), fetchStudentPricingHistory()]);
      if (settings.error) throw settings.error;
      if (entries.error) throw entries.error;
      if (!settings.data?.multipliers) throw new Error('學生設定格式不完整');
      setSnapshot(settings.data);
      setDraft(Object.fromEntries(['student_1', 'student_2'].map(key => [key, String(formatFold(settings.data.multipliers[key]))])));
      setHistory(entries.data || []);
    } catch (err) {
      setSnapshot(null); setError(`無法載入學生設定：${err.message}。若尚未安裝 1B，請由管理員依部署文件處理。`);
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault(); if (busy || !snapshot) return;
    setError(''); setMessage('');
    let multipliers;
    try { multipliers = Object.fromEntries(['student_1', 'student_2'].map(key => [key, parseFold(draft[key])])); }
    catch (err) { setError(err.message); return; }
    setBusy(true);
    try {
      const result = await saveStudentPricingSettings(multipliers, snapshot.version);
      if (result.error) throw result.error;
      setSnapshot(result.data);
      setMessage('學生全域折數已儲存，目前商品售價不變。');
      const entries = await fetchStudentPricingHistory();
      if (entries.error) setError(`設定已儲存，但異動歷史讀取失敗：${entries.error.message}；請重新載入確認。`);
      else setHistory(entries.data || []);
    } catch (err) { setError(`儲存失敗：${err.message}`); }
    finally { setBusy(false); }
  }
  return <section aria-label="學生全域價格設定" className="reward-view reward-panel reward-settings">
    <h2 className="reward-heading">學生價格設定</h2>
    <p className="reward-note">目前只儲存設定，尚未套用學生專屬售價。</p>
    <form onSubmit={save}><div className="reward-form-grid">
      {['student_1', 'student_2'].map((key, index) => <label key={key} className="reward-field">
        學生{index + 1}預設折數
        <div className="reward-fold">
          <input aria-label={`學生${index + 1}預設折數`} type="number" min="0.01" max="10" step="0.01" required
            value={draft[key] ?? ''} disabled={busy || !snapshot}
            onChange={e => setDraft(previous => ({ ...previous, [key]:e.target.value }))}
             />折
        </div>
      </label>)}
      </div><div className="reward-actions">
        <button type="submit" disabled={busy || !snapshot} className="admin-primary-btn">儲存學生折數</button>
        <button type="button" disabled={busy} onClick={load} className="admin-secondary-btn">重新載入學生設定</button>
      </div>
    </form>
    {error && <p role="alert" style={{ color:'var(--red)', fontSize:12 }}>{error}</p>}
    {message && <p role="status" style={{ color:'var(--green)', fontSize:12 }}>{message}</p>}
    <details className="reward-details"><summary>學生折數異動歷史（最近100筆）</summary>
      {!history.length ? <p>尚無異動</p> : history.map(entry => <div key={entry.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
        {new Date(entry.created_at).toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })} · 操作者 {entry.actor_user_id || '系統'}
        <div>學生1：{formatFold(entry.before_data.student_1)} → {formatFold(entry.after_data.student_1)} 折；學生2：{formatFold(entry.before_data.student_2)} → {formatFold(entry.after_data.student_2)} 折</div>
      </div>)}
    </details>
  </section>;
}
