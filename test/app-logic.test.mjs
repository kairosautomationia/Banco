// Lógica del navegador (public/app.js) sin navegador: se carga en un entorno aislado con un DOM mínimo.
// Cubre el motor de score (compute), las reglas de validación y la edición de cifras (stripCents).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class El {
  constructor(value = '') { this._v = String(value); this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.className = ''; this.style = { setProperty() {}, removeProperty() {} }; this.dataset = {}; this.open = false; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  addEventListener() {} setAttribute() {} getAttribute() { return null; } removeAttribute() {} closest() { return new El(); } querySelector() { return new El(); } querySelectorAll() { return []; }
  appendChild() {} focus() {} click() {} setSelectionRange() {} scrollIntoView() {}
  get selectionStart() { return 0; }
  get value() { return this._v; }
  set value(v) { this._v = String(v); }   // como un input real: siempre texto
}
const els = new Map();
const document = { getElementById: (id) => { if (!els.has(id)) els.set(id, new El(id === 'caseSelect' ? 'guia' : id === 'overdue' ? 'no' : '')); return els.get(id); }, querySelectorAll: () => [], querySelector: () => new El(), addEventListener() {} };
const ctx = vm.createContext({ document, console, Intl, setTimeout, clearTimeout, AbortController, AbortSignal, location: { protocol: 'http:' }, fetch: async () => { throw new Error('sin red en las pruebas'); } });
for (const f of ['extractor.js', 'app.js']) vm.runInContext(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
const { compute, validate, stripCents, cases } = vm.runInContext('({ compute, validate, stripCents, cases })', ctx);

test('puntuaciones de referencia de los 3 casos de ejemplo (regresión del modelo)', () => {
  const esperado = { guia: [714, 'Riesgo moderado', 400000], andina: [999, 'Bajo riesgo', 500000], delta: [337, 'Alto riesgo', 0] };
  for (const [k, [score, banda, monto]] of Object.entries(esperado)) {
    const c = compute(cases[k]);
    assert.equal(c.score, score, `${k}: score`);
    assert.equal(c.band.label, banda, `${k}: banda`);
    assert.equal(c.suggested, monto, `${k}: monto sugerido`);
  }
});

test('estrés: 20.000 combinaciones extremas (negativos, ceros, 10^12) sin NaN ni valores fuera de rango', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const mag = () => pick([0, 1, 10, 1e3, 5e4, 1e6, 7e6, 1e9, 1e12]);
  for (let i = 0; i < 20000; i++) {
    const d = { sales24: Math.max(1, mag()), sales23: Math.max(1, mag()), sales22: Math.max(1, mag()), sales21: Math.max(1, mag()), debt: mag(), ebitda: pick([-1, 1]) * mag(), finExp: mag(), cash: mag(),
      employees: Math.floor(rnd() * 5000), netIncome: pick([-1, 1]) * mag(), equity: pick([-1, 1]) * mag(), institutions: Math.floor(rnd() * 12), overdue: pick(['si', 'no']), bbDebt: mag(), requested: Math.max(1, mag()) };
    const c = compute(d);
    const donde = JSON.stringify(d);
    assert.ok(Number.isFinite(c.score) && c.score >= 300 && c.score <= 999, `score ${c.score} ${donde}`);
    assert.ok(Number.isFinite(c.suggested) && c.suggested >= 0 && c.suggested <= d.requested, `monto ${c.suggested} ${donde}`);
    assert.ok(Number.isFinite(c.rate) && c.rate >= 8 && c.rate <= 14.01, `tasa ${c.rate}`);
    assert.ok(c.pd >= 0 && c.pd <= 0.5);
    assert.ok(c.components.every((k) => Number.isFinite(k.points) && k.points >= 0 && k.points <= k.weight + 1e-9));
    assert.ok(!c.components.some((k) => /NaN|undefined/.test(String(k.value))) && !c.flags.some((f) => /NaN|undefined/.test(f.detail)), donde);
  }
});

test('validación: EBITDA, patrimonio y utilidad neta pueden ser negativos; deuda, empleados y demás no', () => {
  const base = { sales24: 1, sales23: 1, sales22: 1, sales21: 1, debt: 0, ebitda: 0, finExp: 0, cash: 0, employees: 1, netIncome: 0, equity: 0, institutions: 0, overdue: 'no', bbDebt: 0, requested: 1 };
  const v = (o) => validate({ ...base, ...o });
  assert.equal(v({ ebitda: -50000, equity: -150000, netIncome: -85000 }).length, 0);   // length: los arreglos del entorno aislado tienen otro prototipo
  for (const [campo, mensaje] of [['debt', /Deuda en el sistema financiero/], ['finExp', /Gastos financieros/], ['cash', /Efectivo/], ['bbDebt', /Deuda actual con el banco/]]) assert.match(v({ [campo]: -1 })[0], mensaje);
  assert.match(v({ employees: 3.5 })[0], /entero/);
  assert.match(v({ institutions: -1 })[0], /entero ≥ 0/);
  assert.match(v({ sales21: 0 })[0], /mayor que 0/);
  assert.match(v({ requested: 0 })[0], /mayor que 0/);
  assert.match(v({ debt: NaN })[0], /falta el dato/);
  assert.match(v({ debt: Infinity })[0], /falta el dato/);
});

test('edición de cifras: borrar un dígito no corta el valor por 1.000 (Backspace sobre «1.234» deja «1.23»)', () => {
  // tras borrar un dígito: el texto que queda → lo que debe leerse como dígitos
  const casos = [['1.23', '123'], ['6.337.00', '633700'], ['12.34', '1234'], ['40.00', '4000'], ['99.992', '99992'], ['1.2', '12']];
  for (const [texto, digitos] of casos) assert.equal(stripCents(texto).replace(/\D/g, ''), digitos, texto);
});

test('edición de cifras: los decimales pegados desde Excel (ES y EN) siguen descartándose', () => {
  for (const [pegado, digitos] of [['1234,56', '1234'], ['1.234.567,89', '1234567'], ['1234.56', '1234'], ['1,234,567.89', '1234567'], ['1,234', '1234'], ['12,5', '12'], ['1.234', '1234'], ['1.234.567', '1234567']]) {
    assert.equal(stripCents(pegado).replace(/\D/g, ''), digitos, pegado);
  }
});
