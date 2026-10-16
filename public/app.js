const $ = (id) => document.getElementById(id);

/* ---------- Datos de entrada (Sección 1 de la guía del Score Card · Personas jurídicas) ---------- */
const INPUT_IDS = ['sales24', 'sales23', 'sales22', 'sales21', 'debt', 'ebitda', 'finExp', 'cash', 'employees', 'netIncome', 'equity', 'institutions', 'bbDebt', 'requested'];
const FIELD_KEYS = [...INPUT_IDS, 'overdue'];
const FIELD_LABELS = {
  sales24: 'Ventas dic-24', sales23: 'Ventas dic-23', sales22: 'Ventas dic-22', sales21: 'Ventas dic-21',
  debt: 'Deuda en el sistema financiero', ebitda: 'EBITDA', finExp: 'Gastos financieros', cash: 'Efectivo y certificados de depósito',
  employees: 'Número de empleados', netIncome: 'Utilidad neta', equity: 'Patrimonio', institutions: 'Instituciones financieras con deuda',
  bbDebt: 'Deuda actual con el banco', requested: 'Deuda solicitada'
};
const cases = {
  guia: { name: 'Caso de la guía (ejemplo)', initials: 'GU', sales24: 6337000, sales23: 7000000, sales22: 6500000, sales21: 6300000, debt: 999922, ebitda: 400000, finExp: 115000, cash: 28128, employees: 38, netIncome: 316850, equity: 484529, institutions: 1, overdue: 'no', bbDebt: 0, requested: 400000 },
  andina: { name: 'Distribuidora Andina S.A. (ejemplo)', initials: 'DA', sales24: 12400000, sales23: 11200000, sales22: 10100000, sales21: 9300000, debt: 2100000, ebitda: 1850000, finExp: 160000, cash: 640000, employees: 112, netIncome: 1020000, equity: 3900000, institutions: 3, overdue: 'no', bbDebt: 700000, requested: 500000 },
  delta: { name: 'Constructora Delta S.A. (ejemplo)', initials: 'CD', sales24: 3800000, sales23: 4900000, sales22: 5600000, sales21: 5100000, debt: 3200000, ebitda: 210000, finExp: 410000, cash: 15000, employees: 24, netIncome: -85000, equity: 150000, institutions: 6, overdue: 'si', bbDebt: 0, requested: 600000 }
};

/* Fases: cada una se desbloquea al completar la anterior y recibe lo que ella entregó */
const stages = [
  { phase: 'FASE 01 · SOLICITUD', title: 'Solicitud y validación', short: 'Validando la solicitud', input: 'Datos financieros del cliente y deuda solicitada', output: 'Expediente validado' },
  { phase: 'FASE 02 · INTEGRACIÓN', title: 'Perfil financiero integrado', short: 'Integrando comportamiento financiero', input: 'Expediente + ventas de 4 periodos + deuda total', output: 'Perfil financiero y de comportamiento', next: 'Calcular indicadores de riesgo' },
  { phase: 'FASE 03 · RIESGO', title: 'Indicadores de riesgo', short: 'Calculando indicadores de riesgo', input: 'Perfil + deuda actual y solicitada', output: '10 indicadores de cobertura, apalancamiento y liquidez', next: 'Estimar el score' },
  { phase: 'FASE 04 · PREDICCIÓN', title: 'Score 0–999', short: 'Estimando el score', input: 'Indicadores ponderados', output: 'Score y banda de riesgo', next: 'Calcular monto, tasa y señales' },
  { phase: 'FASE 05 · PROTECCIÓN', title: 'Monto, tasa y señales de consistencia', short: 'Personalizando monto y controlando señales', input: 'Score + capacidad de pago + deuda solicitada', output: 'Monto sugerido, tasa y señales', next: 'Ver la recomendación' },
  { phase: 'FASE 06 · DECISIÓN', title: 'Recomendación para el analista', short: 'Recomendación preparada', input: 'Score, monto, tasa y señales', output: 'Recomendación para el analista' }
];
const funnelBase = [2, 4, 6, 4, 3, 2];
const funnelNames = ['Solicitud', 'Integración', 'Riesgo', 'Predicción', 'Protección', 'Decisión'];
const BANDS = {
  low: { label: 'Bajo riesgo', css: 'low', title: 'Perfil favorable · continuar análisis', factor: 1, text: 'Indicadores sólidos. Profundiza con toda la información de análisis antes de decidir.' },
  mod: { label: 'Riesgo moderado', css: 'mod', title: 'Riesgo moderado · profundizar y reforzar garantías', factor: .85, text: 'Capacidad ajustada en algunos indicadores. Profundiza el análisis y refuerza las garantías.' },
  high: { label: 'Alto riesgo', css: 'high', title: 'Alto riesgo · reducir monto o exigir garantías', factor: .5, text: 'Los indicadores muestran debilidad. Reduce el monto y exige garantías adicionales o recházalo.' }
};

let unlocked = 0;      // fase más avanzada alcanzada (0–5)
let viewPhase = 0;     // fase que se muestra
let processing = false;
let timer;
let lastCalc = null;
let customName = '';
let docMarkdown = '';  // texto OCR del documento cargado; alimenta el contexto de la IA en la fase 02
/* Revisión del analista: cada cifra leída de un documento guarda su origen (reglas o IA), su evidencia y si el analista la confirmó o la corrigió. */
let review = {};
let lastExtraction = null;
let approverName = '';

