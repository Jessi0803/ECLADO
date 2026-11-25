import FacultySection from '../components/courses/FacultySection.jsx';
import React, { useEffect, useState } from 'react';
import CourseDescription from '../components/courses/CourseDescription.jsx';
import CourseImage from '../components/courses/CourseImage.jsx';
import { formatCourseDuration, formatCoursePrice, formatCourseTime, isCourseRegistrationOpen, courseRegistrationNotice } from '../domain/courses.js';
import { faculty } from '../domain/courseFaculty.js';
import useCourseClock from '../hooks/useCourseClock.js';
import useCourseHistory from '../hooks/useCourseHistory.js';
import useDocumentMeta from '../hooks/useDocumentMeta.js';
import { getPublishedCourses } from '../services/courses.js';
import { coursePath } from '../domain/courseUrls.js';
import './CoursesPage.css';

const courseQuestions = [
  ['誰可以報名專業課程？', '開放具美容師資格的會員報名。登入後，選擇想參加的課程並完成付款即可。'],
  ['怎麼確認報名成功？', '付費課程須完成付款，報名才會成立。登入會員中心，在「我的課程」查看報名狀態。顯示「報名成立」即代表報名成功。'],
  ['報名後如何進入課程？', '報名成立後，登入會員中心，前往「我的課程」並點選「開啟 Zoom 會議」即可加入。也可以從該課程的報名紀錄進入。若由師資代為報名，請向代報師資索取上課連結。Zoom 連結可查看至課程結束。'],
  ['購物金什麼時候會入帳？', '完成付款且報名仍有效，課程結束後會發放購物金給會員。登入會員中心，前往「我的訂單」上方的「購物金」區塊，點選「查看異動明細」即可確認入帳。'],
];

function CourseSchedule({ course }) {
  const duration = formatCourseDuration(course);
  return (
    <p className="course-store-time">
      <span>{formatCourseTime(course)}（台北時間）</span>
      {duration && <span className="course-store-duration">課程時間{duration}</span>}
    </p>
  );
}

function CourseInstructor({ name }) {
  if (!name) return null;
  const profile = faculty.find(([, facultyName]) => facultyName === name);

  return (
    <div className="course-instructor">
      {profile && <img src={`/assets/images/faculty/${profile[0]}.webp`} alt="" width="40" height="40" />}
      <span className="course-instructor-label">授課講師</span>
      <span className="course-instructor-name">{name}</span>
    </div>
  );
}

function follow(event, callback) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  callback();
}

