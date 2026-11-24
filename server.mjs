import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4'};

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {'Allow':'GET, HEAD'}); res.end(); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  const filename = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(resolve(root) + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const content = await readFile(filename);
    res.writeHead(200, {'Content-Type':types[extname(filename)] || 'application/octet-stream', 'Content-Length':content.length, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    res.writeHead(['ENOENT','EISDIR','ENOTDIR'].includes(error.code) ? 404 : 500);
    res.end('File unavailable');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Araneae started: http://127.0.0.1:${port}/`));
