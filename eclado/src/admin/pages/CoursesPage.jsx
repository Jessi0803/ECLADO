import React, { useEffect, useRef, useState } from 'react';
import usePanelHistory from '../hooks/usePanelHistory.js';
import useCourseClock from '../../hooks/useCourseClock.js';
import CourseDescriptionEditor from '../components/CourseDescriptionEditor.jsx';
import CourseRoster from './CourseRoster.jsx';
import CourseImage from '../../components/courses/CourseImage.jsx';
import { formatCoursePrice, formatCourseTime, toTaipeiInput } from '../../domain/courses.js';
import { faculty } from '../../domain/courseFaculty.js';
import { coursePath, isCourseSlug } from '../../domain/courseUrls.js';
import { getAdminCourses, saveCourse, uploadCourseImage } from '../../services/courses.js';
import './CoursesPage.css';

const instructorNames = faculty.map(([, name]) => name);

function keepCourseEditorInViewport(panel) {
  const viewport = window.visualViewport;
  const mobile = window.matchMedia('(max-width: 900px)');
  if (!viewport) return;

  let frame;
  function updateViewport() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!mobile.matches) {
        panel.style.removeProperty('--course-viewport-top');
        panel.style.removeProperty('--course-viewport-bottom');
        return;
      }
      panel.style.setProperty('--course-viewport-top', `${viewport.offsetTop}px`);
      panel.style.setProperty('--course-viewport-bottom', `${viewport.offsetTop + viewport.height}px`);

      const field = document.activeElement;
      if (!panel.contains(field) || !field.matches('input:not([type="file"], [type="checkbox"]), textarea, [contenteditable="true"]')) return;

      const panelRect = panel.getBoundingClientRect();
      let fieldRect = field.getBoundingClientRect();
      if (field.isContentEditable) {
        const selection = window.getSelection();
        if (selection?.rangeCount && field.contains(selection.focusNode)) {
          const caret = selection.getRangeAt(0).getBoundingClientRect();
          if (caret.height) fieldRect = caret;
        }
      }
      const top = panelRect.top + 12;
      const bottom = panelRect.bottom - 12;
      if (fieldRect.top < top || fieldRect.height > bottom - top) {
        panel.scrollTop += fieldRect.top - top;
      } else if (fieldRect.bottom > bottom) {
        panel.scrollTop += fieldRect.bottom - bottom;
      }
    });
  }

  viewport.addEventListener('resize', updateViewport);
  viewport.addEventListener('scroll', updateViewport);
  mobile.addEventListener('change', updateViewport);
  panel.addEventListener('focusin', updateViewport);
  updateViewport();
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', updateViewport);
    viewport.removeEventListener('scroll', updateViewport);
    mobile.removeEventListener('change', updateViewport);
    panel.removeEventListener('focusin', updateViewport);
  };
}

