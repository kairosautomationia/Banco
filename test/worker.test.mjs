// Prueba el Worker real (worker.js + ai.mjs) con un entorno simulado: contraseña, enrutado y rutas de IA.
import base from 'node:test';
import assert from 'node:assert/strict';
import { markdownOf } from '../llamaparse.mjs';
// worker.js usa sintaxis ESM dentro de un paquete CommonJS: Node >= 22.7 lo detecta; en versiones anteriores se omiten estas pruebas.
const worker = await import('../worker.js').then((m) => m.default, () => null);
const test = worker ? base : base.skip;

const basic = (pw) => `Basic ${Buffer.from(`user:${pw}`).toString('base64')}`;
const ASSETS = { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 }) };
const FACTS = { decision_regla: 'aprobar_con_condiciones', score: 640, limites: { monto_max: 400000, tasa_min: 9.6, tasa_max: 12.1 } };
const aiOk = { run: async () => ({ response: '{"observaciones":[],"personalizacion":null}' }) };
const call = (path, env, init = {}) => worker.fetch(new Request(`https://banco.test${path}`, init), env);

test('sin ACCESS_PASSWORD el sitio y la IA son accesibles', async () => {
  const env = { ASSETS, AI: aiOk };
  assert.equal((await call('/', env)).status, 200);
  const r = await call('/api/ai/proteccion', env, { method: 'POST', body: JSON.stringify({ facts: FACTS }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('con ACCESS_PASSWORD, el sitio, el OCR y la IA exigen contraseña', async () => {
  const env = { ASSETS, AI: aiOk, ACCESS_PASSWORD: 's3cret' };
  for (const [path, init] of [['/', {}], ['/app.js', {}], ['/api/extract', { method: 'POST' }], ['/api/ai/decision', { method: 'POST', body: '{}' }]]) {
    const r = await call(path, env, init);
    assert.equal(r.status, 401, `${path} debe pedir contraseña`);
    assert.match(r.headers.get('www-authenticate') || '', /Basic/);
  }
  const bad = await call('/api/ai/proteccion', env, { method: 'POST', body: JSON.stringify({ facts: FACTS }), headers: { authorization: basic('otra') } });
  assert.equal(bad.status, 401);
  const good = await call('/api/ai/proteccion', env, { method: 'POST', body: JSON.stringify({ facts: FACTS }), headers: { authorization: basic('s3cret') } });
  assert.equal(good.status, 200);
  assert.equal((await call('/', env, { headers: { authorization: basic('s3cret') } })).status, 200);
});

test('la IA no se llama sin contraseña (no gasta cuota)', async () => {
  let calls = 0;
  const env = { ASSETS, ACCESS_PASSWORD: 'x', AI: { run: async () => { calls += 1; return { response: '{}' }; } } };
  await call('/api/ai/proteccion', env, { method: 'POST', body: JSON.stringify({ facts: FACTS }) });
  assert.equal(calls, 0);
});

test('rutas y métodos', async () => {
  const env = { ASSETS, AI: aiOk };
  assert.equal((await call('/api/ai/proteccion', env)).status, 405);                          // GET a la IA
  assert.equal((await call('/api/ai/nada', env, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await call('/api/extract', env)).status, 405);
  assert.equal((await call('/api/extract', env, { method: 'POST', headers: { 'x-filename': 'a.csv' } })).status, 500);   // falta LLAMA_CLOUD_API_KEY
  assert.equal((await call('/x', env, { method: 'POST' })).status, 405);
  assert.equal((await (await call('/index.html', env)).text()), 'asset:/index.html');
});

test('si la IA falla, el Worker responde un error JSON claro (no 500 opaco)', async () => {
  const sinBinding = await call('/api/ai/decision', { ASSETS }, { method: 'POST', body: JSON.stringify({ facts: FACTS }) });
  assert.equal(sinBinding.status, 503);
  assert.match((await sinBinding.json()).error, /binding/);
  const rota = { ASSETS, AI: { run: async () => { throw new Error('3040: Out of capacity'); } } };
  const r = await call('/api/ai/decision', rota, { method: 'POST', body: JSON.stringify({ facts: FACTS }) });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /3040/);
});

test('todas las respuestas llevan cabeceras de seguridad (página, IA, OCR, 401 y 404)', async () => {
  const env = { ASSETS, AI: aiOk };
  const protegido = { ...env, ACCESS_PASSWORD: 'x' };
  const respuestas = [
    await call('/', env), await call('/api/ai/proteccion', env, { method: 'POST', body: JSON.stringify({ facts: FACTS }) }),
    await call('/api/extract', env), await call('/api/ai/nada', env, { method: 'POST', body: '{}' }), await call('/', protegido)
  ];
  for (const r of respuestas) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal(respuestas[4].status, 401);
});

test('las cabeceras de seguridad no alteran el contenido ni el estado de los assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('hola', { status: 200, headers: { 'content-type': 'text/html', etag: 'abc' } }) } };
  const r = await call('/', env);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'hola');
  assert.equal(r.headers.get('etag'), 'abc');
  assert.equal(r.headers.get('content-type'), 'text/html');
});

// ---------- Subida de archivos (OCR) con LlamaParse simulado ----------
const MB = 1024 * 1024;
async function conOcrSimulado(fn, { markdown = '| Ventas netas | 12.400.000 |', jobStatus = 'COMPLETED', uploadStatus = 200 } = {}) {
  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  const llamadas = [];
  globalThis.setTimeout = (f) => realTimeout(f, 0);                       // sin esperar los 2 s del sondeo
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    llamadas.push({ url: u, method: init.method || 'GET', body: init.body });
    if (u.endsWith('/upload')) return uploadStatus === 200 ? Response.json({ id: 'job1' }) : new Response('boom', { status: uploadStatus });
    if (u.endsWith('/api/v2/parse/job1')) return Response.json({ job: { id: 'job1', status: jobStatus } });
    if (u.endsWith('/api/v2/parse/job1?expand=markdown')) return Response.json({ job: { id: 'job1', status: jobStatus }, markdown: { pages: [{ page_number: 1, markdown }] } });
    throw new Error(`fetch inesperado: ${u}`);
  };
  try { return await fn(llamadas); } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
}
const subir = (bytes, name = 'estados.pdf', extra = {}) => call('/api/extract', { ASSETS, LLAMA_CLOUD_API_KEY: 'k', ...extra }, { method: 'POST', headers: { 'x-filename': encodeURIComponent(name) }, body: new Uint8Array(bytes) });

test('OCR: un estado financiero de 30 KB, 1 MB y 20 MB exactos se procesa y devuelve el texto', async () => {
  for (const bytes of [30 * 1024, 1 * MB, 20 * MB]) {
    await conOcrSimulado(async (llamadas) => {
      const r = await subir(bytes);
      assert.equal(r.status, 200, `${bytes} bytes`);
      assert.equal(markdownOf(await r.json()), '| Ventas netas | 12.400.000 |');
      const up = llamadas.find((c) => c.url.endsWith('/upload'));
      const file = up.body.get('file');
      assert.equal(file.size, bytes);                                       // el archivo llega completo a LlamaParse
      assert.deepEqual(JSON.parse(up.body.get('configuration')), { tier: 'cost_effective', version: 'latest' });   // Parse API v2
      assert.ok(up.url.endsWith('/api/v2/parse/upload'));
    });
  }
});

test('/api/health: informa qué falta configurar sin revelar secretos, exige GET y respeta la contraseña', async () => {
  const completo = await (await call('/api/health', { ASSETS, AI: aiOk, LLAMA_CLOUD_API_KEY: 'llx-secreta', ACCESS_PASSWORD: 'pw' }, { headers: { authorization: basic('pw') } })).json();
  assert.deepEqual(completo, { ok: true, ocr: { clave_configurada: true, api: 'LlamaParse v2', nivel: 'cost_effective' }, ia: { binding: true, modelo: '@cf/google/gemma-4-26b-a4b-it' }, protegido_con_contrasena: true });
  assert.ok(!JSON.stringify(completo).includes('llx-secreta') && !JSON.stringify(completo).includes('pw"'));
  const vacio = await (await call('/api/health', { ASSETS })).json();
  assert.equal(vacio.ok, false); assert.equal(vacio.ocr.clave_configurada, false); assert.equal(vacio.ia.binding, false);
  assert.equal((await call('/api/health', { ASSETS, LLAMA_PARSE_TIER: 'agentic', AI_MODEL: '@cf/a/b' })).status, 200);
  assert.equal((await call('/api/health', { ASSETS }, { method: 'POST' })).status, 405);
  assert.equal((await call('/api/health', { ASSETS, ACCESS_PASSWORD: 'pw' })).status, 401);
});

test('OCR: LlamaParse v2 (la v1 da 410): flujo upload → estado → expand=markdown, y el nivel se elige con LLAMA_PARSE_TIER', async () => {
  await conOcrSimulado(async (llamadas) => {
    const r = await subir(4096, 'a.pdf', { LLAMA_PARSE_TIER: 'agentic' });
    assert.equal(r.status, 200);
    assert.deepEqual(llamadas.map((c) => `${c.method} ${c.url.replace('https://api.cloud.llamaindex.ai', '')}`),
      ['POST /api/v2/parse/upload', 'GET /api/v2/parse/job1', 'GET /api/v2/parse/job1?expand=markdown']);
    assert.deepEqual(JSON.parse(llamadas[0].body.get('configuration')), { tier: 'agentic', version: 'latest' });
    assert.equal(llamadas[0].body.get('language'), null);                  // campo de la v1: la v2 no lo usa
  });
});

test('OCR: si LlamaParse tarda, el sondeo espera PENDING/RUNNING y avanza al COMPLETED sin pasar de las subpeticiones del plan Free', async () => {
  const realFetch = globalThis.fetch; const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (f) => realTimeout(f, 0);
  let sondeos = 0; let total = 0;
  globalThis.fetch = async (u) => {
    total += 1; u = String(u);
    if (u.endsWith('/upload')) return Response.json({ id: 'j' });
    if (u.endsWith('?expand=markdown')) return Response.json({ markdown: { pages: [{ markdown: 'a' }, { markdown: 'b' }] } });
    sondeos += 1; return Response.json({ job: { id: 'j', status: sondeos < 6 ? (sondeos % 2 ? 'PENDING' : 'RUNNING') : 'COMPLETED' } });
  };
  try {
    const r = await subir(2048);
    assert.equal(r.status, 200); assert.equal(markdownOf(await r.json()), 'a\n\nb');
    assert.equal(sondeos, 6); assert.ok(total < 50);
  } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
});

test('OCR: 20 MB + 1 byte se rechaza con 413 sin llamar a LlamaParse', async () => {
  await conOcrSimulado(async (llamadas) => {
    const r = await subir(20 * MB + 1);
    assert.equal(r.status, 413);
    assert.equal(llamadas.length, 0);
  });
});

test('OCR: formatos admitidos (pdf, docx, xlsx, csv, doc, xls) y rechazo de los demás', async () => {
  for (const name of ['a.pdf', 'a.DOCX', 'a.xlsx', 'a.csv', 'a.doc', 'a.xls']) await conOcrSimulado(async () => assert.equal((await subir(30 * 1024, name)).status, 200, name));
  for (const name of ['a.exe', 'a.txt', 'a', 'a.pdf.exe']) await conOcrSimulado(async () => assert.equal((await subir(100, name)).status, 415, name));
});

test('OCR: nombres con acentos, espacios y rutas se normalizan; un archivo vacío da 400', async () => {
  await conOcrSimulado(async (llamadas) => {
    assert.equal((await subir(2048, 'C:\\Mis docs\\Estados financieros 2024 – Andina.pdf')).status, 200);
    assert.equal(llamadas.find((c) => c.url.endsWith('/upload')).body.get('file').name, 'Estados financieros 2024 – Andina.pdf');
    assert.equal((await subir(0)).status, 400);
  });
});

test('OCR: errores de LlamaParse llegan como mensajes claros (502) y sin clave se explica el motivo', async () => {
  await conOcrSimulado(async () => { const r = await subir(2048); assert.equal(r.status, 502); assert.match((await r.json()).error, /OCR respondió 500/); }, { uploadStatus: 500 });
  await conOcrSimulado(async () => { const r = await subir(2048); assert.equal(r.status, 502); assert.match((await r.json()).error, /FAILED/); }, { jobStatus: 'FAILED' });
  const sinClave = await call('/api/extract', { ASSETS }, { method: 'POST', headers: { 'x-filename': 'a.pdf' }, body: new Uint8Array(10) });
  assert.equal(sinClave.status, 500);
  assert.match((await sinClave.json()).error, /LLAMA_CLOUD_API_KEY/);
});

test('OCR: un texto grande (varios MB de markdown) se devuelve completo', async () => {
  const grande = '| Fila | 1.000 |\n'.repeat(250000);                       // ~5 MB de texto
  await conOcrSimulado(async () => { const r = await subir(60 * 1024); assert.equal(markdownOf(await r.json()).length, grande.length); }, { markdown: grande });
});

test('OCR: el texto se reenvía sin alterarlo (unicode, comillas, saltos) y sin copiar encabezados de LlamaParse', async () => {
  const crudo = JSON.stringify({ job: { id: 'j', status: 'COMPLETED' }, markdown: { pages: [{ page_number: 1, markdown: '| Ventas netas | 12.400.000 |\n| Gastos "financieros" – ñ á é í ó ú € | (160.000) |\n\ttab' }] } });
  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (f) => realTimeout(f, 0);
  globalThis.fetch = async (u) => {
    if (String(u).endsWith('/upload')) return Response.json({ id: 'j' });
    if (String(u).endsWith('/parse/j')) return Response.json({ job: { id: 'j', status: 'COMPLETED' } });
    return new Response(crudo, { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'set-cookie': 'a=b', 'x-interno': '1' } });
  };
  try {
    const r = await call('/api/extract', { ASSETS, LLAMA_CLOUD_API_KEY: 'k' }, { method: 'POST', headers: { 'x-filename': 'a.pdf' }, body: new Uint8Array(500) });
    assert.equal(await r.text(), crudo);                                   // idéntico, byte a byte
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal(r.headers.get('content-encoding'), null);                // el cuerpo ya viene descomprimido
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(r.headers.get('x-interno'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
});

test('presupuesto de CPU (plan Free: 10 ms por solicitud): la IA con un documento de 200 KB no se dispara', async () => {
  const doc = '| Cliente 001 - cartera vigente | 5 | 12.400.000 | 11.200.000 |\n'.repeat(3300);        // ~200 KB
  const env = { ASSETS, AI: { run: async () => ({ response: '{"comportamiento":"Ventas de 12.400.000.","contexto":[]}' }) } };
  const mide = async () => {
    const req = new Request('https://banco.test/api/ai/perfil', { method: 'POST', body: JSON.stringify({ facts: { entradas: { sales24: { valor: '$12.400.000' } } }, markdown: doc }) });
    const c0 = process.cpuUsage(); await (await worker.fetch(req, env)).text(); const c = process.cpuUsage(c0);
    return (c.user + c.system) / 1000;
  };
  await mide();                                                                                       // calentamiento del JIT
  const tiempos = []; for (let i = 0; i < 7; i++) tiempos.push(await mide());
  tiempos.sort((a, b) => a - b);
  assert.ok(tiempos[3] < 20, `mediana ${tiempos[3].toFixed(1)} ms (margen amplio para CI; en Node suele ser ~2 ms)`);
});

test('OCR: un cuerpo sin Content-Length (chunked) se corta al pasar 20 MB, sin leerlo entero', async () => {
  let leidos = 0;
  const flujo = new ReadableStream({ pull(c) { if (leidos >= 200) return c.close(); leidos += 1; c.enqueue(new Uint8Array(MB)); } });
  const r = await call('/api/extract', { ASSETS, LLAMA_CLOUD_API_KEY: 'k' }, { method: 'POST', headers: { 'x-filename': 'a.pdf' }, body: flujo, duplex: 'half' });
  assert.equal(r.status, 413);
  assert.ok(leidos <= 25, `se leyeron ${leidos} MB de 200 (antes: los 200)`);
});

test('OCR: un archivo chunked legítimo (sin Content-Length) llega completo a LlamaParse', async () => {
  await conOcrSimulado(async (llamadas) => {
    let n = 0;
    const flujo = new ReadableStream({ pull(c) { if (n >= 3) return c.close(); n += 1; c.enqueue(new Uint8Array(MB)); } });
    const r = await call('/api/extract', { ASSETS, LLAMA_CLOUD_API_KEY: 'k' }, { method: 'POST', headers: { 'x-filename': 'a.pdf' }, body: flujo, duplex: 'half' });
    assert.equal(r.status, 200);
    assert.equal(llamadas.find((c) => c.url.endsWith('/upload')).body.get('file').size, 3 * MB);
  });
});

test('CSP: solo scripts propios, sin objetos ni <base>, sin incrustación; permite estilos en línea y Google Fonts', async () => {
  const csp = (await call('/', { ASSETS })).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval|\*/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']) assert.ok(csp.includes(d), d);
});
