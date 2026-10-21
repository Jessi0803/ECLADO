import React from 'react';
import { isAnnouncementVisible } from '../../services/siteAnnouncement.js';
import './AnnouncementMarquee.css';

export default function AnnouncementMarquee({ announcement, light = false, preview = false }) {
  if (!isAnnouncementVisible(announcement)) return null;
  const text = announcement.content.trim().replace(/\s+/g, ' ');
  return <div role="region" aria-label={preview ? '公告跑馬燈預覽' : '全站公告'} className={`announcement-marquee${light ? ' announcement-marquee--light' : ''}`}>
    <span className="announcement-marquee__accessible">{text}</span>
    <div aria-hidden="true" className="announcement-marquee__track" style={{ '--announcement-duration':`${Math.max(24, text.length * 0.6)}s` }}>
      {[0, 1].map(group => <div key={group} className="announcement-marquee__group">{[0, 1, 2, 3].map(copy => <span key={copy}>{text}</span>)}</div>)}
    </div>
  </div>;
}
