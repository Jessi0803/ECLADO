import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const portFlagIndex = args.indexOf('--port');
const port = Number(portFlagIndex >= 0 ? args[portFlagIndex + 1] : process.env.PORT || 4173);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const explicitRoutes = new Map([
  ['/', 'index.html'],
  ['/admin', 'admin.html'],
  ['/contact', 'contact.html'],
  ['/privacy', 'privacy.html'],
]);

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]).replace(/\/$/, '') || '/';
  const routeFile = explicitRoutes.get(cleanPath);
  if (routeFile) return join(root, routeFile);

  const directPath = join(root, normalize(cleanPath).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(directPath) && statSync(directPath).isFile()) return directPath;

  const htmlPath = join(root, `${cleanPath.replace(/^\//, '')}.html`);
  if (existsSync(htmlPath) && statSync(htmlPath).isFile()) return htmlPath;

  return join(root, 'index.html');
}

createServer((req, res) => {
  const filePath = resolvePath(req.url || '/');
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': mime[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`ECLADO test server: http://127.0.0.1:${port}`);
});
