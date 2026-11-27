import React from 'react';
import useCourseClock from '../../hooks/useCourseClock.js';
import CourseMeetingActions from '../courses/CourseMeetingActions.jsx';
import { COURSE_PARTICIPANT_LABELS, COURSE_PAYMENT_LABELS, COURSE_REGISTRATION_LABELS, formatCoursePrice, formatCourseTime } from '../../domain/courses.js';
import './MyCoursesPanel.css';

export default function MyCoursesPanel({ courses }) {
  const now = useCourseClock();
  return (
    <section className="my-courses">
      <header className="my-courses-header">
        <h2>我的課程</h2>
        <a href="/courses">瀏覽專業課程</a>
      </header>
      {courses.map(course => {
        const ended = Date.parse(course.ends_at) <= now;
        const hasDelegated = course.orders.some(order => order.registrations.some(reg => reg.kind === 'delegated' && reg.status === 'active'));
        return (
          <article className="my-course-card" key={course.id}>
            <h3>{course.name}</h3>
            <p>{formatCourseTime(course)}（台北時間）{ended && ' · 課程已結束'}</p>
            <div className="my-course-actions">
              {!ended && course.zoom_url && <CourseMeetingActions url={course.zoom_url} />}
              <a href={`/courses/${course.id}/register`}>查看報名與付款詳情</a>
            </div>
            {!ended && course.zoom_url && hasDelegated && <p>請將會議連結轉知您幫忙報名的參加者。</p>}
            {course.orders.map(order => (
              <div className="my-course-order" key={order.id}>
                <p><strong>{COURSE_PAYMENT_LABELS[order.status === 'pending' && Date.parse(order.payment_due_at) <= now ? 'expired' : order.status]}</strong> · {formatCoursePrice(order.total_twd)}</p>
                {['pending', 'expired'].includes(order.status) && <p>付款截止：{new Date(order.payment_due_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}（開課前 30 分鐘）。逾期仍保留報名，如需取消請聯繫客服。</p>}
                <ul>
                  {order.registrations.map(reg => (
                    <li key={reg.id}>{reg.name} · {COURSE_PARTICIPANT_LABELS[reg.kind]} · {COURSE_REGISTRATION_LABELS[reg.status]}{reg.benefit_free && '（師資權益免費報名）'}</li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}
