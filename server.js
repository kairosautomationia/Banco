// Servidor local sin dependencias: sirve el sitio y hace de proxy hacia LlamaParse (OCR).
// La clave vive en .env o en la variable de entorno LLAMA_CLOUD_API_KEY; nunca llega al navegador.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* sin .env: se usa el entorno */ }

const API_KEY = process.env.LLAMA_CLOUD_API_KEY;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // en un hosting: HOST=0.0.0.0
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || ''; // opcional: protege el sitio y el OCR con contraseña
const BASE = 'https://api.cloud.llamaindex.ai/api/parsing';
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv']);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/extractor.js': ['extractor.js', 'text/javascript; charset=utf-8']
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { reject(Object.assign(new Error('El archivo supera 20 MB'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function llama(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...options, headers: { Authorization: `Bearer ${API_KEY}`, accept: 'application/json', ...(options.headers || {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`OCR respondió ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`), { status: 502 });
  }
  return res.json();
}

async function extract(req, res) {
  if (!API_KEY) return send(res, 500, { error: 'Falta LLAMA_CLOUD_API_KEY en .env' });
  const filename = decodeURIComponent(req.headers['x-filename'] || 'documento');
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return send(res, 415, { error: `Formato no admitido (${ext || 'sin extensión'}). Usa PDF, Word, Excel o CSV.` });
  const buffer = await readBody(req);
  if (!buffer.length) return send(res, 400, { error: 'El archivo está vacío' });

  const form = new FormData();
  form.append('file', new Blob([buffer]), path.basename(filename));
  form.append('language', 'es');
  const job = await llama('/upload', { method: 'POST', body: form });

  const started = Date.now();
  for (;;) {
    await sleep(2000);
    const info = await llama(`/job/${job.id}`);
    const status = String(info.status || '').toUpperCase();
    if (status === 'SUCCESS') break;
    if (status === 'ERROR' || status === 'CANCELED') throw Object.assign(new Error(`El OCR terminó con estado ${status}`), { status: 502 });
    if (Date.now() - started > 150000) throw Object.assign(new Error('El OCR tardó demasiado; intenta de nuevo'), { status: 504 });
  }
  const result = await llama(`/job/${job.id}/result/markdown`);
  send(res, 200, { markdown: result.markdown || '', filename: path.basename(filename) });
}

function authorized(req) {
  if (!ACCESS_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const supplied = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
  return supplied === ACCESS_PASSWORD;
}

http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Banco 4.0"', 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Acceso restringido');
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/extract') return await extract(req, res);
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), type);
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`Banco 4.0 en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  ·  OCR ${API_KEY ? 'configurado' : 'SIN CLAVE'}  ·  ${ACCESS_PASSWORD ? 'con contraseña' : 'sin contraseña'}`);
});
