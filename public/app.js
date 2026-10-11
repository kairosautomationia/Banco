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
  ['debt', 'ebitda', 'finExp', 'cash', 'employees', 'equity', 'bbDebt', 'requested'].forEach((id) => { if (d[id] < 0) errors.push(`${FIELD_LABELS[id]} no puede ser negativo`); });
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
  return `<div class="score-block"><div class="score-head"><div><small>SCORE</small><b>${c.score}</b><span>/ 999</span></div><em class="band-pill ${c.band.css}">${c.band.label}</em></div>
    <div class="score-scale" role="img" aria-label="Score ${c.score} de 999. Menor a 600 alto riesgo, 600 a 750 moderado, mayor a 750 bajo"><i class="seg high" style="flex:600"></i><i class="seg mod" style="flex:150"></i><i class="seg low" style="flex:249"></i><span class="pointer" style="left:${Math.min(100, c.score / 999 * 100)}%"></span></div>
    <div class="score-ticks"><span>0</span><span style="left:60.06%">600</span><span style="left:75.08%">750</span><span>999</span></div>
    <div class="score-legend"><span><i class="seg high"></i>Alto &lt; 600</span><span><i class="seg mod"></i>Moderado 600–750</span><span><i class="seg low"></i>Bajo &gt; 750</span></div></div>`;
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
    return `<div class="split"><div><h4 class="body-title">Ventas anuales por periodo</h4><div class="bar-chart four show-all" role="img" aria-label="Ventas por periodo: ${periods.map(([p, v]) => `${p} ${money(v)}`).join(', ')}">${bars}</div><p class="body-note">Variación del último año: <b>${pct(c.yoy)}</b></p></div><div class="fact-grid">${facts}</div></div>`;
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
    return `<div class="kpi-row"><div><span>Monto sugerido</span><b>${money(c.suggested)}</b><small>${c.suggested < d.requested ? `Menor que lo solicitado (${money(d.requested)})` : 'Igual a la deuda solicitada'}</small></div><div><span>Tasa recomendada (ref.)</span><b>${c.rate.toFixed(1)}% anual</b><small>Mayor score, menor tasa</small></div><div><span>Capacidad a 4,5× EBITDA</span><b>${money(c.capacity)}</b><small>Margen adicional sobre la deuda actual</small></div></div><h4 class="body-title">Controles de consistencia <small>${c.flagCount} de ${c.flags.length} activados</small></h4><ul class="check-list">${checks}</ul>`;
  }
  // i === 5
  const weakest = [...c.components].sort((a, b) => a.ratio - b.ratio)[0];
  const strongest = [...c.components].sort((a, b) => b.ratio - a.ratio)[0];
  const items = [
    ['Integración', `Ventas de ${money(d.sales21)} (dic-21) a ${money(d.sales24)} (dic-24); ${d.institutions} institución(es) con deuda; accionistas ${d.overdue === 'si' ? 'con vencidos reportados' : 'sin vencidos reportados'}.`],
    ['Riesgo', `Cobertura ${times(c.cov)} y apalancamiento pro forma ${times(c.lev)}. Más fuerte: ${strongest.name.toLowerCase()}; más débil: ${weakest.name.toLowerCase()} (${Math.round(weakest.points)} / ${weakest.weight} pts).`],
    ['Predicción', `Score ${c.score} / 999 · ${c.band.label.toLowerCase()}. Probabilidad de incumplimiento referencial ${(c.pd * 100).toFixed(1)}%.`],
    ['Protección', `Monto sugerido ${money(c.suggested)} a ${c.rate.toFixed(1)}% anual; ${c.flagCount} de ${c.flags.length} señales de consistencia.`]
  ].map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('');
  return `<div class="final-grid"><div>${scoreBlock(c)}<div class="decision-banner"><span aria-hidden="true">✓</span><div><small>DECISIÓN SUGERIDA</small><h4>${c.band.title}</h4></div></div><p class="decision-copy">${c.band.text}${c.flagCount ? ` ${c.flagCount} señal${c.flagCount > 1 ? 'es' : ''} de consistencia por validar.` : ''}</p></div>
    <div><div class="kpi-row two"><div><span>Monto sugerido</span><b>${money(c.suggested)}</b></div><div><span>Tasa (ref.)</span><b>${c.rate.toFixed(1)}%</b></div></div><h4 class="body-title">Por qué esta recomendación</h4><ol class="explain-list open">${items}</ol></div></div>
    <p class="decision-disclaimer">No es una preaprobación de crédito: según el monto, debe estar cubierto por garantías adicionales. El resultado no considera filtros duros ni de entidades gubernamentales (SRI, IESS, entre otras). El score es una referencia inicial que debe profundizarse con toda la información de análisis.</p>`;
}

