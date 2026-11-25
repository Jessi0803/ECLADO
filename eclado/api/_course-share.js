const { resolveSupabaseUrl, resolveSupabaseAnonKey, resolveSiteUrl } = require('./_supabase-env.js');

const COURSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validSlug = value => typeof value === 'string' && value.length >= 3 && value.length <= 100
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !['admin','api','edit','login','new','register'].includes(value);

function siteOrigin() {
  const url = new URL(resolveSiteUrl());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid public site URL');
  return url.origin;
}

async function publicCourse(id) {
  if (typeof id !== 'string') return null;
  if (!COURSE_ID.test(id)) {
    if (!validSlug(id)) return null;
    const lookup = await fetch(`${resolveSupabaseUrl({ allowVite: true })}/rest/v1/rpc/resolve_course_slug`, {
      method: 'POST', headers: { apikey: resolveSupabaseAnonKey({ allowVite: true }), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: id }), redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!lookup.ok) throw new Error('Course URL lookup unavailable');
    id = await lookup.json();
    if (!id) return null;
    if (typeof id !== 'string' || !COURSE_ID.test(id)) throw new Error('Invalid course URL response');
  }
  const response = await fetch(`${resolveSupabaseUrl({ allowVite: true })}/rest/v1/rpc/get_published_courses`, {
    method: 'POST',
    headers: { apikey: resolveSupabaseAnonKey({ allowVite: true }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id }), redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Public course lookup unavailable');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Invalid public course response');
  // The public RPC enforces publication and its scheduled time, without an admin key.
  return rows.find(course => course.id?.toLowerCase() === id.toLowerCase()) || null;
}

function courseShare(course) {
  const path = `/courses/${course.slug || course.id}`;
  return {
    title: `${course.name} | ECLADO`,
    description: String(course.overview || '').trim().slice(0, 160) || '探索 ECLADO 專業課程、上課時間與費用。',
    path: siteOrigin() + path,
    image: course.image_path ? `${siteOrigin()}/api/course-share-image?id=${encodeURIComponent(course.id)}` : `${siteOrigin()}/assets/images/hero-cover.jpg`,
  };
}

module.exports = { publicCourse, courseShare, siteOrigin };
