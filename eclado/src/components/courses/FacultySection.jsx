import React, { useEffect, useId, useRef, useState } from 'react';
import './FacultySection.css';
import counties from './taiwanCountyPaths.json';

import { faculty } from '../../domain/courseFaculty.js';

const regions = [
  { id: 'north', name: '北部', cities: ['台北', '新北', '新竹'], counties: ['臺北市', '新北市', '新竹市', '新竹縣'] },
  { id: 'central', name: '中部', cities: ['台中'], counties: ['臺中市'] },
  { id: 'south', name: '南部', cities: ['高雄'], counties: ['高雄市'] },
];

export default function FacultySection() {
  const curlId = useId();
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const cardsRef = useRef(null);
  const mapRef = useRef(null);
  const facultyGridRef = useRef(null);
  const revealedProfiles = useRef(new Set());

  useEffect(() => {
    if (!window.matchMedia('(max-width: 680px) and (hover: none)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        !window.IntersectionObserver) return;

    const revealed = revealedProfiles.current;
    const observer = new IntersectionObserver(entries => {
      let delay = 0;
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        revealed.add(target.dataset.profile);
        target.style.setProperty('--profile-reveal-delay', `${delay}ms`);
        target.classList.add('education-profile-reveal');
        observer.unobserve(target);
        delay += 60;
      }
    }, { threshold: 0.1 });
    for (const card of facultyGridRef.current.children) {
      if (!revealed.has(card.dataset.profile)) observer.observe(card);
    }
    return () => observer.disconnect();
  }, [selected]);

  useEffect(() => {
    const cards = cardsRef.current;
    const map = mapRef.current;
    function alignLabels() {
      const desktop = window.matchMedia('(min-width: 681px)').matches;
      for (const card of cards.children) {
        const pin = map.querySelector('.education-pin--' + card.dataset.region);
        const cardBox = card.getBoundingClientRect();
        const pinBox = pin.getBoundingClientRect();
        const offset = desktop ? cardBox.top + cardBox.height / 2 - pinBox.top - pinBox.height / 2 : 0;
        pin.style.setProperty('--label-offset', offset + 'px');
        pin.style.setProperty('--leader-top', Math.min(0, offset) + 'px');
        pin.style.setProperty('--leader-length', Math.abs(offset) + 'px');
      }
    }
    const observer = new ResizeObserver(alignLabels);
    observer.observe(map);
    observer.observe(cards);
    for (const card of cards.children) observer.observe(card);
    window.addEventListener('resize', alignLabels);
    alignLabels();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', alignLabels);
    };
  }, []);

  const highlighted = hovered || selected;
  const visible = selected ? faculty.filter(item => selected.cities.includes(item[2])) : faculty;

  return (
    <section id="faculty" className="education-faculty" aria-labelledby="faculty-title">
      <header className="education-faculty-intro">
        <p className="education-kicker" lang="en">ECLADO PROFESSIONAL EDUCATION</p>
        <h2 id="faculty-title">地區師資總覽</h2>
        <p className="education-intro">ECLADO 匯聚多元專業師資，結合在地市場與實務經驗，提供更貼近需求的教育支持。</p>
      </header>
      <div className="education-faculty-overview">
          <div ref={cardsRef} className="education-regions" role="group" aria-label="依地區查看師資">
            {regions.map(region => (
              <button key={region.id} type="button" data-region={region.id} aria-pressed={selected === region}
                data-highlight={highlighted === region}
                onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(region); }}
                onPointerLeave={() => setHovered(null)} onClick={() => setSelected(current => current === region ? null : region)}>
                <strong>{region.name}地區</strong><span>{region.cities.join('・')}</span>
                <span>{faculty.filter(item => region.cities.includes(item[2])).length} 位</span>
                <span className="education-region-portraits">
                  {faculty.filter(item => region.cities.includes(item[2])).map(([id, name]) => (
                    <span key={id} className="education-region-portrait">
                      <img src={`/assets/images/faculty/${id}.webp`} alt="" />
                      <span>{name}</span>
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        <div ref={mapRef} className="education-map" aria-label="台灣師資分布">
          {/* County boundaries adapted from jason2506/Taiwan.TopoJSON (MOI data). */}
          <svg className="education-map-island" viewBox="0 0 270 415" aria-hidden="true">
            {counties.map(({ name, path }, index) => (
              <path key={name} d={path} data-county={name}
                data-shade={index % 3} data-highlight={highlighted?.counties.includes(name) || false} />
            ))}
          </svg>
          {regions.map(region => (
            <button key={region.id} type="button" className={`education-pin education-pin--${region.id}`}
              aria-pressed={selected === region} data-highlight={highlighted === region}
              onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(region); }}
              onPointerLeave={() => setHovered(null)}
              onClick={() => setSelected(current => current === region ? null : region)}>
              <span><strong>{region.name}地區</strong><small>{region.cities.join('・')}</small></span>
              <i className="education-pin-elbow" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="education-faculty-list">
        <div className="education-faculty-heading">
          <h3>{selected?.name}專業師資</h3>
          {selected && <button type="button" onClick={() => setSelected(null)}>查看全部師資</button>}
        </div>
        <div ref={facultyGridRef} className="education-faculty-grid">
          {visible.map(([id, name, city, instagram, specialties, highlights]) => (
            <a key={id} data-profile={id} className="education-profile" href={`https://www.instagram.com/${instagram}/`}
              target="_blank" rel="noopener noreferrer" aria-label={`${name} 老師的 Instagram（在新分頁開啟）`}>
              <img src={`/assets/images/faculty/${id}.webp`} alt={`${name} 老師`} loading="lazy" />
              <div className="education-profile-copy">
                <div className="education-profile-header">
                  <h4>{name} <small>老師</small></h4>
                  <p className="education-profile-city">{city}</p>
                </div>
                <div>
                  <h5 className="education-profile-label">專業領域</h5>
                  <ul className="education-specialties" role="list">
                    {specialties.split('｜').map(item => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="education-profile-highlights">
                  <h5 className="education-profile-label">專業重點</h5>
                  <ul>
                    {highlights.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <span className="education-profile-instagram">
                  <span>@{instagram}</span>
                  <span className="education-profile-instagram-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="3" width="18" height="18" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                </span>
              </div>
              <svg className="education-profile-curl" viewBox="0 0 64 64" aria-hidden="true">
                <defs>
                  <linearGradient id={`${curlId}-${id}`} x1="30%" y1="30%" x2="75%" y2="78%">
                    <stop offset="0" stopColor="#fff" />
                    <stop offset=".48" stopColor="#f9f8f6" />
                    <stop offset="1" stopColor="#d5d3ce" />
                  </linearGradient>
                </defs>
                <path d="M0 64 C27 63 60 36 64 0 C60 22 51 24 36 25 C24 26 31 50 0 64Z"
                  fill={`url(#${curlId}-${id})`} />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
