/**
 * web-server.js — zero-dep static dev server
 * Serves the app over HTTP so the renderer (src/renderer.js) can be loaded
 * and smoke-tested in a plain browser (or the Playwright/Chromium harness)
 * without Electron.  The renderer detects the absence of `window.aris` and
 * falls back to browser-native file I/O (FileReader / Blob / a[download]).
 *
 * Usage:  node scripts/web-server.js [port]
 *         (default port 5000)
 * Then open:  http://localhost:5000/
 */
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

const PORT = +(process.argv[2] || 5000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css'  : 'text/css;  charset=utf-8',
  '.js'   : 'text/javascript; charset=utf-8',
  '.json' : 'application/json; charset=utf-8',
  '.svg'  : 'image/svg+xml',
  '.png'  : 'image/png',
  '.ico'  : 'image/x-icon',
  '.aml'  : 'application/xml',
  '.xml'  : 'application/xml',
  '.ajos' : 'application/json',
};

const server = http.createServer((req, res) => {
  try {
    let urlp = decodeURIComponent(req.url.split('?')[0]);
    if (urlp === '/') urlp = '/index.html';
    const fp = path.normalize(path.join(ROOT, urlp));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = fs.statSync(fp);
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(fs.readFileSync(fp));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log('ARIS Open dev server → http://localhost:' + PORT + '/');
  console.log('  (renderer fallback: window.aris absent → browser file I/O)');
});