const grouped = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const money = (v) => `${v < 0 ? '-' : ''}$${grouped.format(Math.abs(Math.round(v)))}`;
const short = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const pct = (v) => (isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n.d.');
const times = (v) => (isFinite(v) ? `${v >= 99 ? '>99' : v.toFixed(1)}×` : 'n.d.');
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lin = (x, bad, good) => clamp01((x - bad) / (good - bad));
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const isComplete = () => unlocked === 5;

function readInputs() {
  const d = {};
  INPUT_IDS.forEach((id) => { d[id] = parseField(id); });
  d.overdue = $('overdue').value;
  return d;
}

function validate(d) {
  const errors = [];
  INPUT_IDS.forEach((id) => { if (!isFinite(d[id])) errors.push(`${FIELD_LABELS[id]}: falta el dato`); });
  if (errors.length) return errors;
  ['sales24', 'sales23', 'sales22', 'sales21'].forEach((id) => { if (d[id] <= 0) errors.push(`${FIELD_LABELS[id]} debe ser mayor que 0`); });
  ['debt', 'finExp', 'cash', 'employees', 'bbDebt', 'requested'].forEach((id) => { if (d[id] < 0) errors.push(`${FIELD_LABELS[id]} no puede ser negativo`); });
  if (d.requested <= 0) errors.push('La deuda solicitada debe ser mayor que 0');
  if (!Number.isInteger(d.institutions) || d.institutions < 0) errors.push('Instituciones financieras debe ser un entero ≥ 0');
  if (!Number.isInteger(d.employees)) errors.push('Número de empleados debe ser un entero');
  return errors;
}

/* Modelo ilustrativo y transparente: la guía define variables y rangos de score,
   no los pesos del modelo real. Los pesos aquí son referenciales. */
function compute(d) {
  const debtPF = d.debt + d.requested;
  const cov = d.finExp > 0 ? d.ebitda / d.finExp : (d.ebitda > 0 ? 99 : 0);
  const lev = d.ebitda > 0 ? debtPF / d.ebitda : Infinity;
  const de = d.equity > 0 ? debtPF / d.equity : Infinity;
  const em = d.ebitda / d.sales24;
  const yoy = d.sales24 / d.sales23 - 1;
  const cagr = Math.pow(d.sales24 / d.sales21, 1 / 3) - 1;
  const liq = d.debt > 0 ? d.cash / d.debt : 1;
  const nm = d.netIncome / d.sales24;
  const instRatio = d.institutions === 0 ? .8 : d.institutions <= 3 ? 1 : d.institutions === 4 ? .7 : d.institutions === 5 ? .4 : .1;

  const components = [
    { name: 'Cobertura de intereses', formula: 'EBITDA / gastos financieros', value: times(cov), rule: '1,0× mínimo · 4,0× pleno', weight: 110, ratio: lin(cov, 1, 4) },
    { name: 'Apalancamiento pro forma', formula: '(deuda + solicitada) / EBITDA', value: times(lev), rule: '6,0× mínimo · 2,0× pleno', weight: 120, ratio: lin(lev, 6, 2) },
    { name: 'Deuda sobre patrimonio', formula: '(deuda + solicitada) / patrimonio', value: times(de), rule: '5,0× mínimo · 1,0× pleno', weight: 70, ratio: lin(de, 5, 1) },
    { name: 'Margen EBITDA', formula: 'EBITDA / ventas último periodo', value: pct(em), rule: '2% mínimo · 15% pleno', weight: 70, ratio: lin(em, .02, .15) },
    { name: 'Tendencia de ventas', formula: 'Promedio de variación anual y CAGR 3 años', value: `${pct(yoy)} anual · ${pct(cagr)} CAGR`, rule: '−10% mínimo · +10% pleno', weight: 90, ratio: lin(.5 * yoy + .5 * cagr, -.1, .1) },
    { name: 'Liquidez', formula: 'Efectivo / deuda financiera', value: pct(liq), rule: '0% mínimo · 15% pleno', weight: 60, ratio: lin(liq, 0, .15) },
    { name: 'Rentabilidad neta', formula: 'Utilidad neta / ventas', value: pct(nm), rule: '0% mínimo · 8% pleno', weight: 50, ratio: lin(nm, 0, .08) },
    { name: 'Concentración financiera', formula: 'Instituciones con deuda', value: `${d.institutions}`, rule: '1–3 pleno · 6 o más mínimo', weight: 40, ratio: instRatio },
    { name: 'Antecedentes de accionistas', formula: 'Vencidos reportados en CDR', value: d.overdue === 'si' ? 'Sí' : 'No', rule: 'No = pleno · Sí = 0', weight: 60, ratio: d.overdue === 'si' ? 0 : 1 },
    { name: 'Tamaño operativo', formula: 'Número de empleados', value: `${d.employees}`, rule: '5 mínimo · 50 pleno', weight: 29, ratio: lin(d.employees, 5, 50) }
  ];
  components.forEach((c) => { c.points = c.ratio * c.weight; });
  const score = Math.round(300 + components.reduce((sum, c) => sum + c.points, 0));
  const band = score > 750 ? BANDS.low : score >= 600 ? BANDS.mod : BANDS.high;

  const capacity = Math.max(0, 4.5 * d.ebitda - d.debt);
  const suggested = Math.max(0, Math.floor(Math.min(d.requested, capacity * band.factor) / 1000) * 1000);
  const rate = 8 + (999 - score) / 999 * 6;
  const pd = .5 * Math.exp(-score / 220);

  const flags = [
    { label: 'Variación abrupta de ventas', hit: Math.abs(yoy) > .35, detail: `Variación anual ${pct(yoy)}; se espera menos de ±35%.` },
    { label: 'Utilidad neta mayor que el EBITDA', hit: d.netIncome > d.ebitda, detail: `Utilidad neta ${money(d.netIncome)} frente a EBITDA ${money(d.ebitda)}.` },
    { label: 'Tasa implícita fuera de rango', hit: d.debt > 0 && (d.finExp / d.debt > .3 || d.finExp / d.debt < .01), detail: `Gastos financieros / deuda = ${d.debt > 0 ? pct(d.finExp / d.debt) : 'n.d.'}; se espera entre 1% y 30%.` },
    { label: 'Deuda total menor que la deuda con el banco', hit: d.debt < d.bbDebt, detail: `Deuda del sistema ${money(d.debt)} frente a deuda con el banco ${money(d.bbDebt)}.` },
    { label: 'Accionista con vencidos reportados', hit: d.overdue === 'si', detail: d.overdue === 'si' ? 'Reportado en CDR.' : 'Sin vencidos reportados.' },
    { label: 'Solicitud desproporcionada frente a ventas', hit: d.requested > .5 * d.sales24, detail: `Solicitud = ${pct(d.requested / d.sales24)} de las ventas; se espera menos de 50%.` }
  ];
  return { d, components, score, band, capacity, suggested, rate, pd, flags, flagCount: flags.filter((f) => f.hit).length, lev, cov, yoy };
}

/* ---------- Render de cada fase ---------- */
function ratioLabel(r) { return r >= .67 ? ['Fuerte', 'strong'] : r >= .34 ? ['Medio', 'mid'] : ['Débil', 'weak']; }

function scoreBlock(c) {
  return `<div class="score-block"><div class="score-head"><div><small>SCORE DE REFERENCIA</small><b>${c.score}</b><span>/ 999</span></div><em class="band-pill ${c.band.css}">${c.band.label}</em></div>
    <div class="score-scale" role="img" aria-label="Score ${c.score} de 999. Menor a 600 alto riesgo, 600 a 750 moderado, mayor a 750 bajo"><i class="seg high" style="flex:600"></i><i class="seg mod" style="flex:150"></i><i class="seg low" style="flex:249"></i><span class="pointer" style="left:${Math.min(100, c.score / 999 * 100)}%"></span></div>
    <div class="score-ticks"><span>0</span><span style="left:60.06%">600</span><span style="left:75.08%">750</span><span>999</span></div>
    <div class="score-legend"><span><i class="seg high"></i>Alto &lt; 600</span><span><i class="seg mod"></i>Moderado 600–750</span><span><i class="seg low"></i>Bajo &gt; 750</span></div></div>`;
}

/* La app solo recomienda: la decisión es del analista y queda registrada en el expediente de revisión. */
function approvalHtml(c) {
  const a = c.approval;
  const waiting = c.ai && c.ai.decision && c.ai.decision.status === 'loading';
  const state = a
    ? `<p class="approval-state ${a.decision}" role="status"><b>${a.decision === 'aprobada' ? 'Recomendación aprobada' : 'Devuelta a revisión'}</b> por ${esc(a.analyst)} · ${esc(a.label)}</p>`
    : `<p class="approval-state">${waiting ? 'Espera a que la IA termine su recomendación para decidir.' : 'Pendiente de tu decisión.'}</p>`;
  return `<section class="approval" aria-labelledby="approvalTitle"><h4 class="body-title" id="approvalTitle">Decisión del analista</h4><p class="body-note">La app solo recomienda; la decisión es tuya y queda en el expediente de revisión.</p>
    <label class="approval-name">Analista<input id="approver" type="text" maxlength="80" autocomplete="name" placeholder="Tu nombre" value="${esc(approverName)}"></label>
    <div class="approval-actions"><button type="button" class="run-button" data-approve="aprobada"${waiting ? ' disabled' : ''}>Aprobar recomendación</button><button type="button" class="reset-button" data-approve="devuelta"${waiting ? ' disabled' : ''}>Devolver a revisión</button><button type="button" class="reset-button" data-export="1">Descargar expediente (JSON)</button></div>${state}</section>`;
}

function phaseHtml(i) {
  const c = lastCalc;
  const d = c.d;
  if (i === 1) {
    const periods = [['dic-21', d.sales21], ['dic-22', d.sales22], ['dic-23', d.sales23], ['dic-24', d.sales24]];
    const max = Math.max(...periods.map((p) => p[1]));
    const bars = periods.map(([p, v], k) => `<div class="bar-col${k === 3 ? ' is-now' : ''}"><b>${short(v)}</b><i style="height:${Math.round(v / max * 100)}%"></i><span>${p}</span></div>`).join('');
    const facts = [
      ['Deuda en el sistema financiero', money(d.debt)], ['Instituciones con deuda', String(d.institutions)],
      ['Accionistas con vencidos', d.overdue === 'si' ? 'Sí' : 'No'], ['Deuda actual con el banco', money(d.bbDebt)],
      ['Deuda solicitada', money(d.requested)], ['Deuda total pro forma', money(d.debt + d.requested)]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    return `<div class="split"><div><h4 class="body-title">Ventas anuales por periodo</h4><div class="bar-chart four show-all" role="img" aria-label="Ventas por periodo: ${periods.map(([p, v]) => `${p} ${money(v)}`).join(', ')}">${bars}</div><p class="body-note">Variación del último año: <b>${pct(c.yoy)}</b></p></div><div class="fact-grid">${facts}</div></div>${aiSlot('perfil')}`;
  }
  if (i === 2) {
    return `<div class="i-table">${c.components.map((k) => { const [t, cls] = ratioLabel(k.ratio); return `<div class="i-row"><div class="b-name"><b>${k.name}</b><small>${k.formula}</small></div><div class="b-value">${k.value}</div><div class="i-status ${cls}">${t}</div><small class="i-rule">${k.rule}</small></div>`; }).join('')}</div>`;
  }
  if (i === 3) {
    const rows = c.components.map((k) => `<div class="b-row"><div class="b-name"><b>${k.name}</b><small>${k.formula}</small></div><div class="b-value">${k.value}</div><div class="b-bar" aria-hidden="true"><i style="width:${k.ratio * 100}%"></i></div><div class="b-pts">${Math.round(k.points)} / ${k.weight}</div></div>`).join('');
    return `${scoreBlock(c)}<h4 class="body-title">Contribución de cada indicador <small>Pesos referenciales · base 300 + indicadores</small></h4><div class="breakdown">${rows}<div class="b-total"><span>Base 300 + indicadores</span><b>${c.score} / 999</b></div></div><p class="body-note">Probabilidad de incumplimiento referencial: <b>${(c.pd * 100).toFixed(1)}%</b> (estimación derivada del score, no calibrada).</p>`;
  }
  if (i === 4) {
    const checks = c.flags.map((f) => `<li class="${f.hit ? 'hit' : 'pass'}"><span class="check-tag">${f.hit ? 'Alerta' : 'OK'}</span><div><b>${f.label}</b><small>${esc(f.detail)}</small></div></li>`).join('');
    return `<div class="kpi-row"><div><span>Monto sugerido</span><b>${money(c.suggested)}</b><small>${c.suggested < d.requested ? `Menor que lo solicitado (${money(d.requested)})` : 'Igual a la deuda solicitada'}</small></div><div><span>Tasa recomendada (ref.)</span><b>${c.rate.toFixed(1)}% anual</b><small>Mayor score, menor tasa</small></div><div><span>Capacidad a 4,5× EBITDA</span><b>${money(c.capacity)}</b><small>Margen adicional sobre la deuda actual</small></div></div><h4 class="body-title">Controles de consistencia <small>${c.flagCount} de ${c.flags.length} activados</small></h4><ul class="check-list">${checks}</ul>${aiSlot('proteccion')}`;
  }
  // i === 5
  const weakest = [...c.components].sort((a, b) => a.ratio - b.ratio)[0];
  const strongest = [...c.components].sort((a, b) => b.ratio - a.ratio)[0];
  const items = [
    ['Integración', `Ventas de ${money(d.sales21)} (dic-21) a ${money(d.sales24)} (dic-24); ${d.institutions} institución(es) con deuda; accionistas ${d.overdue === 'si' ? 'con vencidos reportados' : 'sin vencidos reportados'}.`],
    ['Riesgo', `Cobertura ${times(c.cov)} y apalancamiento pro forma ${times(c.lev)}. Más fuerte: ${strongest.name.toLowerCase()}; más débil: ${weakest.name.toLowerCase()} (${Math.round(weakest.points)} / ${weakest.weight} pts).`],
    ['Predicción', `Score ${c.score} / 999 · ${c.band.label.toLowerCase()}. Probabilidad de incumplimiento referencial ${(c.pd * 100).toFixed(1)}% (sin calibrar).`],
    ['Protección', `Monto sugerido ${money(c.suggested)} a ${c.rate.toFixed(1)}% anual; ${c.flagCount} de ${c.flags.length} señales de consistencia.`]
  ].map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('');
  return `<div class="final-grid"><div>${scoreBlock(c)}<div class="decision-banner"><span aria-hidden="true">✓</span><div><small>RECOMENDACIÓN DE LAS REGLAS</small><h4>${c.band.title}</h4></div></div><p class="decision-copy">${c.band.text}${c.flagCount ? ` ${c.flagCount} señal${c.flagCount > 1 ? 'es' : ''} de consistencia por validar.` : ''}</p></div>
    <div><div class="kpi-row two"><div><span>Monto sugerido</span><b>${money(c.suggested)}</b></div><div><span>Tasa (ref.)</span><b>${c.rate.toFixed(1)}%</b></div></div><h4 class="body-title">Por qué esta recomendación</h4><ol class="explain-list open">${items}</ol></div></div>
    ${aiSlot('decision')}
    ${approvalHtml(c)}
    <p class="decision-disclaimer">No es una preaprobación de crédito: según el monto, debe estar cubierto por garantías adicionales. El resultado no considera filtros duros ni de entidades gubernamentales (SRI, IESS, entre otras). El score es una referencia inicial que debe profundizarse con toda la información de análisis.</p>`;
}

/* ---------- Estado y navegación entre fases ---------- */
const MONEY_IDS = INPUT_IDS.filter((id) => id !== 'employees' && id !== 'institutions');
const fmtInt = (n) => (n === '' || n === null || n === undefined || !isFinite(Number(n)) ? '' : `${Number(n) < 0 ? '-' : ''}${grouped.format(Math.abs(Math.round(Number(n))))}`);
/* Quita los centavos sin confundirlos con miles: «1.23» (tras borrar un dígito de «1.234») son miles, no decimales. */
const stripCents = (raw) => {
  if (/,\d{1,2}$/.test(raw)) return raw.replace(/,\d{1,2}$/, '');                                                  // coma decimal: 1.234,56
  if (/^[^.,]*\d{4,}\.\d{1,2}$/.test(raw) || /,\d{3}\.\d{1,2}$/.test(raw)) return raw.replace(/\.\d{1,2}$/, '');   // 1234.56 · 1,234.56
  return raw;
};
const parseField = (id) => {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  if (MONEY_IDS.includes(id)) { const digits = stripCents(raw).replace(/[^\d-]/g, ''); return /\d/.test(digits) ? Number(digits) : NaN; }
  return Number(raw);
};
const setField = (id, value) => { $(id).value = MONEY_IDS.includes(id) ? fmtInt(value) : value; };

/* Formato de miles con puntos mientras se escribe, conservando la posición del cursor */
function formatMoneyInput(input) {
  const before = stripCents(input.value);
  const caret = input.selectionStart === null ? before.length : input.selectionStart;
  const digitsLeft = before.slice(0, caret).replace(/[^\d]/g, '').length;
  const negative = before.trim().startsWith('-') && ['netIncome', 'ebitda', 'equity'].includes(input.id);
  const digits = before.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) { input.value = negative ? '-' : ''; return; }
  const formatted = (negative ? '-' : '') + grouped.format(Number(digits));
  input.value = formatted;
  let pos = 0, seen = 0;
  while (pos < formatted.length && seen < digitsLeft) { if (/\d/.test(formatted[pos])) seen += 1; pos += 1; }
  try { input.setSelectionRange(pos, pos); } catch { /* campo sin selección */ }
}

function renderHeader() {
  const key = $('caseSelect').value;
  $('caseClient').textContent = key === 'custom' ? (customName || 'Empresa personalizada') : cases[key].name.replace(' (ejemplo)', '');
  $('caseAvatar').textContent = key === 'custom' ? (customName ? customName.replace(/\.[^.]+$/, '').slice(0, 2).toUpperCase() : 'EP') : cases[key].initials;
  $('caseAmount').textContent = money(parseField('requested') || 0);
  renderDataSummary();
}

/* Resumen de «Datos extraídos»: estado y cifras clave visibles aunque la sección esté plegada */
const setDataOpen = (open) => { const d = $('dataDetails'); if (d) d.open = open; };

function renderDataSummary() {
  if (!$('dataStatus') || !$('dataKeys')) return;
  const missing = FIELD_KEYS.filter((id) => (id === 'overdue' ? $(id).closest('label').classList.contains('field-missing') : !isFinite(parseField(id))));
  const status = $('dataStatus');
  status.className = `ds-status ${missing.length ? 'warn' : 'ok'}`;
  status.textContent = missing.length ? `${missing.length} por completar` : `${FIELD_KEYS.length} de ${FIELD_KEYS.length} completos`;
  const val = (id) => { const n = parseField(id); return isFinite(n) ? money(n) : 'n.d.'; };
  $('dataKeys').innerHTML = [['Ventas dic-24', 'sales24'], ['EBITDA', 'ebitda'], ['Deuda sistema', 'debt'], ['Solicitada', 'requested']].map(([k, id]) => `<span><small>${k}</small><b>${val(id)}</b></span>`).join('');
}

function render() {
  document.querySelectorAll('.phase-panel').forEach((panel) => { panel.hidden = Number(panel.dataset.phase) !== viewPhase; });
  document.querySelectorAll('.stage').forEach((node) => {
    const i = Number(node.dataset.stage);
    const finished = i < unlocked || (i === 5 && isComplete());
    node.classList.toggle('is-done', finished && !(i === viewPhase && !(i === 5 && isComplete())));
    node.classList.toggle('is-current', i === viewPhase && !(i === 5 && isComplete()));
    node.classList.toggle('is-locked', i > unlocked);
    node.classList.toggle('is-processing', processing && i === unlocked + 1);
    node.setAttribute('aria-disabled', String(i > unlocked));
    node.setAttribute('aria-current', i === viewPhase ? 'step' : 'false');
  });
  $('railProgress').style.setProperty('--progress', `${unlocked / 5 * 100}%`);
  const ps = $('processStatus');
  if (processing) { ps.className = 'process-status running'; ps.innerHTML = `<i></i><span>${stages[unlocked + 1 > 5 ? 5 : unlocked + 1].short}…</span>`; }
  else if (isComplete()) { ps.className = 'process-status complete'; ps.innerHTML = '<i></i><span>Decisión lista</span>'; }
  else if (unlocked === 0) { ps.className = 'process-status'; ps.innerHTML = '<i></i><span>Esperando validación</span>'; }
  else { ps.className = 'process-status running'; ps.innerHTML = `<i></i><span>Fase ${String(unlocked + 1).padStart(2, '0')} desbloqueada</span>`; }
  document.querySelectorAll('.phase-actions .run-button').forEach((b) => { b.disabled = processing; });
  $('runSimulation').disabled = processing;
  $('runSimulation').innerHTML = processing ? 'Validando…' : unlocked > 0 ? 'Datos validados · continuar <span>→</span>' : 'Validar datos y continuar <span>→</span>';
  syncViews();
}

function fillPanels() {
  for (let i = 1; i <= 5; i += 1) {
    const body = $(`phaseBody${i}`);
    body.innerHTML = i <= unlocked && lastCalc ? phaseHtml(i) : '';
  }
}

function goTo(i) {
  if (processing || i > unlocked) return;
  viewPhase = i;
  render();
  const panel = document.querySelector(`.phase-panel[data-phase="${i}"]`);
  if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function advance() {
  if (processing) return;
  if (unlocked === 0) {
    const pending = pendingReview();
    const errors = [...validate(readInputs()), ...pending.map((id) => `${fieldLabel(id)}: la IA propuso esta cifra; confírmala contra el documento o corrígela`)];
    if (pending.length) renderExtractReport(true);
    if (errors.length) {
      $('formErrors').hidden = false;
      setDataOpen(true);
      $('formErrors').innerHTML = `<b>Revisa los datos antes de continuar:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      showToast('Faltan datos o hay valores inválidos');
      return;
    }
    $('formErrors').hidden = true;
    lastCalc = compute(readInputs());
  }
  processing = true;
  render();
  timer = setTimeout(() => {
    processing = false;
    unlocked += 1;
    viewPhase = unlocked;
    fillPanels();
    if (unlocked === 1) requestAi('perfil');
    if (unlocked === 4) requestAi('proteccion');
    if (unlocked === 5) requestAi('decision');
    if (unlocked === 1) notify('ok', 'Datos validados', 'El expediente quedó listo; continúa con la fase 02.', { phase: 1 });
    if (unlocked === 4) { const c = lastCalc; notify(c.flagCount ? 'warn' : 'ok', c.flagCount ? `${c.flagCount} de ${c.flags.length} controles de consistencia activados` : 'Controles de consistencia en orden', c.flagCount ? c.flags.filter((f) => f.hit).map((f) => f.label).join('; ') : `0 de ${c.flags.length} señales activadas.`, { phase: 4 }); }
    if (isComplete()) notify('ok', 'Análisis completo', `${lastCalc.band.label} · monto sugerido ${money(lastCalc.suggested)}.`, { phase: 5 });
    if (isComplete()) { $('lastUpdate').textContent = 'ahora'; showToast('Análisis completo: recomendación lista'); }
    else showToast(`Fase ${String(unlocked + 1).padStart(2, '0')} desbloqueada`);
    render();
  }, 650);
}

function resetCase() {
  clearTimeout(timer);
  cancelUpload();
  processing = false;
  unlocked = 0;
  viewPhase = 0;
  lastCalc = null;
  customName = '';
  docMarkdown = '';
  clearExtractionMarks();
  setDataOpen(false);
  notify('info', 'Expediente reiniciado', 'Se restauró el caso de la guía.', { phase: 0 });
  applyCase('guia');
  $('formErrors').hidden = true;
  fillPanels();
  renderHeader();
  render();
}

function applyCase(key) {
  const c = cases[key];
  INPUT_IDS.forEach((id) => setField(id, c[id]));
  $('overdue').value = c.overdue;
  $('caseSelect').value = key;
}

function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 2600); }

function invalidateAnalysis(event) {
  if (event && event.target && event.target.id !== 'caseSelect') $('caseSelect').value = 'custom';
  renderHeader();
  clearTimeout(timer);
  processing = false;
  const hadProgress = unlocked > 0;
  unlocked = 0;
  viewPhase = 0;
  lastCalc = null;
  fillPanels();
  render();
  if (hadProgress) { showToast('Los datos cambiaron: vuelve a validar para continuar'); notify('warn', 'Los datos cambiaron', 'El análisis se invalidó: vuelve a validar los datos.', { phase: 0 }); }
}

/* ---------- Sincronización con las otras vistas ---------- */
function trackHtml(phase, done) {
  return funnelNames.map((name, i) => `<i class="${i < phase || (done && i === phase) ? 'done' : i === phase ? 'cur' : ''}" title="${name}"></i>`).join('');
}
function syncViews() {
  const phase = unlocked;
  const done = isComplete();
  const track = $('row1048Track');
  track.innerHTML = trackHtml(phase, done);
  track.setAttribute('aria-label', `Fase ${phase + 1} de 6${done ? ', completa' : ''}`);
  const status = $('row1048Status');
  status.textContent = done ? 'Decisión lista' : processing ? 'En análisis' : unlocked > 0 ? 'En análisis' : 'Sin analizar';
  status.className = `status-pill ${done ? 'approved' : 'review'}`;
  document.querySelectorAll('.phase-track[data-phase]').forEach((el) => { el.innerHTML = trackHtml(Number(el.dataset.phase), el.dataset.done === '1'); });
  const counts = funnelBase.map((n, i) => n + (i === phase ? 1 : 0));
  const max = Math.max(...counts);
  $('funnel').innerHTML = counts.map((n, i) => `<div class="funnel-row${i === phase ? ' is-active' : ''}"><span>${String(i + 1).padStart(2, '0')} · ${funnelNames[i]}</span><div class="funnel-bar"><i style="width:${n / max * 100}%"></i></div><b>${n}</b></div>`).join('');
  if (unlocked >= 4 && lastCalc) {
    const f = lastCalc.flagCount;
    const hits = lastCalc.flags.filter((x) => x.hit).map((x) => x.label).join('; ');
    $('fraudLiveTitle').textContent = f === 0 ? 'Sin señales de inconsistencia en el expediente' : `${f} señal${f > 1 ? 'es' : ''} de inconsistencia para revisar`;
    const prot = lastCalc.ai && lastCalc.ai.proteccion && lastCalc.ai.proteccion.status === 'ok' ? lastCalc.ai.proteccion.data.observaciones : [];
    const aiFraud = prot.filter((o) => o.categoria === 'fraude').length;
    $('fraudLiveText').textContent = `#CR-2026-1048 · ${f} / ${lastCalc.flags.length} controles activados${hits ? ` · ${hits}` : ''}${prot.length ? ` · IA: ${prot.length} observación(es)${aiFraud ? `, ${aiFraud} de posible fraude` : ''}` : ''}`;
  } else {
    $('fraudLiveTitle').textContent = 'Expediente en simulación sin analizar';
    $('fraudLiveText').textContent = '#CR-2026-1048 · Las señales se evalúan en la fase de Protección';
  }
  $('row1048Amount').textContent = $('caseAmount').textContent;
  $('row1048Client').textContent = $('caseClient').textContent;
}

/* ---------- Eventos ---------- */
$('caseSelect').addEventListener('change', (event) => {
  if (event.target.value !== 'custom') { cancelUpload(); customName = ''; docMarkdown = ''; clearExtractionMarks(); applyCase(event.target.value); }
  invalidateAnalysis(event);
});
MONEY_IDS.forEach((id) => $(id).addEventListener('input', () => formatMoneyInput($(id))));
[...INPUT_IDS, 'overdue'].forEach((id) => $(id).addEventListener('input', (event) => {
  if (review[id] && !review[id].edited) { review[id].edited = true; renderExtractReport(); }   // el analista cambió la cifra: queda como corregida
  invalidateAnalysis(event);
}));
$('extractReport').addEventListener('click', (event) => {
  const b = event.target && event.target.closest ? event.target.closest('[data-confirm]') : null;
  if (!b || !review[b.dataset.confirm]) return;
  review[b.dataset.confirm].confirmed = true;
  renderExtractReport();
});

/* Expediente de revisión: qué se leyó, de dónde, qué confirmó el analista y qué decidió. Se descarga en el navegador; no se guarda en ningún servidor. */
function buildRecord() {
  const c = lastCalc;
  const d = c.d;
  const example = $('caseSelect').value !== 'custom';
  const origin = (id) => (review[id] ? (review[id].source === 'ia' ? 'documento · IA' : 'documento · reglas') : example ? 'caso de ejemplo' : 'manual');
  const status = (id) => { const r = review[id]; return !r ? null : r.edited ? 'corregido por el analista' : r.source === 'ia' ? (r.confirmed ? 'confirmado por el analista' : 'sin confirmar') : 'leído por reglas'; };
  const ai = (k) => { const s = c.ai && c.ai[k]; return !s ? 'no solicitada' : s.status === 'ok' ? `ok (${s.data.model})` : s.status === 'loading' ? 'en curso' : `no disponible: ${s.error}`; };
  const dec = c.ai && c.ai.decision && c.ai.decision.status === 'ok' ? c.ai.decision.data : null;
  return {
    formato: 'banco-4.0/expediente-revision/1',
    generado: new Date().toISOString(),
    nota: 'Pre-análisis asistido: la IA propone, las reglas validan y el analista decide. El score y la probabilidad de incumplimiento son de referencia y no están calibrados.',
    expediente: $('caseClient').textContent,
    archivo: example ? null : customName || null,
    campos: FIELD_KEYS.map((id) => ({ campo: id, etiqueta: fieldLabel(id), valor: d[id], origen: origin(id), evidencia: review[id] ? review[id].evidence : null, revision: status(id) })),
    reglas: { score_referencia: c.score, banda: c.band.label, monto_sugerido: c.suggested, tasa_referencial: Number(c.rate.toFixed(1)), prob_incumplimiento_referencial_sin_calibrar: Number(c.pd.toFixed(4)), controles_activados: c.flags.filter((f) => f.hit).map((f) => f.label) },
    ia: { perfil: ai('perfil'), proteccion: ai('proteccion'), decision: ai('decision'), recomendacion: dec ? dec.recomendacion : null },
    decision_analista: c.approval ? { decision: c.approval.decision, analista: c.approval.analyst, fecha: c.approval.iso } : null
  };
}

function downloadRecord() {
  const blob = new Blob([JSON.stringify(buildRecord(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `expediente-revision-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('phaseBody5').addEventListener('input', (event) => { if (event.target && event.target.id === 'approver') approverName = event.target.value; });
$('phaseBody5').addEventListener('click', (event) => {
  const b = event.target && event.target.closest ? event.target.closest('[data-approve], [data-export]') : null;
  if (!b || !lastCalc || !isComplete()) return;
  if (b.dataset.export) { downloadRecord(); return; }
  const name = approverName.trim();
  if (!name) { showToast('Escribe tu nombre para registrar la decisión'); if ($('approver')) $('approver').focus(); return; }
  const now = new Date();
  lastCalc.approval = { decision: b.dataset.approve, analyst: name, iso: now.toISOString(), label: now.toLocaleString('es') };
  $('phaseBody5').innerHTML = phaseHtml(5);
  notify(b.dataset.approve === 'aprobada' ? 'ok' : 'warn', b.dataset.approve === 'aprobada' ? 'Recomendación aprobada' : 'Devuelta a revisión', `Decisión registrada por ${name}. Descarga el expediente de revisión desde la fase 06.`, { phase: 5 });
});
$('runSimulation').addEventListener('click', () => { if (unlocked > 0) goTo(1); else advance(); });
document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
  if (viewPhase < unlocked) goTo(viewPhase + 1); else advance();
}));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => goTo(Math.max(0, viewPhase - 1))));
document.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', resetCase));
document.querySelectorAll('.stage').forEach((stageButton) => stageButton.addEventListener('click', () => {
  const i = Number(stageButton.dataset.stage);
  if (i > unlocked) { showToast(`Completa la fase ${String(unlocked + 1).padStart(2, '0')} para desbloquear esta capa`); return; }
  goTo(i);
}));
document.querySelectorAll('.alert-row button').forEach((button) => button.addEventListener('click', () => showToast('Alerta asignada a Finanzas & Riesgo')));

const viewMap = { simulator: 'simulatorView', requests: 'requestsView', monitoring: 'monitoringView', fraud: 'fraudView' };
function openView(view) {
  Object.entries(viewMap).forEach(([key, id]) => $(id).style.display = key === view ? 'block' : 'none');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view !== 'simulator') showToast(`${document.querySelector(`[data-view="${view}"]`).textContent.trim()} abierto`);
}
document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => openView(item.dataset.view)));
document.querySelectorAll('[data-go]').forEach((item) => item.addEventListener('click', () => openView(item.dataset.go)));

/* ---------- Carga de archivos y OCR ---------- */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function clearExtractionMarks() {
  review = {};
  lastExtraction = null;
  FIELD_KEYS.forEach((id) => { const l = $(id).closest('label'); if (l) l.classList.remove('field-extracted', 'field-missing'); });
  $('extractReport').hidden = true;
  $('uploadStatus').hidden = true;
}

function setUploadStatus(kind, text) {
  const el = $('uploadStatus');
  el.hidden = false;
  el.className = `upload-status ${kind}`;
  el.textContent = text;
  if (kind === 'error') notify('error', 'No se pudo cargar el archivo', text, { phase: 0 });
}

const fieldLabel = (id) => (id === 'overdue' ? '¿Accionista ha reportado vencidos?' : FIELD_LABELS[id]);
const fieldShown = (id) => {
  if (id === 'overdue') return $(id).value === 'si' ? 'Sí' : 'No';
  const n = parseField(id);
  return !isFinite(n) ? 'vacío' : id === 'employees' || id === 'institutions' ? String(n) : money(n);
};
const pendingReview = () => FIELD_KEYS.filter((id) => review[id] && review[id].source === 'ia' && !review[id].confirmed && !review[id].edited);

function reviewTag(id) {
  const r = review[id];
  if (r.edited) return ' <em class="ai-tag ok">Corregido por el analista</em>';
  if (r.source !== 'ia') return '';
  return r.confirmed ? ' <em class="ai-tag ok">IA · confirmado</em>' : ' <em class="ai-tag">IA · confirma contra el documento</em>';
}

/* Lista de cifras leídas con su evidencia. Las que propuso la IA exigen que el analista las confirme (o las corrija) antes de validar. */
function renderExtractReport(forceOpen) {
  const x = lastExtraction;
  if (!x) return;
  const prev = $('extractReport').querySelector('details');
  const open = forceOpen || !!(prev && prev.open);
  const pending = pendingReview();
  const nAi = x.found.filter((id) => review[id] && review[id].source === 'ia').length;
  const rows = x.found.map((id) => `<li${review[id].source === 'ia' ? ' class="ai"' : ''}><b>${fieldLabel(id)}${reviewTag(id)}</b><span>${fieldShown(id)}</span><small>${esc(review[id].evidence)}</small>${pending.includes(id) ? `<button type="button" class="confirm-btn" data-confirm="${id}">Confirmar cifra</button>` : ''}</li>`).join('');
  const miss = x.missing.map((id) => `<li class="miss"><b>${fieldLabel(id)}</b><span>No encontrado</span><small>Complétalo manualmente</small></li>`).join('');
  const warn = [...x.warnings, ...(pending.length ? [`Confirma contra el documento ${pending.length === 1 ? 'la cifra' : 'las ' + pending.length + ' cifras'} que propuso la IA antes de validar.`] : [])];
  $('extractReport').hidden = false;
  $('extractReport').innerHTML = `<div class="extract-head"><b>${x.found.length} de ${FIELD_KEYS.length} campos extraídos de ${esc(x.filename)}${nAi ? ` (${nAi} completados con IA)` : ''}</b>${warn.map((w) => `<p class="extract-warning">${esc(w)}</p>`).join('')}</div><details class="extract-more"${open ? ' open' : ''}><summary>Ver detalle y evidencia por campo</summary><ul>${rows}${miss}</ul></details>`;
}

function applyExtraction(result, filename, ai = { values: {}, evidence: {} }) {
  const values = { ...result.values, ...ai.values };
  const evidence = { ...result.evidence, ...ai.evidence };
  const warnings = [...result.warnings, ...(ai.error ? [`La IA no pudo completar los campos faltantes: ${ai.error}`] : []), ...(ai.scaleNote ? ['La IA detectó cifras en miles o millones: ningún valor se multiplicó. Ajusta la escala de todos los campos antes de analizar.'] : [])];
  const byAi = (id) => ai.values[id] !== undefined;
  customName = filename;
  FIELD_KEYS.forEach((id) => {
    const label = $(id).closest('label');
    const found = values[id] !== undefined;
    if (found) { if (id === 'overdue') $(id).value = values[id]; else setField(id, values[id]); }
    else if (id !== 'overdue') $(id).value = '';
    label.classList.toggle('field-extracted', found && !byAi(id));
    label.classList.toggle('field-ai', found && byAi(id));
    label.classList.toggle('field-missing', !found);
  });
  const found = FIELD_KEYS.filter((id) => values[id] !== undefined);
  const missing = FIELD_KEYS.filter((id) => values[id] === undefined);
  review = {};
  found.forEach((id) => { review[id] = { source: byAi(id) ? 'ia' : 'regla', evidence: evidence[id] || '', confirmed: false, edited: false }; });
  lastExtraction = { filename, warnings, found, missing };
  renderExtractReport(found.some(byAi));
  $('caseSelect').value = 'custom';
  setDataOpen(true);  // tras cargar un documento hay que revisar lo extraído
  invalidateAnalysis({ target: { id: 'fileInput' } });
  notify(missing.length || warnings.length ? 'warn' : 'ok', `“${filename}” leído: ${found.length} de ${FIELD_KEYS.length} campos`, [Object.keys(ai.values).length ? `${Object.keys(ai.values).length} completados con IA: verifícalos.` : '', missing.length ? `Faltan: ${missing.map(fieldLabel).join(', ')}.` : '', ...warnings].filter(Boolean).join(' '), { phase: 0 });
  setUploadStatus(missing.length || warnings.length ? 'warn' : 'ok', missing.length ? `Extracción parcial: faltan ${missing.length} campo(s). Complétalos abajo antes de validar.` : Object.keys(ai.values).length ? 'Extracción completa. Los campos marcados con IA requieren tu verificación contra el documento.' : warnings.length ? 'Extracción completa, con una advertencia. Revisa los valores.' : 'Extracción completa. Revisa los valores y valida los datos.');
}

/* Texto que devuelve el OCR: LlamaParse v2 lo entrega como markdown.pages[].markdown; el servidor local, como cadena. */
function ocrText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.markdown === 'string') return data.markdown;
  if (typeof data.markdown_full === 'string') return data.markdown_full;
  const pages = data.markdown && Array.isArray(data.markdown.pages) ? data.markdown.pages : [];
  return pages.map((p) => (typeof p === 'string' ? p : (p && (p.markdown || p.text)) || '')).filter(Boolean).join('\n\n');
}

let uploadCtl = null;   // carga de archivo en curso
function cancelUpload() {
  if (uploadCtl) { uploadCtl.abort(); uploadCtl = null; }
  $('dropzone').classList.remove('is-busy');
}

async function handleFile(file) {
  if (!file) return;
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv'].includes(ext)) { setUploadStatus('error', `Formato no admitido (${ext || 'sin extensión'}). Usa PDF, Word, Excel o CSV.`); return; }
  if (file.size > MAX_FILE_BYTES) { setUploadStatus('error', 'El archivo supera 20 MB.'); return; }
  if (!file.size) { setUploadStatus('error', 'El archivo está vacío.'); return; }
  cancelUpload();
  const ctl = (uploadCtl = new AbortController());
  $('dropzone').classList.add('is-busy');
  setUploadStatus('busy', `Leyendo “${file.name}” con OCR… puede tardar hasta un par de minutos.`);
  try {
    const res = await fetch('/api/extract', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' }, body: file, signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    const text = ocrText(data);
    if (!text.trim()) throw new Error(`El OCR no devolvió texto legible del documento (la respuesta trae: ${data && typeof data === 'object' ? Object.keys(data).join(', ') || 'nada' : 'nada'}).`);
    docMarkdown = text;
    const result = Extractor.extract(text);
    const ai = await aiFillMissing(text, result);
    if (ctl.signal.aborted) return;
    if (!Object.keys(result.values).length && !Object.keys(ai.values).length) throw new Error('No se reconoció ninguno de los 15 campos. Ingresa los datos manualmente o prueba con otro archivo.');
    applyExtraction(result, file.name, ai);
  } catch (err) {
    if (ctl.signal.aborted) return;
    const offline = err instanceof TypeError || location.protocol === 'file:';
    setUploadStatus('error', offline ? 'No se pudo contactar el servidor local. Inícialo con “node server.js” y abre http://localhost:3000.' : err.message);
  } finally {
    if (uploadCtl === ctl) { uploadCtl = null; $('dropzone').classList.remove('is-busy'); }
    $('fileInput').value = '';
  }
}

const dropzone = $('dropzone');
dropzone.addEventListener('click', () => $('fileInput').click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
$('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

/* ---------- IA: integración, protección y decisión (vía /api/ai/*) ----------
   Siempre es un complemento: si falla o no está disponible, el simulador sigue con sus reglas. */
const INT_IDS = new Set(['employees', 'institutions']);
const AI_MAX_DOC = 200000;   // caracteres del documento que se envían a la IA (igual que el servidor)
const AI_TIMEOUT_MS = 100000;

async function callAi(task, payload) {
  let res;
  try {
    res = await fetch(`/api/ai/${task}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(AI_TIMEOUT_MS) : undefined });
  } catch (err) {
    throw new Error(err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'La IA tardó demasiado en responder' : 'No se pudo contactar a la IA');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `IA no disponible (${res.status})`), { unavailable: res.status === 404 });
  return data;
}

/* Fase 02: completa solo los campos que el extractor por reglas no encontró; el servidor ya verificó la evidencia */
async function aiFillMissing(markdown, result) {
  const out = { values: {}, evidence: {} };
  const missing = FIELD_KEYS.filter((id) => result.values[id] === undefined);
  if (!missing.length) return out;
  setUploadStatus('busy', `OCR listo. Buscando con IA los ${missing.length} campo(s) que faltan…`);
  try {
    const data = await callAi('integracion', { markdown: markdown.slice(0, AI_MAX_DOC), missing });
    Object.entries(data.campos || {}).forEach(([id, c]) => {
      if (!missing.includes(id)) return;
      if (id === 'overdue') { out.values[id] = c.valor; out.evidence[id] = c.evidencia; return; }
      const n = Extractor.parseNumber(c.cifra);
      if (!isFinite(n)) return;
      out.values[id] = INT_IDS.has(id) ? Math.round(n) : n;
      out.evidence[id] = `${c.evidencia}${c.escala > 1 ? ` (el documento declara cifras en ${c.escala === 1000 ? 'miles' : 'millones'}; se dejó el valor impreso)` : ''}`;
      if (c.escala > 1) out.scaleNote = true;
    });
  } catch (err) {
    if (!err.unavailable) out.error = err.message;
  }
  return out;
}

/* Datos que la IA recibe: todo ya formateado como lo ve el analista. La fase 02 solo ve las entradas (aún no hay score). */
const DECISION_BY_BAND = { low: 'aprobar', mod: 'aprobar_con_condiciones', high: 'reducir_monto' };
const DECISION_LABELS = { aprobar: 'Aprobar y continuar el análisis', aprobar_con_condiciones: 'Aprobar con condiciones', reducir_monto: 'Reducir el monto o exigir garantías', rechazar: 'Rechazar' };

function aiFacts(c, kind) {
  const d = c.d;
  const inputs = {};
  FIELD_KEYS.forEach((id) => { inputs[id] = { etiqueta: FIELD_LABELS[id] || '¿Accionista ha reportado vencidos?', valor: id === 'overdue' ? (d[id] === 'si' ? 'Sí' : 'No') : INT_IDS.has(id) ? String(d[id]) : money(d[id]) }; });
  if (kind === 'perfil') return { entradas: inputs };
  const rate = Number(c.rate.toFixed(1));
  const facts = {
    decision: c.band.title, decision_regla: DECISION_BY_BAND[c.band.css], banda: c.band.label, score: c.score,
    monto_solicitado: money(d.requested), monto_sugerido: money(c.suggested), tasa_referencial: `${rate.toFixed(1)}% anual`,
    prob_incumplimiento_ref: `${(c.pd * 100).toFixed(1)}%`,
    limites: { monto_max: c.suggested, tasa_min: Math.max(0, Number((rate - 0.5).toFixed(1))), tasa_max: Number((rate + 2).toFixed(1)) },
    indicadores: c.components.map((k) => ({ nombre: k.name, valor: k.value, estado: ratioLabel(k.ratio)[0], puntos: `${Math.round(k.points)} / ${k.weight}` })),
    senales: c.flags.map((f) => ({ control: f.label, activada: f.hit, detalle: f.detail })),
    entradas: inputs
  };
  const prot = c.ai && c.ai.proteccion && c.ai.proteccion.status === 'ok' ? c.ai.proteccion.data : null;
  if (kind === 'decision' && prot) facts.observaciones_ia = prot.observaciones.map((o) => ({ categoria: o.categoria, severidad: o.severidad, titulo: o.titulo }));
  return facts;
}

const AI_PANEL = { perfil: 1, proteccion: 4, decision: 5 };
const AI_TITLE = { perfil: 'Perfil integrado por IA', proteccion: 'Señales de fraude y personalización con IA', decision: 'Recomendación de la IA' };

function aiSlot(kind) {
  const s = lastCalc && lastCalc.ai && lastCalc.ai[kind];
  if (!s) return '';
  const title = AI_TITLE[kind];
  if (s.status === 'loading') return `<div class="ai-box is-loading" role="status"><div class="ai-head"><b>${title}</b></div><p>La IA está trabajando en esta sección. Lo demás ya es el resultado válido de las reglas.</p></div>`;
  if (s.status === 'error') return `<div class="ai-box is-muted"><div class="ai-head"><b>${title}</b></div><p>${s.unavailable ? 'La IA no está disponible en este servidor' : `No disponible: ${esc(s.error)}`}. Se muestran solo las reglas.</p></div>`;
  const c = lastCalc;
  const tag = `<em class="ai-tag">IA · ${esc(s.data.model)}</em>`;
  const ul = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  const col = (name, items) => (items.length ? `<div><h5>${name}</h5>${ul(items)}</div>` : '');

  if (kind === 'perfil') {
    const p = s.data.perfil;
    const ctx = p.contexto.length
      ? `<h5>Contexto encontrado en el documento</h5><ul class="ai-ctx">${p.contexto.map((x) => `<li><b>${esc(x.dato)}</b><small>«${esc(x.evidencia)}»</small></li>`).join('')}</ul>`
      : `<small class="ai-note">${docMarkdown ? 'No se halló contexto adicional relevante en el documento.' : 'Carga un documento en la fase 01 para integrar también el contexto (sector, garantías, litigios, notas a los estados financieros…).'}</small>`;
    return `<div class="ai-box"><div class="ai-head"><b>${title}</b>${tag}</div><p>${esc(p.comportamiento)}</p>${ctx}<small class="ai-note">Resume los datos de arriba y cita el documento; no cambia ningún valor.</small></div>`;
  }

  if (kind === 'proteccion') {
    const obs = s.data.observaciones;
    const body = obs.length
      ? `<ul class="ai-obs">${obs.map((o) => `<li class="sev-${o.severidad}"><span class="check-tag">${o.categoria === 'fraude' ? 'Posible fraude' : 'Consistencia'} · ${o.severidad}</span><div><b>${esc(o.titulo)}</b><small>${esc(o.detalle)}${o.campos.length ? ` · ${o.campos.map((id) => esc(FIELD_LABELS[id] || id)).join(', ')}` : ''}</small></div></li>`).join('')}</ul>`
      : '<p>Sin señales adicionales a las de las reglas.</p>';
    const p = s.data.personalizacion;
    const pers = p
      ? `<h5>Personalización propuesta</h5><div class="ai-kpis"><div><span>Monto</span><b>${p.monto === null || p.monto === c.suggested ? 'Sin cambio' : money(p.monto)}</b><small>Reglas: ${money(c.suggested)} (tope)</small></div><div><span>Tasa</span><b>${p.tasa === null || p.tasa === Number(c.rate.toFixed(1)) ? 'Sin cambio' : `${p.tasa.toFixed(1)}% anual`}</b><small>Reglas: ${c.rate.toFixed(1)}% anual</small></div></div><p>${esc(p.justificacion)}</p>${p.condiciones.length ? ul(p.condiciones) : ''}${p.fuera_de_tope.length ? `<small class="ai-note">La IA propuso ${p.fuera_de_tope.join(' y ')} fuera de los topes de las reglas; se ignoró.</small>` : ''}`
      : '<small class="ai-note">La IA no propone ajustar el monto ni la tasa de las reglas.</small>';
    return `<div class="ai-box"><div class="ai-head"><b>${title}</b>${tag}</div>${body}${pers}<small class="ai-note">Es una propuesta: el monto y la tasa vigentes son los de las reglas y la IA nunca supera su tope de monto. Verifica cada señal contra el expediente.</small></div>`;
  }

  const d = s.data;
  const m = d.memo;
  const rel = { coincide: 'Coincide con las reglas.', mas_estricta: 'Más estricta que las reglas: revísala antes de decidir.', ajustada: `La IA sugirió «${DECISION_LABELS[d.recomendacion_modelo]}», más permisivo que las reglas; se subió al nivel de las reglas.` }[d.relacion];
  return `<div class="ai-box"><div class="ai-head"><b>${title}</b>${tag}</div>
    <div class="ai-reco rel-${d.relacion}"><small>RECOMENDACIÓN</small><b>${DECISION_LABELS[d.recomendacion]}</b><span>Confianza ${d.confianza} · ${rel}</span></div>
    ${d.motivos.length ? ul(d.motivos) : ''}<h5>Memo para el analista</h5><p>${esc(m.resumen)}</p><div class="ai-cols">${col('Fortalezas', m.fortalezas)}${col('Riesgos', m.riesgos)}${col('Condiciones sugeridas', m.condiciones)}</div>
    <small class="ai-note">La IA recomienda; la decisión es del analista. Su recomendación nunca es más permisiva que la de las reglas, y el score, monto y tasa salen de las reglas.</small></div>`;
}

async function requestAi(kind) {
  const calc = lastCalc;
  if (!calc) return;
  calc.ai = calc.ai || {};
  if (calc.ai[kind]) return;
  calc.ai[kind] = { status: 'loading' };
  refreshAi(kind, calc);
  try {
    calc.ai[kind] = { status: 'ok', data: await callAi(kind, { facts: aiFacts(calc, kind), ...(kind === 'perfil' && docMarkdown ? { markdown: docMarkdown.slice(0, AI_MAX_DOC) } : {}) }) };
  } catch (err) {
    calc.ai[kind] = { status: 'error', error: err.message, unavailable: err.unavailable };
  }
  refreshAi(kind, calc);
  if (kind === 'proteccion') syncViews();
  if (calc === lastCalc) notifyAi(kind, calc.ai[kind]);
}

function refreshAi(kind, calc) {
  const i = AI_PANEL[kind];
  if (calc === lastCalc && i <= unlocked) $(`phaseBody${i}`).innerHTML = phaseHtml(i);
}

/* ---------- Centro de notificaciones: eventos reales de la app (la campana del encabezado) ---------- */
const notifs = [];
let notifSeq = 0;
const NOTIF_ICON = { ok: '✓', info: 'i', warn: '!', error: '×' };
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

function notify(type, title, text = '', go = null) {
  notifs.unshift({ id: ++notifSeq, ts: Date.now(), type, title, text, go, read: false });
  if (notifs.length > 30) notifs.length = 30;
  renderNotifs();
  $('notifLive').textContent = title;   // lo anuncian los lectores de pantalla
}

function renderNotifs() {
  const unread = notifs.filter((n) => !n.read).length;
  const badge = $('notifCount');
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  $('notifBtn').setAttribute('aria-label', unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones');
  $('notifEmpty').hidden = notifs.length > 0;
  $('notifList').innerHTML = notifs.map((n) => `<li class="notif-item ${n.type}${n.read ? '' : ' unread'}"><button type="button" data-notif="${n.id}"><span class="ni" aria-hidden="true">${NOTIF_ICON[n.type]}</span><span class="nt"><b>${esc(n.title)}</b>${n.text ? `<small>${esc(n.text)}</small>` : ''}<time>${hhmm(n.ts)}${n.go ? ' · Ver' : ''}</time></span></button></li>`).join('');
}

function openNotif(id) {
  const n = notifs.find((x) => x.id === id);
  if (!n) return;
  n.read = true;
  renderNotifs();
  closeNotifs(false);
  if (!n.go) return;
  if (n.go.view) { openView(n.go.view); return; }
  openView('simulator');
  if (n.go.phase <= unlocked && !processing) goTo(n.go.phase);
  else showToast('Esa fase ya no está disponible: vuelve a validar los datos');
}

function openNotifs() {
  $('notifPanel').hidden = false;
  $('notifBtn').setAttribute('aria-expanded', 'true');
  const first = $('notifList').querySelector('button') || $('notifReadAll');
  if (first) first.focus();
}
function closeNotifs(returnFocus = true) {
  if ($('notifPanel').hidden) return;
  $('notifPanel').hidden = true;
  $('notifBtn').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('notifBtn').focus();
}

/* Avisos que generan los resultados de la IA (solo si el análisis sigue siendo el mismo) */
function notifyAi(kind, s) {
  if (s.status === 'error') { if (!s.unavailable) notify('warn', `La IA no pudo completar «${AI_TITLE[kind]}»`, s.error); return; }
  if (kind === 'proteccion') {
    const o = s.data.observaciones;
    const fraud = o.filter((x) => x.categoria === 'fraude').length;
    notify(fraud ? 'warn' : o.length ? 'info' : 'ok', 'IA: señales de fraude y consistencia', o.length ? `${o.length} observación(es)${fraud ? `, ${fraud} de posible fraude` : ''}.` : 'Sin señales adicionales a las reglas.', { phase: 4 });
  }
  if (kind === 'decision') {
    const d = s.data;
    notify(d.relacion === 'mas_estricta' ? 'warn' : 'info', `IA recomienda: ${DECISION_LABELS[d.recomendacion]}`, { coincide: 'Coincide con las reglas.', mas_estricta: 'Más estricta que las reglas: revísala.', ajustada: 'Se ajustó al nivel de las reglas (la IA era más permisiva).' }[d.relacion], { phase: 5 });
  }
}

$('notifBtn').addEventListener('click', () => ($('notifPanel').hidden ? openNotifs() : closeNotifs()));
$('notifReadAll').addEventListener('click', () => { notifs.forEach((n) => { n.read = true; }); renderNotifs(); });
$('notifClear').addEventListener('click', () => { notifs.length = 0; renderNotifs(); });
$('notifList').addEventListener('click', (e) => { const b = e.target.closest('[data-notif]'); if (b) openNotif(Number(b.dataset.notif)); });
$('notifList').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = [...$('notifList').querySelectorAll('button')];
  const next = buttons[(buttons.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
  if (next) { e.preventDefault(); next.focus(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNotifs(); });
document.addEventListener('click', (e) => { if (!$('notifPanel').hidden && !e.target.closest('.notif-wrap')) closeNotifs(false); });

/* Paneles de fases 2–6: cabecera y acciones generadas desde `stages` */
for (let i = 1; i <= 5; i += 1) {
  const panel = document.querySelector(`.phase-panel[data-phase="${i}"]`);
  const st = stages[i];
  panel.querySelector('.phase-overline').textContent = st.phase;
  panel.querySelector('.phase-title').textContent = st.title;
  panel.querySelector('.io-in').textContent = st.input;
  panel.querySelector('.io-out').textContent = st.output;
  const next = panel.querySelector('[data-next]');
  if (st.next) next.innerHTML = `${st.next} <span>→</span>`;
}

applyCase('guia');
renderHeader();
fillPanels();
render();
openView('simulator');
notify('info', 'Bienvenido a Banco 4.0', 'Carga un archivo o elige un caso de ejemplo y pulsa «Validar datos y continuar».', { phase: 0 });
