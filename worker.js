// Cloudflare Worker: sirve el sitio (carpeta public/) y hace de proxy hacia LlamaParse (OCR).
// Equivale a server.js. La clave vive como secreto del Worker (LLAMA_CLOUD_API_KEY); nunca llega al navegador.
// Secretos/variables: LLAMA_CLOUD_API_KEY (para el OCR), LLAMA_PARSE_TIER (opcional: cost_effective | agentic | agentic_plus) y ACCESS_PASSWORD (opcional, protege sitio y OCR).
// La IA (/api/ai/*) vive en ai.mjs y usa el binding "AI" de Workers AI; ver el README para cambiar de proveedor.
import { handleAi } from './ai.mjs';
import { MAX_WAIT_MS, pollDelay } from './ocr.mjs';
import { BASE, configuration, jobIdOf, statusOf, isDone, isFailed } from './llamaparse.mjs';

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function extname(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function authorized(request, env) {
  const password = env.ACCESS_PASSWORD || '';
  if (!password) return true;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }
  const supplied = decoded.split(':').slice(1).join(':');
  return safeEqual(supplied, password);
}

async function llama(env, pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${env.LLAMA_CLOUD_API_KEY}`, accept: 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(`OCR respondió ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, 502);
  }
  return res.json();
}

// Lee el cuerpo con tope. Sin Content-Length (chunked), request.blob() bufferizaría un cuerpo enorme ENTERO antes de rechazarlo
// (probado: 200 MB leídos antes del 413) y el Worker solo tiene 128 MB de memoria.
async function readCapped(request, max) {
  if (!request.body) return new Blob([]);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { reader.cancel().catch(() => {}); throw new HttpError('El archivo supera 20 MB', 413); }
    chunks.push(value);
  }
  return new Blob(chunks);
}

async function extract(request, env) {
  if (!env.LLAMA_CLOUD_API_KEY) return json(500, { error: 'Falta el secreto LLAMA_CLOUD_API_KEY en Cloudflare' });

  let filename = 'documento';
  try {
    filename = decodeURIComponent(request.headers.get('x-filename') || 'documento');
  } catch { /* nombre mal codificado: se usa el genérico */ }
  const ext = extname(filename);
  if (!ALLOWED_EXT.has(ext)) {
    return json(415, { error: `Formato no admitido (${ext || 'sin extensión'}). Usa PDF, Word, Excel o CSV.` });
  }

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new HttpError('El archivo supera 20 MB', 413);
  // blob() en vez de arrayBuffer() + new Blob([...]): una copia menos (4× menos CPU; el plan Free permite 10 ms por solicitud).
  const file = new Blob([declared ? await request.blob() : await readCapped(request, MAX_BYTES)]);
  if (file.size > MAX_BYTES) throw new HttpError('El archivo supera 20 MB', 413);
  if (!file.size) return json(400, { error: 'El archivo está vacío' });

  const baseName = filename.split(/[\\/]/).pop();
  const form = new FormData();
  form.append('file', file, baseName);
  form.append('configuration', configuration(env.LLAMA_PARSE_TIER));
  const jobId = jobIdOf(await llama(env, '/upload', { method: 'POST', body: form }));
  if (!jobId) throw new HttpError('LlamaParse no devolvió el identificador del trabajo', 502);

  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    await sleep(pollDelay(attempt));
    const status = statusOf(await llama(env, `/${jobId}`));
    if (isDone(status)) break;
    if (isFailed(status)) throw new HttpError(`El OCR terminó con estado ${status}`, 502);
    if (Date.now() - started > MAX_WAIT_MS) throw new HttpError('El OCR tardó demasiado; intenta de nuevo', 504);
  }
  // El texto del OCR puede ser de varios MB: se reenvía como flujo, sin parsearlo ni reserializarlo (con JSON.stringify costaba ~16 ms por MB de CPU).
  // Solo se reenvía el tipo de contenido: no los demás encabezados (p. ej. content-encoding), porque el cuerpo ya viene descomprimido.
  const res = await fetch(`${BASE}/${jobId}?expand=markdown`, { headers: { Authorization: `Bearer ${env.LLAMA_CLOUD_API_KEY}`, accept: 'application/json' } });
  if (!res.ok) throw new HttpError(`OCR respondió ${res.status}`, 502);
  return new Response(res.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const handler = {
  async fetch(request, env) {
    try {
      if (!authorized(request, env)) {
        return new Response('Acceso restringido', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Banco 4.0"', 'content-type': 'text/plain; charset=utf-8' }
        });
      }
      const url = new URL(request.url);
      if (url.pathname === '/api/extract') {
        if (request.method !== 'POST') return json(405, { error: 'Método no permitido' }, { allow: 'POST' });
        return await extract(request, env);
      }
      if (url.pathname.startsWith('/api/ai/')) return await handleAi(request, env, url.pathname.slice('/api/ai/'.length));
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Método no permitido' });
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err.message);
      return json(err.status || 500, { error: err.message });
    }
  }
};

// Cabeceras de seguridad en todas las respuestas (página, OCR, IA y errores): sin esto la página podía incrustarse en un iframe ajeno.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Defensa en profundidad contra XSS: solo scripts propios; estilos en línea (el diseño los usa) y Google Fonts; sin objetos ni <base>.
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

export default {
  async fetch(request, env) {
    const res = await handler.fetch(request, env);
    const out = new Response(res.body, res);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
    return out;
  }
};