function CourseEditor({ course, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({
    name: course?.name || '', description: course?.description || '',
    overview: course?.overview || '',
    slug: course?.slug || '',
    instructorChoice: !course?.instructor_name || instructorNames.includes(course.instructor_name)
      ? course?.instructor_name || '' : 'custom',
    customInstructor: course?.instructor_name || '',
    start: toTaipeiInput(course?.starts_at), end: toTaipeiInput(course?.ends_at),
    publishAt: toTaipeiInput(course?.publish_at), registrationOpensAt: toTaipeiInput(course?.registration_opens_at),
    price: course?.price_twd ?? '', zoom: course?.zoom_url || '', published: course?.published || false,
  }));
  const [imagePath, setImagePath] = useState(course?.image_path ?? null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingDescriptionImage, setUploadingDescriptionImage] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const update = (field, value) => setForm(previous => ({
    ...previous,
    [field]: value,
    ...(field === 'publishAt' && (!previous.registrationOpensAt || previous.registrationOpensAt === previous.publishAt)
      ? { registrationOpensAt: value } : {}),
  }));

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || uploadingDescriptionImage) return;
    setError('');
    if (!form.name.trim() || !form.description.trim()) {
      setError('請填寫課程名稱與課程介紹。');
      return;
    }
    if (form.instructorChoice === 'custom' && !form.customInstructor.trim()) {
      setError('請填寫授課講師姓名。');
      return;
    }
    const slug = form.slug.trim().toLowerCase();
    if (slug && !isCourseSlug(slug)) {
      setError('網址代稱須為 3～100 個小寫英文字母、數字或連字號，不可使用保留字或識別碼格式。');
      return;
    }
    if (Array.from(form.description).length > 12000) {
      setError('課程介紹過長，請縮短內容或減少格式。');
      return;
    }
    if (form.publishAt && form.publishAt >= form.start) {
      setError('上架時間必須早於上課開始時間。');
      return;
    }
    if (form.registrationOpensAt && (form.registrationOpensAt >= form.start
      || (form.publishAt && form.registrationOpensAt < form.publishAt))) {
      setError('開放報名時間須在上架時間之後，且早於上課開始時間。');
      return;
    }
    if (form.end <= form.start) {
      setError('結束時間必須晚於開始時間。');
      return;
    }
    if (form.published && ((!imagePath && !file) || !form.zoom.trim())) {
      setError('上架前請提供課程圖片與 Zoom 會議連結。');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const path = file ? await uploadCourseImage(file) : imagePath;
      if (!active.current) return;
      if (file) {
        setImagePath(path);
        setFile(null);
      }
      const saved = await saveCourse({
        p_id: course?.id || null, p_version: course?.version || null,
        p_name: form.name, p_description: form.description, p_image_path: path,
        p_overview: form.overview,
        p_slug: slug || null,
        p_instructor_name: form.instructorChoice === 'custom' ? form.customInstructor : form.instructorChoice,
        p_starts_at: new Date(`${form.start}+08:00`).toISOString(),
        p_ends_at: new Date(`${form.end}+08:00`).toISOString(),
        p_registration_opens_at: form.registrationOpensAt ? new Date(`${form.registrationOpensAt}+08:00`).toISOString() : null,
        p_publish_at: form.publishAt ? new Date(`${form.publishAt}+08:00`).toISOString() : null,
        p_price_twd: Number(form.price), p_published: form.published, p_zoom_url: form.zoom,
      });
      if (active.current) onSaved(saved);
    } catch (failure) {
      if (active.current) setError(failure.message || '儲存失敗，請稍後再試。');
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="admin-course-editor">
      {error && <p className="procurement-error" role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label>課程名稱<input required maxLength={120} value={form.name} onChange={e => update('name', e.target.value)} /></label>
        <label>課程網址代稱（選填）<input maxLength={100} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="例如：2026-12-16-gold-care" aria-describedby="course-slug-hint" value={form.slug} onChange={e => update('slug', e.target.value)} /></label>
        <p id="course-slug-hint" className="admin-course-image-hint">使用小寫英文字母、數字與連字號，長度 3～100 字。留白使用原識別碼網址；填寫後原識別碼連結會轉向新網址。</p>
        <label>授課講師
          <select value={form.instructorChoice} onChange={e => update('instructorChoice', e.target.value)}>
            <option value="">請選擇講師</option>
            {instructorNames.map(name => <option key={name} value={name}>{name}</option>)}
            <option value="custom">自行輸入</option>
          </select>
        </label>
        {form.instructorChoice === 'custom' && (
          <label>講師姓名<input required maxLength={120} value={form.customInstructor} onChange={e => update('customInstructor', e.target.value)} /></label>
        )}
        <label>課程概述<textarea maxLength={300} rows={3} placeholder="顯示於前台課程小卡" value={form.overview} onChange={e => update('overview', e.target.value)} /></label>
        <CourseDescriptionEditor value={form.description} onChange={value => update('description', value)}
          onUploading={setUploadingDescriptionImage} disabled={busy} />
        <div className="admin-course-time">
          <label>上架時間（台北時間）<input aria-label="上架時間（台北時間）" type="datetime-local" max={form.start || undefined} value={form.publishAt} onChange={e => update('publishAt', e.target.value)} /><small>留空為立即上架。需勾選下方「上架課程」。</small></label>
          <label>開放報名時間（台北時間）<input aria-label="開放報名時間（台北時間）" type="datetime-local" min={form.publishAt || undefined} max={form.start || undefined} value={form.registrationOpensAt} onChange={e => update('registrationOpensAt', e.target.value)} /><small>預設與上架時間相同，可延後開放報名。留空則於上架時開放。</small></label>
        </div>
        <div className="admin-course-time">
          <label>上課開始時間（台北時間）<input required type="datetime-local" min={form.registrationOpensAt || form.publishAt || undefined} value={form.start} onChange={e => update('start', e.target.value)} /></label>
          <label>上課結束時間（台北時間）<input required type="datetime-local" min={form.start || form.publishAt || undefined} value={form.end} onChange={e => update('end', e.target.value)} /></label>
        </div>
        <label>課程費用（NT$）<input required type="number" min="0" max="9999999" step="1" value={form.price} onChange={e => update('price', e.target.value)} /></label>
        <label>Zoom 會議連結<input type="url" maxLength={2048} value={form.zoom} onChange={e => update('zoom', e.target.value)} /></label>
        <label>課程圖片<input type="file" accept="image/*" aria-describedby="course-cover-hint" onChange={e => { if (e.target.files[0]) setFile(e.target.files[0]); e.target.value = ''; }} /></label>
        <p id="course-cover-hint" className="admin-course-image-hint">封面建議尺寸 1080 × 1080 px（1:1 正方形）。其他比例也可上傳，前台會完整等比顯示，留白以米白底呈現。圖片限 20 MB 以下。</p>
        {preview ? <img className="admin-course-image" src={preview} alt="課程圖片預覽" />
          : imagePath && <CourseImage path={imagePath} alt="課程圖片預覽" className="admin-course-image" />}
        {(file || imagePath) && <div><button className="admin-secondary-btn" type="button" onClick={() => { setFile(null); setImagePath(null); }}>移除圖片</button></div>}
        <label className="admin-course-publish"><input type="checkbox" checked={form.published} onChange={e => update('published', e.target.checked)} /> 上架課程</label>
        <div className="admin-course-actions">
          <button className="admin-primary-btn" type="submit" disabled={uploadingDescriptionImage}>{busy ? '儲存中…' : '儲存課程'}</button>
          <button className="admin-secondary-btn" type="button" onClick={onClose}>返回課程列表</button>
        </div>
      </fieldset>
    </form>
  );
}

