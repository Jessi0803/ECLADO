import React, { useEffect, useState } from 'react';
import { fetchLatestProApplication } from '../../services/membership.js';

export default function CourseEligibilityNotice({ role, userId }) {
  const [status, setStatus] = useState('checking');
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (role !== 'consumer') return;
    let active = true;
    setStatus('checking');
    fetchLatestProApplication(userId, { throwOnError: true })
      .then(application => {
        if (active) setStatus(application?.status === 'pending' ? 'pending' : 'eligible-to-apply');
      })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [role, userId, request]);

  const pending = role === 'pending' || (role === 'consumer' && status === 'pending');
  return (
    <section className="course-eligibility-notice" aria-label="報名資格說明">
      <p>本課程開放美容師及師資會員報名。</p>
      {pending ? (
        <>
          <p>您的美容師資格申請正在審核中，審核通過後即可報名課程。</p>
          <a href="/account">查看申請狀態 →</a>
        </>
      ) : role === 'consumer' ? (
        status === 'checking' ? <p role="status">確認申請狀態中…</p>
          : status === 'error' ? (
            <>
              <p role="alert">暫時無法確認申請狀態，請稍後再試。</p>
              <button type="button" onClick={() => setRequest(value => value + 1)}>重新確認</button>
            </>
          ) : (
            <>
              <p>您目前為一般會員。如具美容師資格，可提出申請，審核通過後即可報名課程。</p>
              <a href="/professional-apply">申請美容師資格 →</a>
            </>
          )
      ) : <p>{role === 'distributor' ? '您目前為經銷商會員，此身分不適用課程報名。' : '您目前的會員身分不適用課程報名。'}</p>}
    </section>
  );
}
