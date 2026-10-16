// Servidor local para testar o GameNight com a API de grupos (dados em memória).
// Uso: npm run dev   ->  http://localhost:8080  (e pelo IP da rede no celular)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as api from './api/group.js';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/group') {
      const handler = api[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await handler(new Request(url, { method: req.method, headers: req.headers, body }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.code === 'ENOENT' ? 'not found' : e));
  }
}).listen(PORT, '0.0.0.0', () => console.log(`GameNight em http://localhost:${PORT}`));