/* ---------- Estado y navegación entre fases ---------- */
const MONEY_IDS = INPUT_IDS.filter((id) => id !== 'employees' && id !== 'institutions');
const fmtInt = (n) => (n === '' || n === null || n === undefined || !isFinite(Number(n)) ? '' : `${Number(n) < 0 ? '-' : ''}${grouped.format(Math.abs(Math.round(Number(n))))}`);
const parseField = (id) => {
  const raw = $(id).value.trim();
  if (raw === '') return NaN;
  if (MONEY_IDS.includes(id)) { const digits = raw.replace(/[.,]\d{1,2}$/, '').replace(/[^\d-]/g, ''); return /\d/.test(digits) ? Number(digits) : NaN; }
  return Number(raw);
};
const setField = (id, value) => { $(id).value = MONEY_IDS.includes(id) ? fmtInt(value) : value; };

/* Formato de miles con puntos mientras se escribe, conservando la posición del cursor */
function formatMoneyInput(input) {
  const before = input.value.replace(/[.,]\d{1,2}$/, '');
  const caret = input.selectionStart === null ? before.length : input.selectionStart;
  const digitsLeft = before.slice(0, caret).replace(/[^\d]/g, '').length;
  const negative = before.trim().startsWith('-') && input.id === 'netIncome';
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
    const errors = validate(readInputs());
    if (errors.length) {
      $('formErrors').hidden = false;
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
    if (isComplete()) { $('lastUpdate').textContent = 'ahora'; showToast('Análisis completo: recomendación lista'); }
    else showToast(`Fase ${String(unlocked + 1).padStart(2, '0')} desbloqueada`);
    render();
  }, 650);
}

function resetCase() {
  clearTimeout(timer);
  processing = false;
  unlocked = 0;
  viewPhase = 0;
  lastCalc = null;
  customName = '';
  clearExtractionMarks();
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
  if (hadProgress) showToast('Los datos cambiaron: vuelve a validar para continuar');
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
    $('fraudLiveText').textContent = `#CR-2026-1048 · ${f} / ${lastCalc.flags.length} controles activados${hits ? ` · ${hits}` : ''}`;
  } else {
    $('fraudLiveTitle').textContent = 'Expediente en simulación sin analizar';
    $('fraudLiveText').textContent = '#CR-2026-1048 · Las señales se evalúan en la fase de Protección';
  }
  $('row1048Amount').textContent = $('caseAmount').textContent;
  $('row1048Client').textContent = $('caseClient').textContent;
}

/* ---------- Eventos ---------- */
$('caseSelect').addEventListener('change', (event) => {
  if (event.target.value !== 'custom') { customName = ''; clearExtractionMarks(); applyCase(event.target.value); }
  invalidateAnalysis(event);
});
MONEY_IDS.forEach((id) => $(id).addEventListener('input', () => formatMoneyInput($(id))));
[...INPUT_IDS, 'overdue'].forEach((id) => $(id).addEventListener('input', invalidateAnalysis));
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
document.querySelector('.notification').addEventListener('click', () => showToast('3 notificaciones nuevas'));

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
  FIELD_KEYS.forEach((id) => { const l = $(id).closest('label'); if (l) l.classList.remove('field-extracted', 'field-missing'); });
  $('extractReport').hidden = true;
  $('uploadStatus').hidden = true;
}

