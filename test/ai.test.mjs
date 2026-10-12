import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAi, parseJson, textOf, validateIntegration, validatePerfil, validateProteccion, validateDecision, validateMemo, unknownFigures, createProvider } from '../ai.mjs';

const DOC = `| Concepto | dic-24 |
| **EBITDA** | 400.000 |
| Utilidad neta | (85.000) |
| Vencidos accionistas | No |`;

const post = (body) => new Request('https://x/api/ai/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const envWith = (run, extra = {}) => ({ AI: { run }, ...extra });
const FACTS = { score: 640, decision_regla: 'aprobar_con_condiciones', monto_sugerido: '$400.000', tasa_referencial: '10.1% anual', limites: { monto_max: 400000, tasa_min: 9.6, tasa_max: 12.1 }, entradas: { ebitda: { etiqueta: 'EBITDA', valor: '$400.000' } } };

test('parseJson tolera cercas de código y bloques <think>', () => {
  assert.deepEqual(parseJson('<think>{"a":0}</think>```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson('sin json'), /JSON/);
  assert.throws(() => parseJson('{roto'), /JSON/);
  assert.throws(() => parseJson('{"a": }'), /inválido/);
});

test('textOf acepta las formas de respuesta de Workers AI', () => {
  assert.equal(textOf({ response: 'a' }), 'a');
  assert.equal(textOf({ choices: [{ message: { content: 'b' } }] }), 'b');
  assert.equal(textOf({ response: { x: 1 } }), '{"x":1}');
  assert.throws(() => textOf({}), /sin texto/);
});

test('integración: acepta valores con evidencia literal y rechaza los inventados', () => {
  const raw = { campos: {
    ebitda: { cifra: '400.000', escala: 1, evidencia: '| EBITDA | 400.000 |' },
    netIncome: { cifra: '(85.000)', escala: 1, evidencia: 'Utilidad neta | (85.000)' },
    cash: { cifra: '28.128', escala: 1, evidencia: 'Efectivo 28.128' },            // evidencia que no está en el documento
    equity: { cifra: '999.999', escala: 1, evidencia: 'EBITDA | 400.000' },        // la cifra no está en su evidencia
    overdue: { valor: 'No', evidencia: 'Vencidos accionistas | No' }
  } };
  const out = validateIntegration(raw, DOC, ['ebitda', 'netIncome', 'cash', 'equity', 'overdue', 'debt']);
  assert.deepEqual(Object.keys(out.campos).sort(), ['ebitda', 'netIncome', 'overdue']);
  assert.deepEqual(out.rechazados.sort(), ['cash', 'equity']);
  assert.equal(out.campos.overdue.valor, 'no');
});

test('integración: ignora campos que no se pidieron y fuerza escala 1 en enteros', () => {
  const raw = { campos: { ebitda: { cifra: '400.000', escala: 1, evidencia: 'EBITDA | 400.000' }, employees: { cifra: '400.000', escala: 1000, evidencia: 'EBITDA | 400.000' } } };
  const out = validateIntegration(raw, DOC, ['employees']);
  assert.deepEqual(Object.keys(out.campos), ['employees']);
  assert.equal(out.campos.employees.escala, 1);
});

test('protección: descarta observaciones con cifras ajenas, severidad inválida o sin texto', () => {
  const raw = { observaciones: [
    { categoria: 'fraude', severidad: 'alta', titulo: 'EBITDA alto', detalle: 'El EBITDA de $400.000 parece alto.', campos: ['ebitda', 'zzz'] },
    { severidad: 'media', titulo: 'Inventada', detalle: 'Ventas de $9.876.543.', campos: [] },
    { severidad: 'urgente', titulo: 'x', detalle: 'y', campos: [] },
    { severidad: 'baja', titulo: '', detalle: 'sin título', campos: [] }
  ] };
  const out = validateProteccion(raw, FACTS);
  assert.equal(out.observaciones.length, 1);
  assert.deepEqual(out.observaciones[0].campos, ['ebitda']);
  assert.equal(out.observaciones[0].categoria, 'fraude');
  assert.equal(validateProteccion({ observaciones: [{ categoria: 'rara', severidad: 'baja', titulo: 'a', detalle: 'b' }] }, FACTS).observaciones[0].categoria, 'consistencia');
});

test('protección: la personalización nunca supera los topes de las reglas', () => {
  const ok = validateProteccion({ personalizacion: { monto: 380000, tasa: 10.5, justificacion: 'Se reduce a $380.000 por liquidez baja.', condiciones: ['Garantía real'] } }, FACTS);
  assert.deepEqual([ok.personalizacion.monto, ok.personalizacion.tasa], [380000, 10.5]);
  const alto = validateProteccion({ personalizacion: { monto: 450000, tasa: 10.5, justificacion: 'Ajuste por perfil.' } }, FACTS);
  assert.equal(alto.personalizacion.monto, null);                 // por encima del tope: se ignora
  assert.deepEqual(alto.personalizacion.fuera_de_tope, ['monto']);
  assert.equal(validateProteccion({ personalizacion: { monto: 450000, tasa: 20, justificacion: 'x' } }, FACTS).personalizacion, null);
  assert.equal(validateProteccion({ personalizacion: { monto: 100000 } }, FACTS).personalizacion, null);   // sin justificación
  assert.equal(validateProteccion({ personalizacion: { monto: 100000, justificacion: 'Cifra 777.777 inventada.' } }, FACTS).personalizacion, null);
  assert.equal(validateProteccion({ personalizacion: null }, FACTS).personalizacion, null);
});

test('decisión: la recomendación nunca es más permisiva que las reglas', () => {
  const memo = { resumen: 'Score 640.', fortalezas: [], riesgos: [], condiciones: [] };
  const mismo = validateDecision({ recomendacion: 'aprobar_con_condiciones', confianza: 'alta', motivos: ['Score 640'], ...memo }, FACTS);
  assert.equal(mismo.relacion, 'coincide');
  const permisiva = validateDecision({ recomendacion: 'aprobar', ...memo }, FACTS);
  assert.deepEqual([permisiva.recomendacion, permisiva.recomendacion_modelo, permisiva.relacion], ['aprobar_con_condiciones', 'aprobar', 'ajustada']);
  const estricta = validateDecision({ recomendacion: 'rechazar', confianza: 'rara', ...memo }, FACTS);
  assert.deepEqual([estricta.recomendacion, estricta.relacion, estricta.confianza], ['rechazar', 'mas_estricta', 'media']);
  assert.throws(() => validateDecision({ recomendacion: 'comprar', ...memo }, FACTS), /válida/);
  assert.throws(() => validateDecision({ recomendacion: 'aprobar', ...memo }, { ...FACTS, decision_regla: 'x' }), /decision_regla/);
  assert.throws(() => validateDecision({ recomendacion: 'rechazar', motivos: ['Pérdida de 987.654'], ...memo }, FACTS), /cifras/);
});

test('perfil: el contexto exige cita literal del documento y cifras presentes en ella', () => {
  const raw = { comportamiento: 'EBITDA de $400.000 estable.', contexto: [
    { dato: 'Garantía hipotecaria', evidencia: 'Garantía hipotecaria sobre planta' },
    { dato: 'Litigio por 50.000', evidencia: 'Garantía hipotecaria sobre planta' },        // cifra que la evidencia no tiene
    { dato: 'Cliente único', evidencia: 'Un solo cliente concentra el 90%' }                // no está en el documento
  ] };
  const md = '| Nota 4 | Garantía hipotecaria sobre planta industrial |';
  const out = validatePerfil(raw, FACTS, md);
  assert.deepEqual(out.perfil.contexto.map((c) => c.dato), ['Garantía hipotecaria']);
  assert.deepEqual(validatePerfil(raw, FACTS, '').perfil.contexto, []);                    // sin documento no hay contexto
  assert.throws(() => validatePerfil({ comportamiento: 'Ventas de 9.999.999.', contexto: [] }, FACTS, ''), /cifras/);
});

test('memo: pasa con cifras del expediente y se rechaza con cifras nuevas', () => {
  const ok = validateMemo({ resumen: 'Score 640 en 2026, monto $400.000 a 10.1% anual.', fortalezas: ['a'], riesgos: [], condiciones: [] }, FACTS);
  assert.equal(ok.fortalezas.length, 1);
  assert.throws(() => validateMemo({ resumen: 'Se sugiere $750.000.', fortalezas: [], riesgos: [], condiciones: [] }, FACTS), /cifras/);
  assert.throws(() => validateMemo({ resumen: '' }, FACTS), /vacío/);
  assert.deepEqual(unknownFigures('1,2 millones y 35 %', 'nada'), []);
  assert.deepEqual(unknownFigures('Ventas que terminan en 000, el 100% de los periodos', 'nada'), []);   // no son datos
  assert.deepEqual(unknownFigures('Ventas de 123.456', 'nada'), ['123456']);
});

test('handleAi decisión: devuelve recomendación, memo y modelo por defecto', async () => {
  let seen;
  const env = envWith(async (model, input) => { seen = { model, input }; return { response: '{"recomendacion":"aprobar","confianza":"alta","motivos":[],"resumen":"Score 640.","fortalezas":[],"riesgos":[],"condiciones":[]}' }; });
  const res = await handleAi(post({ facts: FACTS }), env, 'decision');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(data.memo.resumen, 'Score 640.');
  assert.equal(data.recomendacion, 'aprobar_con_condiciones');     // la IA pidió "aprobar": se sube al piso de las reglas
  assert.equal(data.relacion, 'ajustada');
  assert.deepEqual(seen.input.chat_template_kwargs, { enable_thinking: false });   // sin razonamiento: rápido
  assert.equal('reasoning_effort' in seen.input, false);
});

test('handleAi perfil: integra comportamiento y contexto verificado', async () => {
  const env = envWith(async () => ({ response: '{"comportamiento":"EBITDA de $400.000.","contexto":[{"dato":"Garantía hipotecaria","evidencia":"Garantía hipotecaria sobre planta"}]}' }));
  const md = 'Nota: Garantía hipotecaria sobre planta industrial';
  const data = await (await handleAi(post({ facts: FACTS, markdown: md }), env, 'perfil')).json();
  assert.equal(data.perfil.contexto.length, 1);
});

test('handleAi: reintenta sin chat_template_kwargs si el modelo lo rechaza', async () => {
  const calls = [];
  const env = envWith(async (_m, input) => { calls.push(input); if (input.chat_template_kwargs) throw new Error('bad param'); return { response: '{"observaciones":[],"personalizacion":null}' }; });
  const res = await handleAi(post({ facts: FACTS }), env, 'proteccion');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test('handleAi: el modelo se cambia por variable de entorno y por fase', async () => {
  let model;
  const env = envWith(async (m) => { model = m; return { response: '{"observaciones":[]}' }; }, { AI_MODEL: '@cf/a/b', AI_MODEL_PROTECCION: '@cf/c/d' });
  await handleAi(post({ facts: FACTS }), env, 'proteccion');
  assert.equal(model, '@cf/c/d');
});

test('handleAi: errores claros', async () => {
  const ok = envWith(async () => ({ response: '{}' }));
  assert.equal((await handleAi(new Request('https://x', { method: 'GET' }), ok, 'decision')).status, 405);
  assert.equal((await handleAi(post({}), ok, 'otra')).status, 404);
  assert.equal((await handleAi(post('no json'), ok, 'decision')).status, 400);
  assert.equal((await handleAi(post({}), ok, 'decision')).status, 400);                       // sin facts
  assert.equal((await handleAi(post({ facts: FACTS }), {}, 'decision')).status, 503);         // sin binding AI
  assert.equal((await handleAi(post({ facts: FACTS }), envWith(async () => ({ response: 'texto libre' })), 'decision')).status, 502);
  assert.equal((await handleAi(post({ markdown: DOC, missing: ['nope'] }), ok, 'integracion')).status, 400);
  assert.equal((await handleAi(post({}), ok, '__proto__')).status, 404);
});

test('handleAi integración extremo a extremo con evidencia verificada', async () => {
  const env = envWith(async () => ({ response: '```json\n{"campos":{"ebitda":{"cifra":"400.000","escala":1,"evidencia":"EBITDA | 400.000"},"cash":{"cifra":"1","escala":1,"evidencia":"inventado"}}}\n```' }));
  const data = await (await handleAi(post({ markdown: DOC, missing: ['ebitda', 'cash'] }), env, 'integracion')).json();
  assert.deepEqual(Object.keys(data.campos), ['ebitda']);
  assert.deepEqual(data.rechazados, ['cash']);
});

test('proveedor openai-compatible: se puede cambiar y valida su configuración', async () => {
  assert.throws(() => createProvider({ AI_PROVIDER: 'openai' }), /faltan/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'otro' }), /desconocido/);
  const realFetch = globalThis.fetch;
  let url, body;
  globalThis.fetch = async (u, init) => { url = u; body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: '{"observaciones":[]}' } }] })); };
  try {
    const env = { AI_PROVIDER: 'openai', AI_BASE_URL: 'https://api.example.com/v1/', AI_API_KEY: 'k', AI_MODEL: 'modelo-x' };
    const data = await (await handleAi(post({ facts: FACTS }), env, 'proteccion')).json();
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(body.model, 'modelo-x');
    assert.equal(data.provider, 'openai-compatible');
  } finally { globalThis.fetch = realFetch; }
});

