import React, { useEffect, useState } from 'react';
import { getPublishedCourses } from '../../services/courses.js';
import { isCourseRegistrationOpen } from '../../domain/courses.js';
import { coursePath } from '../../domain/courseUrls.js';
import './EducationPreview.css';

const courseDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', dateStyle: 'long',
});

export default function EducationPreview() {
  const [upcoming, setUpcoming] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () => getPublishedCourses().then(courses => {
      if (!active) return;
      const now = Date.now();
      const next = courses
        .filter(course => isCourseRegistrationOpen(course, now))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
      setUpcoming(next ?? null);
    }).catch(() => {
      // The education link remains available if course data cannot load.
    });
    load();
    const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return (
    <section className="home-education" aria-labelledby="home-education-title">
      <div className="home-education-inner px-page">
        <img src="/course-training-hero.webp" alt="講師示範臉部護理手技" width="1920" height="1080" loading="lazy" />
        <div className="home-education-copy">
          <p className="home-education-kicker" lang="en">ECLADO EDUCATION</p>
          <h2 id="home-education-title">專業教育</h2>
          <p className="home-education-intro">認識 ECLADO 各地專業師資，查看近期美容實作課程與報名資訊。</p>
          <a className="home-education-link" href="/courses">查看專業教育 <span aria-hidden="true">→</span></a>
          {upcoming && (
            <div className="home-education-upcoming">
              <h3>近期開課</h3>
              <a href={coursePath(upcoming)}>
                <span>{upcoming.name}</span>
                <time dateTime={upcoming.starts_at}>{courseDate.format(new Date(upcoming.starts_at))}</time>
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