function setUploadStatus(kind, text) {
  const el = $('uploadStatus');
  el.hidden = false;
  el.className = `upload-status ${kind}`;
  el.textContent = text;
}

function applyExtraction(result, filename) {
  const { values, evidence, warnings } = result;
  customName = filename;
  FIELD_KEYS.forEach((id) => {
    const label = $(id).closest('label');
    const found = values[id] !== undefined;
    if (found) { if (id === 'overdue') $(id).value = values[id]; else setField(id, values[id]); }
    else if (id !== 'overdue') $(id).value = '';
    label.classList.toggle('field-extracted', found);
    label.classList.toggle('field-missing', !found);
  });
  const found = FIELD_KEYS.filter((id) => values[id] !== undefined);
  const missing = FIELD_KEYS.filter((id) => values[id] === undefined);
  const labelOf = (id) => (id === 'overdue' ? '¿Accionista ha reportado vencidos?' : FIELD_LABELS[id]);
  const show = (id) => (id === 'overdue' ? (values[id] === 'si' ? 'Sí' : 'No') : id === 'employees' || id === 'institutions' ? String(values[id]) : money(values[id]));
  const rows = found.map((id) => `<li><b>${labelOf(id)}</b><span>${show(id)}</span><small>${esc(evidence[id] || '')}</small></li>`).join('');
  const miss = missing.map((id) => `<li class="miss"><b>${labelOf(id)}</b><span>No encontrado</span><small>Complétalo manualmente</small></li>`).join('');
  $('extractReport').hidden = false;
  $('extractReport').innerHTML = `<div class="extract-head"><b>${found.length} de ${FIELD_KEYS.length} campos extraídos de ${esc(filename)}</b>${warnings.map((w) => `<p class="extract-warning">${esc(w)}</p>`).join('')}</div><ul>${rows}${miss}</ul>`;
  $('caseSelect').value = 'custom';
  invalidateAnalysis({ target: { id: 'fileInput' } });
  setUploadStatus(missing.length || warnings.length ? 'warn' : 'ok', missing.length ? `Extracción parcial: faltan ${missing.length} campo(s). Complétalos abajo antes de validar.` : warnings.length ? 'Extracción completa, con una advertencia. Revisa los valores.' : 'Extracción completa. Revisa los valores y valida los datos.');
}

async function handleFile(file) {
  if (!file) return;
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv'].includes(ext)) { setUploadStatus('error', `Formato no admitido (${ext || 'sin extensión'}). Usa PDF, Word, Excel o CSV.`); return; }
  if (file.size > MAX_FILE_BYTES) { setUploadStatus('error', 'El archivo supera 20 MB.'); return; }
  if (!file.size) { setUploadStatus('error', 'El archivo está vacío.'); return; }
  $('dropzone').classList.add('is-busy');
  setUploadStatus('busy', `Leyendo “${file.name}” con OCR… puede tardar hasta un par de minutos.`);
  try {
    const res = await fetch('/api/extract', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    if (!data.markdown || !data.markdown.trim()) throw new Error('El OCR no devolvió texto legible del documento.');
    const result = Extractor.extract(data.markdown);
    if (!Object.keys(result.values).length) throw new Error('No se reconoció ninguno de los 15 campos. Ingresa los datos manualmente o prueba con otro archivo.');
    applyExtraction(result, file.name);
  } catch (err) {
    const offline = err instanceof TypeError || location.protocol === 'file:';
    setUploadStatus('error', offline ? 'No se pudo contactar el servidor local. Inícialo con “node server.js” y abre http://localhost:3000.' : err.message);
  } finally {
    $('dropzone').classList.remove('is-busy');
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
