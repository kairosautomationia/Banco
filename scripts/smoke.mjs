// Prueba de humo contra un despliegue real. No guarda ni imprime la contraseña.
//   BASE_URL=https://tu-worker.workers.dev ACCESS_PASSWORD=... node scripts/smoke.mjs
// Comprueba que el sitio cargue, que el front nuevo esté publicado y que cada tarea de IA responda con el modelo.
const base = (process.env.BASE_URL || process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Uso: BASE_URL=https://... [ACCESS_PASSWORD=...] node scripts/smoke.mjs'); process.exit(2); }
const headers = { 'content-type': 'application/json' };
if (process.env.ACCESS_PASSWORD) headers.authorization = `Basic ${Buffer.from(`user:${process.env.ACCESS_PASSWORD}`).toString('base64')}`;

let fails = 0;
const report = (ok, name, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? 'OK  ' : 'FALLA'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const hint = (status, msg) => ({
  401: 'pide contraseña: define ACCESS_PASSWORD', 403: 'modelo no disponible en tu plan (error 5035)', 404: 'la ruta /api/ai no existe: el Worker desplegado no tiene la IA',
  429: 'límite de capacidad: reintenta en un minuto', 503: 'falta el binding "AI" o configuración del proveedor'
}[status] || msg || '');

const facts = {
  decision: 'Perfil favorable · continuar análisis', decision_regla: 'aprobar', banda: 'Bajo riesgo', score: 999,
  monto_solicitado: '$500.000', monto_sugerido: '$500.000', tasa_referencial: '8.0% anual', prob_incumplimiento_ref: '0.5%',
  limites: { monto_max: 500000, tasa_min: 7.5, tasa_max: 10 },
  indicadores: [{ nombre: 'Cobertura de intereses', valor: '11.6×', estado: 'Fuerte', puntos: '110 / 110' }, { nombre: 'Liquidez', valor: '30.5%', estado: 'Fuerte', puntos: '60 / 60' }],
  senales: [{ control: 'Variación abrupta de ventas', activada: false, detalle: 'Variación anual 10.7%; se espera menos de ±35%.' }],
  entradas: {
    sales24: { etiqueta: 'Ventas dic-24', valor: '$12.400.000' }, sales23: { etiqueta: 'Ventas dic-23', valor: '$11.200.000' }, ebitda: { etiqueta: 'EBITDA', valor: '$1.850.000' },
    debt: { etiqueta: 'Deuda en el sistema financiero', valor: '$2.100.000' }, cash: { etiqueta: 'Efectivo y certificados de depósito', valor: '$640.000' }, requested: { etiqueta: 'Deuda solicitada', valor: '$500.000' }
  }
};

async function call(path, init) {
  const started = Date.now();
  try {
    const res = await fetch(base + path, { ...init, headers: { ...headers, ...(init && init.headers) } });
    return { res, ms: Date.now() - started, text: await res.text() };
  } catch (err) { return { error: err.message, ms: Date.now() - started }; }
}

// ¿El sitio está protegido? Sin ACCESS_PASSWORD cualquiera puede gastar la cuota de IA y de OCR.
{
  const anon = await fetch(base + '/').catch(() => null);
  if (anon && anon.status === 200) console.log('AVISO  El sitio responde SIN contraseña: define el secreto ACCESS_PASSWORD en el Worker (la IA y el OCR consumen cuota de cualquiera que lo abra).');
  else if (anon && anon.status === 401) console.log('OK    El sitio está protegido con contraseña');
}
const home = await call('/');
report(home.res && home.res.status === 200 && /Banco/.test(home.text), 'El sitio carga', home.error || `HTTP ${home.res && home.res.status}${home.res && home.res.status === 401 ? ' — ' + hint(401) : ''}`);
if (!home.res || home.res.status !== 200) process.exit(1);
const js = await call('/app.js');
{ const ok = js.res.status === 200 && js.text.includes('requestAi') && js.text.includes('aiFillMissing'); report(ok, 'El front publicado incluye la IA (app.js nuevo)', ok ? '' : 'recarga con Ctrl+F5 o revisa que el build de main terminó'); }

const tasks = [
  ['perfil', { facts: { entradas: facts.entradas } }, (d) => d.perfil && d.perfil.comportamiento],
  ['proteccion', { facts }, (d) => Array.isArray(d.observaciones)],
  ['decision', { facts }, (d) => d.recomendacion && d.memo && d.memo.resumen]
];
for (const [name, body, valid] of tasks) {
  const r = await call(`/api/ai/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (r.error) { report(false, `IA · ${name}`, r.error); continue; }
  let data = {};
  try { data = JSON.parse(r.text); } catch { /* respuesta no JSON */ }
  const ok = r.res.status === 200 && data.ok && valid(data);
  report(ok, `IA · ${name} (${(r.ms / 1000).toFixed(1)} s)`, ok ? `modelo ${data.model}` : `HTTP ${r.res.status}: ${data.error || r.text.slice(0, 160)}${hint(r.res.status) ? ` → ${hint(r.res.status)}` : ''}`);
}
console.log(fails ? `\n${fails} comprobación(es) fallaron.` : '\nTodo en orden.');
process.exit(fails ? 1 : 0);
