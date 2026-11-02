import React, { useEffect, useState } from 'react';
import { fetchInstructorStudentNotifications } from '../../services/instructorStudents.js';

const eventLabels = { bind: '建立綁定', rebind: '更換老師', unbind: '解除綁定' };
const audienceLabels = { student: '學生', teacher: '新綁定老師', former_teacher: '原老師' };
const statusLabels = { pending: '等待發送', sending: '發送中', retry: '等待重試', sent: '已送出', failed: '發送失敗', unknown: '發送結果待確認', blocked: '暫時無法發送' };

export default function InstructorStudentNotifications({ studentId, revision }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); setData(null); }, [studentId, revision]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(''); setData(null);
    fetchInstructorStudentNotifications(studentId, offset).then(result => {
      if (!active) return;
      if (result.error) setError(result.error.code === 'PGRST202' ? '師生通知功能尚未安裝。' : '通知紀錄暫時無法載入，請稍後重新展開。');
      else setData(result.data);
    }).catch(() => { if (active) setError('通知紀錄暫時無法載入，請稍後重新展開。'); });
    return () => { active = false; };
  }, [open, studentId, offset, revision]);
  return <details className="reward-details" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>師生綁定通知紀錄</summary>
    <p className="reward-note">通知學生與相關老師，優先透過 LINE 發送，無法發送時改以 Email 通知。</p>
    {error && <p role="alert">{error}</p>}
    {!error && !data && <p>載入通知紀錄中…</p>}
    {data && <>
      {!data.notifications?.length && <p>尚無師生綁定通知紀錄。</p>}
      {(data.notifications || []).map(n => <div key={n.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <strong>{eventLabels[n.event_type] || '師生異動'} · {audienceLabels[n.audience] || '收件人'}</strong>
        <p>{statusLabels[n.status] || '處理中'}{n.channel && ` · ${n.channel === 'line' ? 'LINE' : 'Email'}`}{n.recipient_mask && ` · ${n.recipient_mask}`}</p>
        <small>{new Date(n.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</small>
      </div>)}
      {data.total > 20 && <div className="reward-actions">
        <button type="button" className="reward-button" disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 20))}>上一頁通知</button>
        <button type="button" className="reward-button" disabled={offset + 20 >= data.total} onClick={() => setOffset(n => n + 20)}>下一頁通知</button>
      </div>}
    </>}
  </details>;
}
