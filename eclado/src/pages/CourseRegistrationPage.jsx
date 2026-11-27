import React, { useEffect, useRef, useState } from 'react';
import { getPublishedCourses, getMyCourseOrders, createCourseRegistration, getMyCourseStudents } from '../services/courses.js';
import { coursePayment } from '../services/coursePaymentApi.js';
import { isCourseRegistrationOpen, courseRegistrationNotice, formatCoursePrice, getCoursePaymentDeadline, COURSE_PAYMENT_LABELS, COURSE_REGISTRATION_LABELS } from '../domain/courses.js';
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
  const operationVersion = useRef(0);
  const lastRequest = useRef(null);
  const mounted = useRef(false);
  const instructor = role === 'instructor';
  const now = useCourseClock();

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let version = 0;
    async function load(initial = false) {
      const request = ++version;
      const mutation = operationVersion.current;
      try {
        const [publicCourses, data] = await Promise.all([getPublishedCourses(courseId), getMyCourseOrders(courseId)]);
        if (active && request === version && mutation === operationVersion.current) { setCourse(publicCourses[0] || null); setAccount(data); }
      } catch {
        if (active && initial) setError('無法載入課程報名，請重新整理頁面。');
      }
    }
    const refresh = () => { if (document.visibilityState === 'visible' && !operation.current) load(); };
    load(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false; mounted.current = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [courseId]);

  useEffect(() => {
    if (!instructor) return;
    let active = true;
    let version = 0;
    async function load() {
      const request = ++version;
      const mutation = operationVersion.current;
      try {
        const data = await getMyCourseStudents(courseId);
        if (active && request === version && mutation === operationVersion.current) {
          setStudents(data.filter(student => student.student_name?.trim()));
          setStudentError(false);
        }
      } catch { if (active && request === version && mutation === operationVersion.current) setStudentError(true); }
    }
    const refresh = () => { if (document.visibilityState === 'visible' && !operation.current) load(); };
    load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [instructor, courseId]);

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
    operationVersion.current += 1;
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
  const delegatedRegistration = account?.delegated_registration;
  const hasDelegatedRegistration = ['active', 'pending'].includes(delegatedRegistration?.status);
  const invalidStudent = rows.some(row => row.mode === 'binding' && (studentError || students.some(student => student.binding_id === row.binding && student.registration_status)));
  const hasSelf = hasDelegatedRegistration || orders.some(order => order.registrations.some(reg =>
    reg.kind !== 'delegated' && ['active', 'pending'].includes(reg.status)));
  const hasExpired = orders.some(order => order.status === 'expired' && order.registrations.every(reg => reg.status === 'cancelled'));
  const ended = Date.parse(account?.ends_at || course?.ends_at) <= Date.now();
  const mayRegister = course && isCourseRegistrationOpen(course, now)
    && (instructor || (role === 'pro' && !hasSelf));
  const total = (instructor ? rows.filter(row => !(row.mode === 'binding' && row.binding && row.benefitFree)).length : 1) * (course?.price_twd || 0);
  const paymentCutoffPassed = course && getCoursePaymentDeadline(course) <= now;
  const selectedMethod = paymentChoice === 'atm' && total > 30000 ? 'card' : paymentChoice;

  function submit(event) {
    event.preventDefault();
    if (invalidStudent) { setError('選取的學生已報名，或暫時無法確認報名狀態，請重新選擇後再試。'); return; }
    const payload = {
      p_course_id: courseId,
      p_self: !instructor || (self && !hasSelf),
      p_participants: rows.map(row => row.mode === 'binding'
        ? { binding_id: row.binding, ...(row.benefitFree ? { benefit_free: true } : {}) }
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
      if (instructor) {
        try {
          const updatedStudents = await getMyCourseStudents(courseId);
          if (mounted.current) { setStudents(updatedStudents.filter(student => student.student_name?.trim())); setStudentError(false); }
        } catch { if (mounted.current) setStudentError(true); }
      }
      setNotice(order.status === 'free' ? '您的免費報名已成立。' :
        payload.p_self && instructor ? '您的免費報名已成立。請為其他參加者完成付款。' : '報名已受理，請於開課前 30 分鐘完成付款。');
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
      {hasDelegatedRegistration && <section className="course-eligibility-notice" aria-label="師資代報狀態">
        <p>師資已為您報名</p>
        <p>報名狀態：已報名</p>
      </section>}
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
                {studentError && <p>暫時無法確認您的學生名單與報名狀態，請重新整理後再選取學生。</p>}
                {rows.map((row, index) => (
                  <fieldset className="course-participant" key={row.id}>
                    <legend>參加者 {index + 1}</legend>
                    <label>如何填寫姓名？
                      <select value={row.mode} onChange={e => updateRow(row.id, { mode: e.target.value, benefitFree: false })}>
                        <option value="manual">自行填寫姓名</option>
                        <option value="binding" disabled={studentError || !students.length}>從我的學生名單選擇</option>
                      </select>
                    </label>
                    {row.mode === 'binding' ? (
                      <>
                        <label>學生姓名
                          <select aria-label="學生姓名" required value={row.binding} onChange={e => updateRow(row.id, { binding: e.target.value, benefitFree: false })}>
                            <option value="">請選擇學生</option>
                            {students.map(student => (
                              <option key={student.binding_id} value={student.binding_id}
                                disabled={Boolean(student.registration_status) || rows.some(other => other.id !== row.id && other.mode === 'binding' && other.binding === student.binding_id)}>
                                {student.student_name}{student.registration_status && `（已報名${student.registration_status === 'pending' ? '／待付款' : ''}）`}
                              </option>
                            ))}
                          </select>
                        </label>
                        {row.binding && <>
                          <label className="course-student-benefit">
                            <input type="checkbox" checked={Boolean(row.benefitFree)} onChange={e => updateRow(row.id, { benefitFree: e.target.checked })} />
                            使用師資權益，免費報名
                          </label>
                          {row.benefitFree && <p className="course-credit-note">此學生免費報名，不計入購物金回饋。</p>}
                        </>}
                      </>
                    ) : (
                      <>
                        <p id={`course-name-hint-${row.id}`}>請填寫參加者的真實姓名。</p>
                        <div className="course-name-fields">
                          <label>姓<input aria-describedby={`course-name-hint-${row.id}`} value={row.family} required maxLength={60} onChange={e => updateRow(row.id, { family: e.target.value })} /></label>
                          <label>名<input aria-describedby={`course-name-hint-${row.id}`} value={row.given} required maxLength={60} onChange={e => updateRow(row.id, { given: e.target.value })} /></label>
                        </div>
                      </>
                    )}
                    {row.mode === 'binding' && (studentError || students.some(student => student.binding_id === row.binding && student.registration_status)) && <p role="status">此學生已報名，或暫時無法確認報名狀態。請移除此名額或重新選擇學生。</p>}
                    <button type="button" onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}>移除參加者 {index + 1}</button>
                  </fieldset>
                ))}
                <button type="button" disabled={rows.length >= 30} onClick={() => setRows(previous => [
                  ...previous, { id: crypto.randomUUID(), mode: 'manual', family: '', given: '', binding: '', benefitFree: false },
                ])}>新增參加者</button>
              </>
            ) : <p>美容師本人付費報名</p>}
            {paymentCutoffPassed && total > 0 && <p role="status">付費報名與付款已於開課前 30 分鐘截止，如需協助請聯繫客服。</p>}
            <p className="course-registration-total">應付金額 <strong>{formatCoursePrice(total)}</strong></p>
            {instructor && (
              <p className="course-credit-note">預計回饋 {formatCoursePrice(total)} 購物金。課程結束後，依已付款且報名有效的付費代報名額發給付款會員；師資本人與使用師資權益的免費名額不計入。</p>
            )}
            {total > 0 && <p className="course-credit-note">付款截止：{new Date(getCoursePaymentDeadline(course)).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}（開課前 30 分鐘）。</p>}
            {total > 0 && !paymentCutoffPassed && (
              <div className="course-payment-method">
                <PaymentMethodOptions value={selectedMethod} unavailableMethod={total > 30000 ? 'atm' : undefined} onChange={setPaymentChoice} />
              </div>
            )}
            <button className="course-action-primary" type="submit" disabled={invalidStudent || (total > 0 && paymentCutoffPassed) || (instructor && !rows.length && (!self || hasSelf))}>
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
            {order.status === 'pending' && <p>您已報名，請於開課前 30 分鐘完成付款。付款完成後可取得上課連結。</p>}
            {order.status === 'pending' && <p>付款期限 {new Date(order.payment_due_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}（台北時間）</p>}
            <ul>{order.registrations.map(reg => <li key={reg.id}>{reg.name} · {COURSE_REGISTRATION_LABELS[reg.status]}{reg.benefit_free && '（師資權益免費報名）'}</li>)}</ul>
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
              {order.status === 'expired' && order.registrations.some(reg => reg.status !== 'cancelled') && <p>付款期限已過，報名仍為您保留。付款已於開課前 30 分鐘截止。如仍希望參加課程，請主動聯繫客服；如需取消報名，也請聯繫客服協助。請勿使用原付款連結或虛擬帳號付款。</p>}
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
