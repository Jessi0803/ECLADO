import React, { useState } from 'react';
import './CourseMeetingActions.css';

export default function CourseMeetingActions({ url }) {
  const [message, setMessage] = useState('');

  async function copyMeetingLink() {
    setMessage('');
    try {
      await navigator.clipboard.writeText(url);
      setMessage('會議連結已複製。');
    } catch {
      setMessage('無法自動複製，請從「開啟 Zoom 會議」手動複製連結。');
    }
  }

  return (
    <div className="course-meeting">
      <div className="course-meeting-actions">
        <a href={url} target="_blank" rel="noreferrer">開啟 Zoom 會議</a>
        <button type="button" onClick={copyMeetingLink}>複製會議連結</button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