test('reintento estricto: si el modelo agota los tokens pensando (content=null), el segundo intento sin razonamiento lo recupera', async () => {
  const seen = [];
  const env = envWith(async (_m, input) => {
    seen.push(input);
    if (seen.length === 1) return { choices: [{ message: { content: null, reasoning_content: 'pensando…' }, finish_reason: 'length' }] };
    return { response: '{"observaciones":[],"personalizacion":null}' };
  });
  const res = await handleAi(post({ facts: FACTS }), env, 'proteccion');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.retried, true);
  assert.equal(seen.length, 2);
  assert.match(seen[1].messages[1].content, /IMPORTANTE: responde ÚNICAMENTE/);   // recordatorio de «solo JSON»
  assert.equal(seen[1].reasoning_effort, 'none');                                 // sin razonamiento
  assert.equal('temperature' in seen[1], false);                                  // parámetros mínimos
});

test('reintento estricto: texto libre y JSON truncado también se reintentan; si el segundo falla, error claro tras 2 llamadas', async () => {
  for (const bad of ['Claro, aquí está mi análisis.', '{"observaciones":[{"titulo":"x","detalle":"']) {
    let calls = 0;
    const res = await handleAi(post({ facts: FACTS }), envWith(async () => { calls += 1; return { response: bad }; }), 'proteccion');
    assert.equal(res.status, 502);
    assert.equal(calls, 2);
  }
});

