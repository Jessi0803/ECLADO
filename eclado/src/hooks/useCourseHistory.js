import { useEffect, useState } from 'react';
import { getMyCourseOrders } from '../services/courses.js';

export default function useCourseHistory(memberId) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const current = result?.memberId === memberId ? result : null;

  useEffect(() => {
    if (!memberId) {
      setResult(null);
      return;
    }

    let active = true;
    getMyCourseOrders(null).then(data => {
      if (!active) return;
      const courses = data.courses.filter(course =>
        course.orders.some(order => order.registrations.length > 0),
      );
      setResult({ memberId, courses });
    }).catch(() => {
      if (active) setResult({ memberId, error: true });
    });
    return () => { active = false; };
  }, [memberId, attempt]);

  function retry() {
    setResult(null);
    setAttempt(value => value + 1);
  }

  return {
    courses: current?.courses,
    hasRegistrations: Boolean(current?.courses?.length),
    error: current?.error,
    retry,
  };
}
