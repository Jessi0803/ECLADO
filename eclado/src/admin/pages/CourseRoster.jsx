import React, { useEffect, useRef, useState } from 'react';
import {
  cancelCourseRegistration, getAdminCourseRoster, recordCourseAfterClassCase, recordCourseCaseRefund, resolveCourseManualCase,
} from '../../services/courses.js';
import {
  COURSE_PARTICIPANT_LABELS, COURSE_PAYMENT_LABELS, COURSE_REGISTRATION_LABELS, formatCoursePrice,
} from '../../domain/courses.js';

import { CourseIncome, CourseNotifications } from './CourseOperations.jsx';
import '../../components/account/InstructorRewards.css';

const courseTabs = [
  ['roster', '報名摘要'],
  ['notifications', '通知與發送紀錄'],
];

const caseLabels = {
  cancelled_paid_registration: '取消後待確認退款', payment_exception: '銀行收款待確認', after_course: '課後人工處理', cancelled_unpaid_registration: '未付款報名取消待確認',
};

function CancelRegistrationDialog({ registration, note, setNote, busy, error, onClose, onSubmit }) {
  const dialog = useRef(null);

  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="procurement-modal course-cancel-dialog"
      aria-labelledby="course-cancel-title"
      aria-describedby="course-cancel-description"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={onSubmit}>
        <header className="procurement-modal-header">
          <h2 id="course-cancel-title">取消報名</h2>
        </header>
        <div className="admin-course-editor course-cancel-body">
          <p id="course-cancel-description">
            依客人要求取消 <strong>{registration.name}</strong> 的報名。
            {registration.payment_status === 'paid' && ' 此筆已付款，取消後將建立人工處理案件。'}
            {registration.status === 'pending' && ' 若同單還有其他待付款參加者，其餘報名保留，原訂單付款暫停並交由人工確認。'}
          </p>
          {error && <p className="procurement-error" role="alert">{error}</p>}
          <label>取消原因
            <textarea rows={3} value={note} required maxLength={500} disabled={busy}
              onChange={event => setNote(event.target.value)} />
          </label>
        </div>
        <footer className="procurement-modal-footer course-cancel-footer">
          <button className="admin-secondary-btn" type="button" disabled={busy} onClick={onClose}>保留報名</button>
          <button className="admin-primary-btn" type="submit" disabled={busy || !note.trim()}>
            {busy ? '取消中…' : '確認取消報名'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export default function CourseRoster({ course, destination, canNotify, onClose }) {
  const [data, setData] = useState(null);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState('');
  const [incomeVersion, setIncomeVersion] = useState(0);
  const [tab, setTab] = useState(destination === 'exceptions' ? 'notifications' : 'roster');
  const [notificationsOpened, setNotificationsOpened] = useState(destination === 'exceptions');
  const caseHeading = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    active.current = true;
    getAdminCourseRoster(course.id).then(result => { if (active.current) setData(result); })
      .catch(failure => { if (active.current) setError(failure.message || '無法載入課程名單'); });
    return () => { active.current = false; };
  }, [course.id]);

  const rosterLoaded = data !== null;
  useEffect(() => {
    if (!rosterLoaded || destination !== 'cases' || !caseHeading.current) return;
    caseHeading.current.focus();
  }, [rosterLoaded, destination]);

  function openTab(id) {
    setTab(id);
    if (id === 'notifications') setNotificationsOpened(true);
  }

  function handleTabKey(event) {
    const index = courseTabs.findIndex(([id]) => id === tab);
    const count = courseTabs.length;
    const next = {
      ArrowLeft: (index + count - 1) % count,
      ArrowRight: (index + 1) % count,
      Home: 0,
      End: count - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    openTab(courseTabs[next][0]);
    event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
  }

  function openAction(kind, item) {
    setAction({ kind, item });
    setNote('');
    setRefund('');
    setError('');
    setNotice('');
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !note.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const { kind, item } = action;
      if (kind === 'cancel') await cancelCourseRegistration(item.id, note);
      else if (kind === 'exception') await recordCourseAfterClassCase(item.id, note);
      else if (Number(refund) > 0) {
        await recordCourseCaseRefund(item.id, note, Number(refund));
        if (active.current) setIncomeVersion(version => version + 1);
      } else await resolveCourseManualCase(item.id, note);
      if (!active.current) return;
      setAction(null);
      setNotice(kind === 'cancel' ? '已取消這位參加者的報名。' : '已儲存人工處理紀錄。');
      const updated = await getAdminCourseRoster(course.id);
      if (active.current) setData(updated);
    } catch (failure) {
      if (active.current) setError(failure.message || '操作未完成，請稍後再試。');
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  const ended = Date.parse(course.ends_at) <= Date.now();
  const effectiveCount = data?.registrations.filter(item => ['active','pending'].includes(item.status)).length;
  const unpaidCount = data?.registrations.filter(item => item.status === 'pending' && ['pending','expired','hold'].includes(item.payment_status)).length;
  const visibleRegistrations = data?.registrations.filter(item => paymentFilter === 'all' || (paymentFilter === 'unpaid'
    ? item.status === 'pending' && ['pending','expired','hold'].includes(item.payment_status) : item.payment_status === paymentFilter));

  return (
    <section>
      <header className="procurement-section-heading">
        <div>
          <button className="procurement-back" type="button" disabled={busy} onClick={onClose}>← 返回課程列表</button>
          <h2>{course.name}</h2>
          {data && <p>已報名 {effectiveCount} 人 · 待付款／逾期 {unpaidCount} 人</p>}
        </div>
      </header>
      {notice && <p className="admin-course-feedback" role="status">{notice}</p>}
      {error && action?.kind !== 'cancel' && <p className="procurement-error" role="alert">{error}</p>}
      {!data && !error && <p className="admin-message" role="status">載入名單中…</p>}
      {data && <>
        <div className="reward-management-tabs" role="tablist" aria-label="課程管理功能" onKeyDown={handleTabKey}>
          {courseTabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`course-tab-${id}`} aria-selected={tab === id}
              aria-controls={`course-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => openTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="course-panel-notifications" aria-labelledby="course-tab-notifications" hidden={tab !== 'notifications'} tabIndex={0}>
          {notificationsOpened && <CourseNotifications course={course} registrations={data.registrations} canSend={canNotify} initialOnlyExceptions={destination === 'exceptions'} />}
        </div>
        <div role="tabpanel" id="course-panel-roster" aria-labelledby="course-tab-roster" hidden={tab !== 'roster'} tabIndex={0}>
          <CourseIncome key={incomeVersion} courseId={course.id} />
          <div className="admin-course-editor admin-course-roster-filters">
            <label>付款狀態篩選
              <select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)}>
                <option value="all">全部報名</option><option value="unpaid">待付款／逾期（待聯繫）</option>
                <option value="expired">付款已逾期</option><option value="paid">已付款</option>
                <option value="free">免費報名</option><option value="review">收款待人工確認</option>
              </select>
            </label>
          </div>
          {visibleRegistrations.length > 0 ? <div className="table-scroll procurement-list-wrap admin-course-table">
            <table className="responsive-admin-table procurement-items-table">
              <thead><tr>{['參加者', '報名方式', '報名者', '訂單', '付款狀態', '報名狀態', '操作'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>
                {visibleRegistrations.map(item => (
                  <tr key={item.id}>
                    <td data-label="參加者"><strong>{item.name}</strong></td><td data-label="報名方式">{COURSE_PARTICIPANT_LABELS[item.kind]}</td><td data-label="報名者">{item.payer_name}</td>
                    <td data-label="訂單"><span title={item.order_id}>{item.order_id.slice(0, 8)}</span><br />{formatCoursePrice(item.order_total_twd)}</td>
                    <td data-label="付款狀態"><span className={`procurement-status${item.payment_status === 'paid' ? ' status-received' : ''}`}>{COURSE_PAYMENT_LABELS[item.payment_status]}</span></td>
                    <td data-label="報名狀態"><span className={`procurement-status ${item.status === 'active' ? 'status-received' : item.status === 'cancelled' ? 'status-cancelled' : 'status-pending'}`}>{COURSE_REGISTRATION_LABELS[item.status]}</span>{item.cancel_reason && <small>{item.cancel_reason}</small>}</td>
                    <td data-label="操作">
                      {(item.status === 'pending' || (!ended && item.status === 'active')) && (
                        <button className="admin-secondary-btn" type="button" disabled={busy}
                          onClick={() => openAction('cancel', item)}>取消報名</button>
                      )}
                      {ended && item.status !== 'pending' && !data.cases.some(record => record.registration_id === item.id) && (
                        <button className="admin-secondary-btn" type="button" disabled={busy}
                          onClick={() => openAction('exception', item)}>登記 {item.name} 的課後例外</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div> : <p className="admin-message">目前沒有符合條件的報名紀錄。</p>}

          {action?.kind === 'cancel' && (
            <CancelRegistrationDialog registration={action.item} note={note} setNote={setNote}
              busy={busy} error={error} onSubmit={submit} onClose={() => { setAction(null); setError(''); }} />
          )}

          {action && action.kind !== 'cancel' && (
            <form className="procurement-form-card admin-course-editor" onSubmit={submit}>
              <h3>{action.kind === 'exception' ? `登記 ${action.item.name} 的課後例外` : '記錄人工處理結果'}</h3>
              <fieldset disabled={busy}>
                <label>{action.kind === 'resolve' ? '處理結果' : '原因'}
                  <textarea rows={3} value={note} required maxLength={500} onChange={event => setNote(event.target.value)} />
                </label>
                {action.kind === 'resolve' && <label>已完成的人工退款金額（NT$）
                  <input type="number" min="0" step="1" placeholder="0" value={refund} onChange={event => setRefund(event.target.value)} />
                </label>}
                <div className="admin-course-actions">
                  <button className="admin-primary-btn" type="submit" disabled={!note.trim()}>儲存處理紀錄</button>
                  <button className="admin-secondary-btn" type="button" onClick={() => setAction(null)}>返回</button>
                </div>
              </fieldset>
            </form>
          )}

          <section className="procurement-section-card admin-course-case-panel">
          <h3 ref={caseHeading} tabIndex={-1}>人工處理案件</h3>
          {!data.cases.length ? <p className="admin-message">目前沒有案件。</p> : <ul className="admin-course-cases">
            {[...data.cases].sort((a, b) => Number(Boolean(a.resolved_at)) - Number(Boolean(b.resolved_at))).map(item => (
              <li key={item.id}>
                <strong>{caseLabels[item.kind]}</strong> · 訂單 {item.order_id}
                {item.registration_id && <p>參加者 {data.registrations.find(reg => reg.id === item.registration_id)?.name}</p>}
                <p>{item.reason}</p>
                {item.resolved_at ? <p>已結案 · {item.resolution}{item.refund_twd > 0 && ` · 已退款 ${formatCoursePrice(item.refund_twd)}`}</p> :
                  <button className="admin-secondary-btn" type="button" disabled={busy} onClick={() => openAction('resolve', item)}>記錄處理結果</button>}
              </li>
            ))}
          </ul>}
          </section>
        </div>
      </>}
    </section>
  );
}
