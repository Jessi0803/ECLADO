import React, { useEffect, useState } from 'react';
import { downloadCourseImage } from '../../services/courses.js';

export default function CourseImage({ path, alt, className }) {
  const [source, setSource] = useState(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    let url;
    downloadCourseImage(path).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setSource({ path, url });
    }).catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  return source && source.path === path
    ? <img className={className} src={source.url} alt={alt} />
    : <div className={className} aria-hidden="true" />;
}
