// Prueba el Worker real (worker.js + ai.mjs) con un entorno simulado: contraseña, enrutado y rutas de IA.
import base from 'node:test';
import assert from 'node:assert/strict';
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
