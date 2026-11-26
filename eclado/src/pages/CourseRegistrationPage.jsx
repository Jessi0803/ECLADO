import React, { useEffect, useRef, useState } from 'react';
import { getPublishedCourses, getMyCourseOrders, createCourseRegistration } from '../services/courses.js';
import { fetchMyInstructorStudents } from '../services/instructorStudents.js';
import { coursePayment } from '../services/coursePaymentApi.js';
import { isCourseRegistrationOpen, courseRegistrationNotice, formatCoursePrice, COURSE_PAYMENT_LABELS, COURSE_REGISTRATION_LABELS } from '../domain/courses.js';
import { PAYMENT_METHODS } from '../domain/payments.js';
import useCourseClock from '../hooks/useCourseClock.js';
import useDocumentMeta from '../hooks/useDocumentMeta.js';
import PaymentMethodOptions from '../components/checkout/PaymentMethodOptions.jsx';
import CourseMeetingActions from '../components/courses/CourseMeetingActions.jsx';
import CourseEligibilityNotice from '../components/courses/CourseEligibilityNotice.jsx';
import { COURSE_UUID } from '../domain/courseUrls.js';
import './CoursesPage.css';

export default function CourseRegistrationPage({ courseId, user, authReady }) {
  useDocumentMeta({ title: '課程報名 | ECLADO', robots: 'noindex,nofollow,noarchive' });
  useEffect(() => {
    if (!authReady || user) return;
    const returnPath = `/courses/${courseId}/register`;
    window.location.replace(`/login?next=${encodeURIComponent(returnPath)}`);
  }, [authReady, user, courseId]);
  return (
    <main className="course-store course-store--registration">
      <a className="course-store-back" href={`/courses/${courseId}`}>← 返回課程詳情</a>
      <h1>課程報名</h1>
      {!authReady ? <p role="status">確認會員身分中…</p>
        : !user ? <p role="status">正在前往會員登入…</p>
          : COURSE_UUID.test(courseId)
            ? <MemberRegistration key={`${user.uid}:${courseId}`} courseId={courseId} role={user.role} userId={user.uid} />
            : <SlugRegistration key={`${user.uid}:${courseId}`} courseKey={courseId} user={user} />}
    </main>
  );
}

function SlugRegistration({ courseKey, user }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    getPublishedCourses(courseKey)
      .then(rows => { if (active) setResult({ course: rows[0] }); })
      .catch(() => { if (active) setResult({ error: true }); });
    return () => { active = false; };
  }, [courseKey]);
  if (!result) return <p role="status">載入報名資料中…</p>;
  if (result.error) return <p role="alert">無法載入課程，請重新整理頁面。</p>;
  if (!result.course) return <p>找不到此課程，或課程已下架。</p>;
  return <MemberRegistration courseId={result.course.id} role={user.role} userId={user.uid} />;
}