test('reintento estricto: un memo con cifras ajenas se reintenta; los errores de petición (400) y de plan NO', async () => {
  let n = 0;
  const memo = (s) => `{"recomendacion":"aprobar_con_condiciones","confianza":"alta","motivos":[],"resumen":"${s}","fortalezas":[],"riesgos":[],"condiciones":[]}`;
  const env = envWith(async () => ({ response: memo(++n === 1 ? 'Monto de $987.654.' : 'Score 640.') }));
  const ok = await (await handleAi(post({ facts: FACTS }), env, 'decision')).json();
  assert.equal(ok.retried, true);
  assert.equal(ok.memo.resumen, 'Score 640.');
  let calls = 0;
  const sinPlan = await handleAi(post({ facts: FACTS }), envWith(async () => { calls += 1; throw new Error('5035: upgrade to Workers Paid'); }), 'decision');
  assert.equal(sinPlan.status, 502);
  assert.equal(calls, 3);                                                          // 3 intentos de parámetros, pero SIN segundo intento estricto
  assert.equal((await handleAi(post({}), envWith(async () => ({ response: '{}' })), 'decision')).status, 400);
});

test('un cuerpo enorme se rechaza por Content-Length sin leerlo', async () => {
  const req = new Request('https://x/api/ai/perfil', { method: 'POST', headers: { 'content-length': String(50 * 1024 * 1024) }, body: '{}' });
  let tocado = false;
  req.text = async () => { tocado = true; return '{}'; };
  const res = await handleAi(req, envWith(async () => ({ response: '{}' })), 'perfil');
  assert.equal(res.status, 413);
  assert.equal(tocado, false);
});
