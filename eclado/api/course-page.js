const { injectSeoDocument, escapeHtml } = require('./_seo.js');
const { publicCourse, courseShare, siteOrigin } = require('./_course-share.js');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  try {
    const course = await publicCourse(req.query.id);
    if (!course) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.status(404).send(req.method === 'HEAD' ? '' : '<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>找不到課程 | ECLADO</title></head><body><h1>找不到此課程，或課程尚未上架。</h1><a href="/courses">返回專業教育</a></body></html>');
    }
    if (course.slug && req.query.id !== course.slug) {
      res.setHeader('Location', `/courses/${encodeURIComponent(course.slug)}`);
      return res.status(302).end();
    }
    // Use only the configured site origin, never request host/proxy headers.
    const templateResponse = await fetch(`${siteOrigin()}/`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!templateResponse.ok) throw new Error('Site template unavailable');
    const template = await templateResponse.text();
    const seo = courseShare(course);
    const html = injectSeoDocument(template, seo,
      `<main class="seo-shell"><a href="/courses#education-courses">返回專業教育</a><h1>${escapeHtml(course.name)}</h1><p>${escapeHtml(seo.description)}</p></main>`);
    return res.status(200).send(req.method === 'HEAD' ? '' : html);
  } catch {
    res.setHeader('Retry-After', '60');
    return res.status(503).send(req.method === 'HEAD' ? '' : '課程資料暫時無法載入，請稍後再試。');
  }
};
