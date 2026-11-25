export const COURSE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COURSE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reserved = ['admin', 'api', 'edit', 'login', 'new', 'register'];

export function isCourseSlug(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 100
    && COURSE_SLUG.test(value) && !COURSE_UUID.test(value) && !reserved.includes(value);
}

export function coursePath(course) {
  return `/courses/${encodeURIComponent(course.slug || course.id)}`;
}