export default function CoursesPage({ courseId = null, canRegister, memberId, onOpenCourse }) {
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState(null);
  const current = result?.id === courseId ? result : null;
  const course = courseId ? current?.courses?.[0] : null;
  const now = useCourseClock();
  const ended = Boolean(course && Date.parse(course.ends_at) <= now);
  const { courses: history, hasRegistrations } = useCourseHistory(!courseId || ended ? memberId : null);
  const hasCourseRecord = history?.some(item => item.id === (course?.id || courseId));
  const registrationOpen = isCourseRegistrationOpen(course, now);
  const registrationNotice = courseRegistrationNotice(course, now);
  const showRegistrationLink = ended ? hasCourseRecord : !registrationNotice && (canRegister || registrationOpen);
  useDocumentMeta({
    title: `${course?.name || (courseId ? '專業課程' : '專業教育')} | ECLADO`,
    description: course?.overview?.trim().slice(0, 160) || '探索 ECLADO 專業課程、上課時間與費用。',
    image: course?.image_path ? `/api/course-share-image?id=${encodeURIComponent(course.id)}` : '/assets/images/hero-cover.jpg',
    canonicalPath: course ? coursePath(course) : courseId ? `/courses/${encodeURIComponent(courseId)}` : '/courses',
    robots: courseId && !course ? 'noindex,follow' : 'index,follow',
  });

  useEffect(() => {
    if (!course?.slug) return;
    const path = coursePath(course);
    if (window.location.pathname !== path) {
      window.history.replaceState(window.history.state, '', path + window.location.search + window.location.hash);
    }
  }, [course?.id, course?.slug]);

  useEffect(() => {
    if (!courseId && window.location.hash === '#education-courses') {
      document.getElementById('education-courses')?.scrollIntoView();
    }
  }, [courseId]);

  useEffect(() => {
    let active = true;
    getPublishedCourses(courseId).then(courses => {
      if (active) setResult({ id: courseId, request, courses });
    }).catch(() => {
      if (active) setResult({ id: courseId, request, failed: true });
    });
    return () => { active = false; };
  }, [courseId, request]);

  useEffect(() => {
    const timer = setInterval(() => setRequest(value => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const listed = courseId ? [] : (current?.courses || []);
  const upcoming = listed.filter(item => isCourseRegistrationOpen(item, now))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const announced = listed.filter(item => Date.parse(item.starts_at) > now && !isCourseRegistrationOpen(item, now))
    .sort((a, b) => Date.parse(a.registration_opens_at) - Date.parse(b.registration_opens_at));
  const inProgress = listed.filter(item => Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now);
  const past = listed.filter(item => Date.parse(item.ends_at) <= now)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));

  return (
    <main className={courseId ? 'course-store course-store--detail' : 'course-store course-store--list'}>
      {courseId && <a className="course-store-back" href="/courses#education-courses">← 返回專業教育</a>}
      {!courseId && (
        <header className="course-store-hero">
          <div className="course-store-hero-inner">
            <div>
              <h1>ECLADO 專業教育</h1>
              <p className="education-hero-subtitle">由 ECLADO 專業師資帶領，從膚況評估、保養規劃到手技實作，建立可應用於美容服務的護理流程。</p>
              <nav className="education-jumps" aria-label="教育專欄導覽">
                <a href="#faculty">認識師資</a>
                <a className="education-jump-button" href="#education-courses">查看課程</a>
              </nav>
            </div>
          </div>
        </header>
      )}
      {courseId && !course && <header className="course-store-heading"><h1>專業課程</h1></header>}
      {!courseId && <FacultySection />}
      <div id={courseId ? undefined : 'education-courses'} className={courseId ? undefined : 'course-store-list-content'}>
        {!courseId && (
          <div className="education-course-heading">
            <div>
              <p className="education-kicker" lang="en">COURSES</p>
              <h2>專業課程</h2>
            </div>
            {hasRegistrations && <a className="course-store-account-link" href="/account?tab=courses">查看我的課程 <span aria-hidden="true">→</span></a>}
          </div>
        )}
        {!current && <p role="status">載入課程中…</p>}
        {current?.failed && <p role="alert">目前無法載入課程。 <button type="button" onClick={() => setRequest(n => n + 1)}>重新載入</button></p>}
        {courseId && current?.courses?.length === 0 && <p>找不到此課程，或課程已下架。</p>}
        {!courseId && current?.courses && upcoming.length === 0 && announced.length === 0 && (
          <p className="course-store-no-upcoming">新課程正在規劃中，敬請期待。</p>
        )}
        {course && (
          <div className="course-store-detail">
            <CourseImage path={course.image_path} alt={course.name} className="course-store-image" />
            <div className="course-detail-copy">
              <p className="course-detail-category">專業課程</p>
              <h1>{course.name}</h1>
              <CourseInstructor name={course.instructor_name} />
              <CourseSchedule course={course} />
              <p className="course-store-price">{formatCoursePrice(course.price_twd)}</p>
              {registrationOpen && course.price_twd > 0 && (
                <p className="course-credit-note">課程結束後將發放購物金</p>
              )}
              <div className="course-detail-description"><h2>課程介紹</h2><CourseDescription value={course.description} /></div>
              {ended && <div className="course-ended-status">課程已結束</div>}
              {registrationNotice && <div className="course-registration-notice"><div className="course-ended-status">尚未開放報名</div><p>{registrationNotice}</p></div>}
              {showRegistrationLink && (
                <a className="course-action-primary" href={`/courses/${course.id}/register`}>
                  {registrationOpen ? '立即報名' : '查看報名紀錄'}
                </a>
              )}
            </div>
          </div>
        )}
        {[
          ['upcoming', '可報名課程', upcoming],
          ['announced', '即將開放報名', announced],
          ['ongoing', '進行中課程', inProgress],
          ['past', '歷年課程', past],
        ].map(([kind, label, items]) => items.length > 0 && (
          <section key={kind} className={`course-store-list-section course-store-list-section--${kind}`} aria-label={label}>
            <h2>{label}</h2>
            <div className="course-store-list-grid">
              {items.map(item => (
                <a key={item.id} className="course-store-card" href={coursePath(item)} onClick={event => follow(event, () => onOpenCourse(item.slug || item.id))}>
                  <CourseImage path={item.image_path} alt="" className="course-store-image" />
                  <div className="course-store-card-content">
                    <CourseSchedule course={item} />
                    {courseRegistrationNotice(item, now) && <p className="course-registration-notice">{courseRegistrationNotice(item, now)}</p>}
                    <h3>{item.name}</h3>
                    <CourseInstructor name={item.instructor_name} />
                    {item.overview && <p className="course-store-card-description">{item.overview}</p>}
                    <p className="course-store-price">{formatCoursePrice(item.price_twd)}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!courseId && (
        <section className="education-faq" aria-labelledby="education-faq-heading">
          <h2 id="education-faq-heading">報名與上課常見問題</h2>
          {courseQuestions.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>
      )}
    </main>
  );
}
