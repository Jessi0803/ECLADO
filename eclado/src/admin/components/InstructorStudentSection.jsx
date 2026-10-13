import '../../components/account/InstructorRewards.css';
import React, { useEffect, useState } from 'react';
import { fetchInstructorStudentMember, saveInstructorStudentType, saveInstructorStudentBinding } from '../../services/instructorStudents.js';

const labels = { bind:'建立綁定', unbind:'解除綁定', rebind:'更換老師', instructor_type:'老師類型變更', member_deleted:'會員刪除結束綁定' };

export default function InstructorStudentSection({ member, members, canManage }) {
  const [data, setData] = useState(null);
  const [type, setType] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setMessage(''); setSearch(''); setTeacherId(''); setBusy(true);
    fetchInstructorStudentMember(member.id).then(result => {
      if (!active) return;
      if (result.error) { setError(`無法載入師生設定：${result.error.message}`); return; }
      setData(result.data); setType(result.data?.instructor_settings?.student_price_type || '');
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [member.id, member.type]);
  async function reload() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await fetchInstructorStudentMember(member.id);
      if (result.error) throw result.error;
      setData(result.data); setType(result.data?.instructor_settings?.student_price_type || '');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveType(event) {
    event.preventDefault(); if (busy || !data) return;
    if (!type && data.students?.length && !window.confirm('清空學生類型會保留綁定並暫停學生价格資格；重新設定類型後恢復。確定清空？')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveInstructorStudentType(member.id, type, data.instructor_settings?.version ?? 0);
      if (result.error) throw result.error;
      setData(result.data); setMessage('老師學生類型已儲存，商品售價不變。');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveBinding(action) {
    if (busy || !data) return;
    const selectedTeacher = members.find(row => row.id === teacherId);
    if (action === 'unbind' && !window.confirm('確定解除此學生與目前老師的綁定？異動歷史會保留。')) return;
    if (action === 'rebind' && !window.confirm(`確定由「${data.context.instructor_name || data.context.instructor_id}」更換至「${selectedTeacher?.name || teacherId}」？歷史會保留。`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveInstructorStudentBinding({ studentId:member.id, instructorId:action === 'unbind' ? null : teacherId,
        bindingId:data.context?.binding_id, action });
      if (result.error) throw result.error;
      setData(result.data); setTeacherId(''); setMessage(`${labels[action]}已完成，商品售價不變。`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const context = data?.context;
  const teachers = members.filter(row => row.type === 'instructor' && row.id !== member.id
    && `${row.name} ${row.id}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="師生綁定設定" className="reward-view reward-binding">
    <h4 >師生綁定與學生類型</h4>
    <p className="reward-note">此階段只管理資料，學生價格與返饋金尚未啟用。</p>
    {busy && <p>處理中…</p>}
    {error && <p role="alert" style={{ color:'var(--red)' }}>{error}</p>}
    {message && <p role="status" style={{ color:'var(--green)' }}>{message}</p>}
    <button type="button" onClick={reload} disabled={busy} className="reward-button">重新載入師生設定</button>
    {data && <>
      {(member.type === 'instructor' || data.instructor_settings) && <div className="reward-details">
        <form onSubmit={saveType}>
          <label className="reward-field">老師學生價格類型<select aria-label="老師學生價格類型" value={type}
            disabled={!canManage || busy || member.type !== 'instructor'} onChange={e => setType(e.target.value)}>
            <option value="">未設定</option><option value="student_1">學生1</option><option value="student_2">學生2</option>
          </select></label>
          {canManage && member.type === 'instructor' && <button type="submit" disabled={busy} className="reward-button reward-button--primary">儲存老師類型</button>}
        </form>
        <p>目前名下學生：{data.students?.length || 0} 位</p>
        {(data.students || []).map(student => <div key={student.binding_id} style={{ padding:'6px 0' }}>
          {student.student_name || student.student_id} · {student.context.student_pricing_eligible ? '資格符合（價格未啟用）' : '資格暫停'}
        </div>)}
      </div>}
      {(member.type === 'pro' || context?.has_binding) && <div className="reward-details">
        <p>目前老師：{context?.has_binding ? context.instructor_name || context.instructor_id : '未綁定'}</p>
        {context?.has_binding && <p>類型：{context.student_price_type || '未設定'} · {context.student_pricing_eligible ? '資格符合（價格未啟用）' : '資格暫停'}
          {!context.student_role_eligible && '；學生目前不是 pro'}{!context.instructor_role_eligible && '；老師目前不是 instructor'}{!context.instructor_type_set && '；老師尚未設定類型'}
        </p>}
        {canManage && <>
          <label className="reward-field"><span>搜尋老師</span><input aria-label="搜尋綁定老師" placeholder="搜尋老師姓名" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <label className="reward-field"><span>綁定老師</span><select aria-label="選擇綁定老師" value={teacherId} onChange={e => setTeacherId(e.target.value)} disabled={busy} >
            <option value="">選擇老師</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select></label>
          <div className="reward-actions">
            <button type="button" disabled={busy || !teacherId} onClick={() => saveBinding(context?.has_binding ? 'rebind' : 'bind')} className="reward-button">{context?.has_binding ? '更換老師' : '建立師生綁定'}</button>
            {context?.has_binding && <button type="button" disabled={busy} onClick={() => saveBinding('unbind')} className="reward-button">解除師生綁定</button>}
          </div>
        </>}
      </div>}
      <details className="reward-details"><summary>師生異動歷史（最近100筆）</summary>
        {!data.history?.length ? <p>尚無異動</p> : data.history.map(entry => <div key={entry.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)', overflowWrap:'anywhere' }}>
          {new Date(entry.created_at).toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })} · {labels[entry.event_type] || entry.event_type}
          <div>操作者：{entry.actor_user_id || '系統（會員刪除）'}</div>
          {entry.event_type === 'instructor_type' ? <div>類型：{entry.before_data.student_price_type || '未設定'} → {entry.after_data.student_price_type || '未設定'}</div>
            : <div>原老師：{entry.previous_instructor_id || '無'} → 新老師：{entry.event_type === 'member_deleted' ? '無（會員已刪除）' : entry.instructor_id || '無'}</div>}
        </div>)}
      </details>
    </>}
  </section>;
}
