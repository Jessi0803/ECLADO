import React, { useEffect, useRef, useState } from 'react';
import { getAdminCourseIncome, getAdminCourseNotifications, queueCourseNotification } from '../../services/courses.js';
import { formatCoursePrice, COURSE_PARTICIPANT_LABELS } from '../../domain/courses.js';

const statuses = {
  pending: '待發送', sending: '發送中', retry: '等待重試', sent: '服務商已接受',
  failed: '失敗', unknown: '結果待確認', skipped: '已略過',
};
const reasons = {
  no_channel: '無可用通知管道', no_longer_eligible: '報名資格或課程時間已變更',
  delivery_unconfirmed: '服務商未確認結果', configuration: '通知服務設定不完整',
  permanent: '服務商拒絕', line_rejected: 'LINE 拒絕，等待 Email',
  line_unavailable: 'LINE 不可用，等待 Email', ambiguous: '連線中斷或結果未確認',
  line_server_error: 'LINE 暫時無法處理', line_rate_limited: 'LINE 請求次數受限', transient: 'Email 暫時無法處理',
};
const date = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' });

export function CourseIncome({ courseId }) {
  const [income, setIncome] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getAdminCourseIncome(courseId).then(data => { if (active) setIncome(data); })
      .catch(() => { if (active) setError('目前無法載入課程收入。'); });
    return () => { active = false; };
  }, [courseId]);
  if (error) return <p className="procurement-error" role="alert">{error}</p>;
  if (!income) return <p role="status">載入課程收入中…</p>;
  return (
    <dl className="procurement-stats admin-course-income" aria-label="課程收入摘要">
      <div><dt>正常收款 · {income.paid_orders} 筆</dt><dd>{formatCoursePrice(income.paid_twd)}</dd></div>
      <div><dt>待人工確認的收款</dt><dd>{formatCoursePrice(income.review_twd)}</dd></div>
      <div><dt>已登錄退款</dt><dd>{formatCoursePrice(income.refund_twd)}</dd></div>
      <div><dt>淨收款（含待確認收款）</dt><dd>{formatCoursePrice(income.net_twd)}</dd></div>
    </dl>
  );
}

export function CourseNotifications({ course, registrations, canSend, initialOnlyExceptions }) {
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [onlyExceptions, setOnlyExceptions] = useState(Boolean(initialOnlyExceptions));
  const [history, setHistory] = useState([]);
  const [more, setMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const historyHeading = useRef(null);
  const request = useRef(null);
  const submitting = useRef(false);
  const loadSequence = useRef(0);
  const eligible = registrations.filter(item => item.status === 'active');
  const validSelection = selected.filter(id => eligible.some(item => item.id === id));

  async function loadHistory(offset = 0) {
    const seq = ++loadSequence.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await getAdminCourseNotifications(course.id, offset, onlyExceptions);
      if (seq !== loadSequence.current) return;
      setHistory(previous => offset ? [...previous, ...rows.filter(row => !previous.some(item => item.id === row.id))] : rows);
      setMore(rows.length === 30);
    } catch {
      if (seq === loadSequence.current) setHistoryError('目前無法載入發送紀錄。');
    } finally {
      if (seq === loadSequence.current) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    setHistory([]);
    setMore(false);
    void loadHistory();
    return () => { loadSequence.current++; };
  }, [course.id, onlyExceptions]);

  useEffect(() => {
    if (initialOnlyExceptions) historyHeading.current?.focus();
  }, [initialOnlyExceptions]);

  async function submit(event) {
    event.preventDefault();
    if (!validSelection.length || submitting.current) return;
    const fingerprint = JSON.stringify([validSelection, message]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    submitting.current = true;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const count = await queueCourseNotification(course.id, request.current.id, validSelection, message);
      setNotice(count ? `已排入 ${count} 位收件人的通知。` : '所選報名已無有效收件人。');
      request.current = null;
      setSelected([]);
      setMessage('');
      await loadHistory();
    } catch (failure) {
      setError(failure.message || '無法排入通知，請稍後再試。');
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  return (
    <section className="admin-course-notices">
      {canSend && Date.parse(course.ends_at) > Date.now() && (
        <form className="procurement-form-card admin-course-editor" onSubmit={submit}>
          <h3>手動通知</h3>
          {error && <p className="procurement-error" role="alert">{error}</p>}
          {notice && <p className="admin-course-feedback" role="status">{notice}</p>}
          <fieldset disabled={sending}>
            {eligible.length ? (
              <>
                <button type="button" className="admin-secondary-btn" onClick={() =>
                  setSelected(validSelection.length === eligible.length ? [] : eligible.map(item => item.id))}>
                  {validSelection.length === eligible.length ? '取消全選' : '全選有效報名'}
                </button>
                <div className="admin-course-notice-selection">
                  {eligible.map(item => (
                    <label key={item.id}>
                      <input type="checkbox" checked={selected.includes(item.id)} onChange={event => {
                        const checked = event.currentTarget.checked;
                        setSelected(previous => checked ? [...previous, item.id] : previous.filter(id => id !== item.id));
                      }} />
                      <span>{item.name} · {COURSE_PARTICIPANT_LABELS[item.kind]}{item.kind === 'delegated' && ` · 寄給 ${item.payer_name}`}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : <p>目前沒有有效報名可發送。</p>}
            <label>補充說明（選填）<textarea rows={3} maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} /></label>
            <button className="admin-primary-btn" disabled={!validSelection.length} type="submit">{sending ? '處理中…' : '排入通知'}</button>
          </fieldset>
        </form>
      )}

      <div className="admin-course-actions">
        <h3 ref={historyHeading} tabIndex={-1}>發送紀錄</h3>
        <div className="admin-course-history-controls">
          <label>
            <input type="checkbox" checked={onlyExceptions} disabled={sending}
              onChange={event => setOnlyExceptions(event.target.checked)} />
            只顯示通知異常
          </label>
          <button className="admin-secondary-btn" type="button" disabled={historyLoading} onClick={() => loadHistory()}>重新整理發送紀錄</button>
        </div>
      </div>
      {historyError && <p className="procurement-error" role="alert">{historyError}</p>}
      {historyLoading && <p role="status">載入發送紀錄中…</p>}
      {!history.length && !historyLoading && !historyError && <p>{onlyExceptions ? '目前沒有通知異常。' : '目前沒有通知紀錄。'}</p>}
      {history.length > 0 && <div className="table-scroll procurement-list-wrap admin-course-table">
        <table className="responsive-admin-table procurement-items-table">
          <thead><tr>{['收件人', '通知類型', '管道', '結果', '排入／送出時間'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{history.map(item => (
            <tr key={item.id}>
              <td data-label="收件人"><strong>{item.payer_name}</strong></td><td data-label="通知類型">{{automatic:'課前提醒',manual:'手動通知',payment_first:'課程付款提醒',payment_final:'課程最後付款提醒'}[item.kind] || item.kind}</td>
              <td data-label="管道">{item.channel === 'line' ? 'LINE' : item.channel === 'email' ? 'Email' : '—'}</td>
              <td data-label="結果"><span className={`procurement-status ${item.status === 'sent' ? 'status-received' : item.status === 'failed' ? 'status-cancelled' : ''}`}>{statuses[item.status]}</span>{reasons[item.result] && <small>{reasons[item.result]}</small>}</td>
              <td data-label="排入／送出時間">{date.format(new Date(item.sent_at || item.created_at))}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {more && <button className="admin-secondary-btn" disabled={historyLoading} type="button" onClick={() => loadHistory(history.length)}>更多發送紀錄</button>}
    </section>
  );
}
