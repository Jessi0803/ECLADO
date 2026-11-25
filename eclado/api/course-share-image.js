const sharp = require('sharp');
const { publicCourse } = require('./_course-share.js');
const { resolveSupabaseUrl, resolveSupabaseAnonKey } = require('./_supabase-env.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  try {
    const course = await publicCourse(req.query.id);
    const path = course?.image_path;
    if (!path || !/^[0-9a-f-]{36}\.(?:webp|jpe?g|png)$/i.test(path)) return res.status(404).end();
    const response = await fetch(`${resolveSupabaseUrl({ allowVite: true })}/storage/v1/object/course-images/${encodeURIComponent(path)}`, {
      headers: { apikey: resolveSupabaseAnonKey({ allowVite: true }) }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Cover unavailable');
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Cover too large');
    const source = Buffer.from(await response.arrayBuffer());
    if (source.length > 8 * 1024 * 1024) throw new Error('Cover too large');
    // Stable public JPEG URL for crawlers; no signed URL expiry or image cropping.
    const image = await sharp(source, { limitInputPixels: 40000000 }).rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#f4f3f1' }).jpeg({ quality: 88 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', image.length);
    return res.status(200).end(req.method === 'HEAD' ? undefined : image);
  } catch {
    res.setHeader('Retry-After', '60');
    return res.status(503).end();
  }
};
