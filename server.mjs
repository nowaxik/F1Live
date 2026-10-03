import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OpenF1Client } from './lib/openf1.mjs';
import { LiveFeed } from './lib/public-live.mjs';

const api = new OpenF1Client();
const live = new LiveFeed();

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const cache = new Map();
let queue = Promise.resolve();
const endpoints = new Set(['sessions', 'drivers', 'position']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'Dozwolone są tylko zapytania GET.' }));
  try {
    const url = new URL(req.url, 'http://localhost');
    const hostname = new URL('http://' + (req.headers.host || '')).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return send(403, '{}');
    if (url.pathname.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site') return send(403, '{}');
    if (url.pathname === '/api/live/status') return send(200, JSON.stringify(live.snapshot()));
    if (url.pathname === '/api/live/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const unsubscribe = live.subscribe(snapshot => {
        if (!res.destroyed && !res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`)) res.destroy();
      });
      res.on('close', unsubscribe);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const endpoint = url.pathname.slice(5);
      if (!endpoints.has(endpoint)) return send(404, '{}');
      for (const [key, value] of url.searchParams) {
        if (!['year', 'session_key'].includes(key) || !/^\d{4,8}$/.test(value)) return send(400, JSON.stringify({ error: 'Niepoprawny parametr.' }));
      }
      if (!url.searchParams.has(endpoint === 'sessions' ? 'year' : 'session_key')) return send(400, '{}');
      const key = endpoint + '?' + url.searchParams.toString();
      const result = await (queue = queue.catch(() => {}).then(async () => {
        const saved = cache.get(key);
        if (saved && Date.now() - saved.time < 3600000) return saved.data;
        const data = JSON.stringify(await api.get(endpoint, Object.fromEntries(url.searchParams)));
        if (cache.size > 50) cache.delete(cache.keys().next().value);
        cache.set(key, { time: Date.now(), data });
        return data;
      }));
      return send(200, result);
    }
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) return send(403, '{}');
    send(200, await readFile(filename), mime[path.extname(filename)] || 'application/octet-stream');
  } catch (error) {
    send(error.code === 'ENOENT' ? 404 : error.status || 502, JSON.stringify({ error: error.name === 'TimeoutError' ? 'OpenF1 nie odpowiada. Spróbuj ponownie.' : error.message || 'Nie udało się pobrać danych.' }));
  }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`F1Live: http://127.0.0.1:${server.address().port}`));