function MemberRegistration({ courseId, role, userId }) {
  const [course, setCourse] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentError, setStudentError] = useState(false);
  const [self, setSelf] = useState(false);
  const [rows, setRows] = useState([]);
  const [paymentChoice, setPaymentChoice] = useState('card');
  const [paymentChoices, setPaymentChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentOrderId, setPaymentOrderId] = useState(null);
  const paymentOrderRef = useRef(null);
  const registrationFormRef = useRef(null);
  const operation = useRef(false);
  const lastRequest = useRef(null);
  const mounted = useRef(false);
  const instructor = role === 'instructor';
  const now = useCourseClock();

  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.all([getPublishedCourses(courseId), getMyCourseOrders(courseId)])
      .then(([publicCourses, data]) => {
        if (active) { setCourse(publicCourses[0] || null); setAccount(data); }
      }).catch(() => {
        if (active) setError('無法載入課程報名，請重新整理頁面。');
      });
    return () => { active = false; mounted.current = false; };
  }, [courseId]);

  useEffect(() => {
    if (!instructor) return;
    let active = true;
    fetchMyInstructorStudents().then(({ data, error: failure }) => {
      if (failure) throw failure;
      if (active) setStudents(data.filter(student => student.student_name?.trim()));
    }).catch(() => { if (active) setStudentError(true); });
    return () => { active = false; };
  }, [instructor]);

  useEffect(() => {
    const order = paymentOrderRef.current;
    if (!paymentOrderId || !order) return;
    order.focus({ preventScroll: true });
    order.scrollIntoView({ block: 'start' });
  }, [paymentOrderId]);

  function updateRow(id, values) {
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...values } : row));
  }

  async function run(task) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); }
    catch (failure) { if (mounted.current) setError(failure.message || '操作未完成，請稍後再試。'); }
    finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const orders = (account?.orders || []).map(order => ({ ...order,
    atm_account: order.atm_account && Date.parse(order.atm_due_at) > now ? order.atm_account : null,
    status: order.status === 'pending' && Date.parse(order.payment_due_at) <= now ? 'expired' : order.status,
    registrations: order.registrations,
  }));
  const hasSelf = orders.some(order => order.registrations.some(reg =>
    reg.kind !== 'delegated' && ['active', 'pending'].includes(reg.status)));
  const hasExpired = orders.some(order => order.status === 'expired' && order.registrations.every(reg => reg.status === 'cancelled'));
  const ended = Date.parse(account?.ends_at || course?.ends_at) <= Date.now();
  const mayRegister = course && isCourseRegistrationOpen(course, now)
    && (instructor || (role === 'pro' && !hasSelf));
  const total = (instructor ? rows.length : 1) * (course?.price_twd || 0);
  const selectedMethod = paymentChoice === 'atm' && total > 30000 ? 'card' : paymentChoice;

  function submit(event) {
    event.preventDefault();
    const payload = {
      p_course_id: courseId,
      p_self: !instructor || (self && !hasSelf),
      p_participants: rows.map(row => row.mode === 'binding'
        ? { binding_id: row.binding }
        : { family_name: row.family.trim(), given_name: row.given.trim() }),
      p_expected_price: course.price_twd,
    };
    const fingerprint = JSON.stringify(payload);
    if (lastRequest.current?.fingerprint !== fingerprint) {
      lastRequest.current = { fingerprint, id: crypto.randomUUID() };
    }
    run(async () => {
      setPaymentOrderId(null);
      const order = await createCourseRegistration({ ...payload, p_request_id: lastRequest.current.id });
      if (!mounted.current) return;
      // Keep the saved order visible even if a follow-up read is interrupted.
      setAccount(previous => ({ ...previous, orders: [order, ...previous.orders.filter(item => item.id !== order.id)] }));
      setRows([]);
      setSelf(false);
      lastRequest.current = null;
      setNotice(order.status === 'free' ? '您的免費報名已成立。' :
        payload.p_self && instructor ? '您的免費報名已成立。請為其他參加者完成付款。' : '報名已受理，請於開課前完成付款。');
      if (order.status === 'pending') {
        setPaymentChoices(previous => ({ ...previous, [order.id]: selectedMethod }));
        try {
          await startPayment(order, selectedMethod);
        } catch (failure) {
          if (mounted.current) setNotice(message => `${message} ${failure.message || '暫時無法啟動付款，請稍後再試。'}`);
        } finally {
          if (mounted.current) setPaymentOrderId(order.id);
        }
        return;
      }
      const updated = await getMyCourseOrders(courseId);
      if (mounted.current) setAccount(updated);
    });
  }

  async function startPayment(order, method) {
    const { order: verified, paymentLink, paymentMethod, atmAccount, atmDueAt, linkExpiresAt } = await coursePayment('start', order.id, order.payment_method || method);
    if (verified) {
      const updated = await getMyCourseOrders(courseId);
      if (mounted.current) {
        setAccount(updated);
        setNotice(verified.status === 'paid' ? '已確認收到付款，報名已成立。' : '已確認收款，請聯繫客服確認報名狀態。');
        setPaymentOrderId(null);
      }
      return;
    }
    if (!mounted.current) return;
    if (paymentMethod === 'atm') {
      setAccount(previous => ({ ...previous, orders: previous.orders.map(item => item.id === order.id
        ? { ...item, payment_method: paymentMethod, atm_account: atmAccount, atm_due_at: atmDueAt, payment_link_expires_at: linkExpiresAt } : item) }));
      return;
    }
    const target = new URL(paymentLink);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('付款連結格式有誤');
    window.location.assign(target.href);
  }

  function refresh(order) {
    run(async () => {
      const { order: verified } = await coursePayment('status', order.id);
      if (!mounted.current) return;
      setAccount(previous => ({ ...previous, orders: previous.orders.map(item => item.id === verified.id ? verified : item) }));
      const updated = await getMyCourseOrders(courseId);
      if (mounted.current) setAccount(updated);
    });
  }

  function returnToRegistration() {
    setNotice('請重新選擇付款方式並完成報名。');
    registrationFormRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    registrationFormRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="course-registration">
      {error && <p role="alert">{error}</p>}
      {notice && !paymentOrderId && <p role="status">{notice}</p>}
      {course === undefined && !error && <p role="status">載入報名資料中…</p>}
      {course && <h2>{course.name}</h2>}
      {mayRegister && account && (
        <form className="course-registration-form" onSubmit={submit} ref={registrationFormRef} tabIndex={-1}>
          {hasExpired && <p>原報名付款已逾期。課程仍開放報名，您可以在此重新報名。</p>}
          <fieldset disabled={busy}>
            {instructor ? (
              <>
                {hasSelf ? <p>您已有本人的報名紀錄。</p> : (
                  <label className="course-self"><input type="checkbox" checked={self} onChange={e => setSelf(e.target.checked)} /> 我本人也要報名（免費）</label>
                )}
                <h3>幫其他人報名</h3>
                {studentError && <p>暫時無法載入您的學生名單，您仍可自行填寫姓名。</p>}
                {rows.map((row, index) => (
                  <fieldset className="course-participant" key={row.id}>
                    <legend>參加者 {index + 1}</legend>
                    <label>如何填寫姓名？
                      <select value={row.mode} onChange={e => updateRow(row.id, { mode: e.target.value })}>
                        <option value="manual">自行填寫姓名</option>
                        <option value="binding" disabled={!students.length}>從我的學生名單選擇</option>
                      </select>
                    </label>
                    {row.mode === 'binding' ? (
                      <label>學生姓名
                        <select aria-label="學生姓名" required value={row.binding} onChange={e => updateRow(row.id, { binding: e.target.value })}>
                          <option value="">請選擇學生</option>
                          {students.map(student => (
                            <option key={student.binding_id} value={student.binding_id}
                              disabled={rows.some(other => other.id !== row.id && other.mode === 'binding' && other.binding === student.binding_id)}>
                              {student.student_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        <p id={`course-name-hint-${row.id}`}>請填寫參加者的真實姓名。</p>
                        <div className="course-name-fields">
                          <label>姓<input aria-describedby={`course-name-hint-${row.id}`} value={row.family} required maxLength={60} onChange={e => updateRow(row.id, { family: e.target.value })} /></label>
                          <label>名<input aria-describedby={`course-name-hint-${row.id}`} value={row.given} required maxLength={60} onChange={e => updateRow(row.id, { given: e.target.value })} /></label>
                        </div>
                      </>
                    )}
                    <button type="button" onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}>移除參加者 {index + 1}</button>
                  </fieldset>
                ))}
                <button type="button" disabled={rows.length >= 30} onClick={() => setRows(previous => [
                  ...previous, { id: crypto.randomUUID(), mode: 'manual', family: '', given: '', binding: '' },
                ])}>新增參加者</button>
              </>
            ) : <p>美容師本人付費報名</p>}
            <p className="course-registration-total">應付金額 <strong>{formatCoursePrice(total)}</strong></p>
            {instructor && (
              <p className="course-credit-note">預計回饋 {formatCoursePrice(total)} 購物金。課程結束後，依已付款且報名有效的代報人數發給付款會員，師資本人免費報名不計入。</p>
            )}
            {total > 0 && (
              <div className="course-payment-method">
                <PaymentMethodOptions value={selectedMethod} unavailableMethod={total > 30000 ? 'atm' : undefined} onChange={setPaymentChoice} />
              </div>
            )}
            <button className="course-action-primary" type="submit" disabled={instructor && !rows.length && (!self || hasSelf)}>
              {busy ? '處理中…' : total > 0 ? (selectedMethod === 'atm' ? '取得虛擬帳號' : '前往付款') : '確認報名'}
            </button>
          </fieldset>
        </form>
      )}
      {ended && <div className="course-ended-status">課程已結束</div>}
      {course && !ended && !mayRegister && !hasSelf && (
        ['pro', 'instructor'].includes(role)
          ? <p>{courseRegistrationNotice(course, now) || '此課程目前未開放報名。'}</p>
          : <CourseEligibilityNotice key={`${userId}:${role}`} role={role} userId={userId} />
      )}
      {account?.orders.length > 0 && <section className="course-registration-orders" aria-label="我的課程報名">
        <h2>我的課程報名</h2>
        {account.zoom_url && Date.parse(account.ends_at || course?.ends_at) > Date.now() && (
          <>
            <CourseMeetingActions url={account.zoom_url} />
            {instructor && <p>請自行轉知您幫忙報名的參加者。</p>}
          </>
        )}
        {orders.map(order => (
          <article className="course-order" key={order.id}
            ref={order.id === paymentOrderId ? paymentOrderRef : null} tabIndex={-1}
            aria-label={order.id === paymentOrderId ? '接續付款' : undefined}>
            {order.id === paymentOrderId && order.status === 'pending' && <p role="status">{notice}</p>}
            <h3>{order.course_name}</h3>
            <p>{COURSE_PAYMENT_LABELS[order.status]} · {order.status === 'pending' && '應付金額 '}{formatCoursePrice(order.total_twd)}</p>
            {order.status === 'pending' && order.payment_link_expires_at && Date.parse(order.payment_link_expires_at) <= now && <p>原付款連結或帳號已到期，訂單仍保留。點選下方按鈕確認付款狀態並繼續付款。</p>}
            {order.status === 'pending' && <p>您已報名，請於開課前完成付款。付款完成後可取得上課連結。</p>}
            {order.status === 'pending' && <p>付款期限 {new Date(order.payment_due_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}（台北時間）</p>}
            <ul>{order.registrations.map(reg => <li key={reg.id}>{reg.name} · {COURSE_REGISTRATION_LABELS[reg.status]}</li>)}</ul>
            {!ended && order.status === 'pending' && (
              <div className="course-payment-method">
                {order.payment_method ? <p>付款方式：{PAYMENT_METHODS[order.payment_method]?.label}</p> : (
                  <PaymentMethodOptions disabled={busy} value={paymentChoices[order.id] || 'card'} unavailableMethod={order.total_twd > 30000 ? 'atm' : undefined}
                    onChange={method => setPaymentChoices(previous => ({ ...previous, [order.id]: method }))} />
                )}
                {order.atm_account && <div className="course-atm-details" aria-label="匯款資訊">
                  <p>銀行：807 永豐銀行</p>
                  <p>虛擬帳號：<strong>{order.atm_account}</strong></p>
                  <p>匯款金額：{formatCoursePrice(order.total_twd)}</p>
                  <p>匯款期限：{new Date(order.atm_due_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}（台北時間）</p>
                </div>}
              </div>
            )}
            <div className="course-actions">
              {order.status === 'expired' && order.registrations.some(reg => reg.status !== 'cancelled') && <p>付款期限已過，報名仍為您保留。管理員將聯繫確認；如需取消，請聯繫客服。請勿使用原付款連結或虛擬帳號付款。</p>}
              {order.status === 'hold' && <p>此訂單有參加者已取消，其餘報名仍保留。請聯繫客服確認付款金額，請勿使用原付款資料付款。</p>}
              {order.status === 'expired' && order.registrations.every(reg => reg.status === 'cancelled') && mayRegister && <button type="button" className="course-action-primary" disabled={busy} onClick={returnToRegistration}>重新報名</button>}
              {order.status === 'expired' && order.registrations.every(reg => reg.status === 'cancelled') && !mayRegister && course && !isCourseRegistrationOpen(course, now) && <p>課程目前已停止報名，無法重新報名。</p>}
              {!ended && order.status === 'pending' && !order.atm_account && (
                <button className="course-action-primary" type="button" disabled={busy}
                  onClick={() => run(() => startPayment(order, paymentChoices[order.id] || 'card'))}>
                  {(order.payment_method || paymentChoices[order.id]) === 'atm' ? '取得虛擬帳號' :
                    `繼續${PAYMENT_METHODS[order.payment_method || paymentChoices[order.id] || 'card'].label}付款`}
                </button>
              )}
              {['pending', 'expired'].includes(order.status) && <button type="button" disabled={busy} onClick={() => refresh(order)}>查詢付款狀態</button>}
            </div>
          </article>
        ))}
      </section>}
    </div>
  );
}