export default function AdminCoursesPage({ canNotify }) {
  const now = useCourseClock();
  const [courses, setCourses] = useState(null);
  const [editor, setEditor] = useState(null);
  const [roster, setRoster] = useState(null);
  const [request, setRequest] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editorTitle = useRef(null);
  const editorPanel = useRef(null);
  const editorTrigger = useRef(null);
  const closeEditor = usePanelHistory(Boolean(editor), () => setEditor(null));

  useEffect(() => {
    if (editor) editorTitle.current?.focus();
    else if (editorTrigger.current) {
      editorTrigger.current.focus();
      editorTrigger.current = null;
    }
  }, [editor]);

  useEffect(() => {
    if (editor && editorPanel.current) return keepCourseEditorInViewport(editorPanel.current);
  }, [editor]);

  function openEditor(event, course) {
    editorTrigger.current = event.currentTarget;
    setNotice('');
    setEditor({ course });
  }

  useEffect(() => {
    let active = true;
    getAdminCourses().then(data => {
      if (active) setCourses([...data].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)));
    }).catch(failure => {
      if (active) setError(failure.message || '無法載入課程。');
    });
    return () => { active = false; };
  }, [request]);

  function reload() {
    setError('');
    setCourses(null);
    setRequest(n => n + 1);
  }

  async function copyCourseLink(course) {
    if (!course.published || (course.publish_at && Date.parse(course.publish_at) > Date.now())) return;
    const url = new URL(coursePath(course), window.location.origin).href;
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(url);
      setNotice('課程連結已複製。');
    } catch {
      setError(`無法自動複製，課程連結為 ${url}`);
    }
  }

  function saved(course) {
    setNotice(course.published ? '課程已儲存並上架。' : '課程已儲存，目前為下架狀態。');
    setEditor(null);
    reload();
  }

  return (
    <section className="admin-courses detail-grid">
      <div inert={editor ? '' : undefined}>
        <header className="procurement-header">
          <h1>課程管理</h1>
          {!roster && <div className="procurement-header-actions">
            <button className="admin-secondary-btn" type="button" onClick={reload}>重新載入</button>
            <button className="admin-primary-btn" type="button" disabled={!courses} onClick={event => openEditor(event)}>新增課程</button>
          </div>}
        </header>
        {roster ? <CourseRoster key={roster.course.id} course={roster.course} destination={roster.destination} canNotify={canNotify} onClose={() => { setRoster(null); reload(); }} /> : (
          <>
            {notice && <p className="admin-course-feedback" role="status">{notice}</p>}
            {error && <p className="procurement-error" role="alert">{error}</p>}
            {!courses && !error && <p className="procurement-loading" role="status">載入課程中…</p>}
            {courses?.length === 0 && <p className="procurement-empty procurement-list-wrap admin-list-empty-message">目前沒有課程。</p>}
            {courses?.length > 0 && (
              <div className="table-scroll procurement-list-wrap admin-course-table">
                <table className="responsive-admin-table procurement-items-table">
                  <thead><tr><th>課程名稱</th><th>上課時間（台北時間）</th><th>費用</th><th>狀態</th><th>待人工處理</th><th>通知異常</th><th>操作</th></tr></thead>
                  <tbody>
                    {courses.map(course => (
                      <tr key={course.id}>
                        <td data-label="課程名稱"><strong>{course.name}</strong></td><td data-label="上課時間（台北時間）">{formatCourseTime(course)}</td>
                        <td data-label="費用">{formatCoursePrice(course.price_twd)}</td>
                        <td data-label="狀態"><span className={`procurement-status${course.published ? ' status-received' : ''}`}>{course.published ? (Date.parse(course.publish_at) > now ? '排程上架' : Date.parse(course.registration_opens_at) > now ? '尚未開放報名' : '已上架') : '已下架'}</span></td>
                        <td data-label="待人工處理">
                          {course.open_case_count > 0 ? (
                            <button className="admin-course-count-link" type="button"
                              aria-label={`查看 ${course.name} 待人工處理 ${course.open_case_count} 筆`}
                              onClick={() => setRoster({ course, destination: 'cases' })}>
                              {course.open_case_count} 筆 <span aria-hidden="true">›</span>
                            </button>
                          ) : <span className="admin-course-count-empty">{course.open_case_count == null ? '—' : '0 筆'}</span>}
                        </td>
                        <td data-label="通知異常">
                          {course.notification_exception_count > 0 ? (
                            <button className="admin-course-count-link" type="button"
                              aria-label={`查看 ${course.name} 通知異常 ${course.notification_exception_count} 筆`}
                              onClick={() => setRoster({ course, destination: 'exceptions' })}>
                              {course.notification_exception_count} 筆 <span aria-hidden="true">›</span>
                            </button>
                          ) : <span className="admin-course-count-empty">{course.notification_exception_count == null ? '—' : '0 筆'}</span>}
                        </td>
                        <td data-label="操作">
                          <div className="admin-course-row-actions"><button className="admin-secondary-btn" type="button" aria-label={`編輯 ${course.name}`} onClick={event => openEditor(event, course)}>編輯</button>{' '}
                          <button className="admin-secondary-btn" type="button" aria-label={`查看 ${course.name} 報名名單`} onClick={() => setRoster({ course })}>報名名單</button>
                          {course.published && (!course.publish_at || Date.parse(course.publish_at) <= now) && (
                            <button className="admin-secondary-btn" type="button" aria-label={`複製 ${course.name} 的課程連結`} onClick={() => copyCourseLink(course)}>複製課程連結</button>
                          )}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {editor && (
        <>
          <button type="button" className="detail-panel-backdrop" tabIndex={-1} aria-label="關閉課程表單" onClick={closeEditor} />
          <div ref={editorPanel} className="detail-panel detail-panel-wide admin-course-editor-panel" role="dialog" aria-modal="true"
            aria-labelledby="course-editor-title" onKeyDown={event => {
              if (event.key === 'Escape') closeEditor();
            }}>
            <div className="admin-course-editor-heading">
              <div>
                <button type="button" className="detail-panel-mobile-back" onClick={closeEditor}>← 返回</button>
                <h2 id="course-editor-title" ref={editorTitle} tabIndex={-1}>{editor.course ? '編輯課程' : '新增課程'}</h2>
              </div>
              <button type="button" className="hide-mobile admin-course-editor-close" aria-label="關閉課程表單" onClick={closeEditor}>×</button>
            </div>
            <CourseEditor course={editor.course} onSaved={saved} onClose={closeEditor} />
          </div>
        </>
      )}
    </section>
  );
}
