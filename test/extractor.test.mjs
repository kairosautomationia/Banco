// Regresión del extractor por reglas (public/extractor.js): casos reales de estados financieros.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { extract } = createRequire(import.meta.url)('../public/extractor.js');
const values = (md) => extract(md).values;

test('tabla con pipes: ventas de 4 periodos, en orden descendente y ascendente', () => {
  const desc = values('| Concepto | dic-24 | dic-23 | dic-22 | dic-21 |\n| Ventas | 6.337.000 | 7.000.000 | 6.500.000 | 6.300.000 |');
  assert.deepEqual([desc.sales24, desc.sales23, desc.sales22, desc.sales21], [6337000, 7000000, 6500000, 6300000]);
  const asc = values('| Concepto | dic-21 | dic-22 | dic-23 | dic-24 |\n| Ventas | 6.300.000 | 6.500.000 | 7.000.000 | 6.337.000 |');
  assert.deepEqual([asc.sales24, asc.sales23, asc.sales22, asc.sales21], [6337000, 7000000, 6500000, 6300000]);
});

test('un margen o razón NO se confunde con el dato (Margen EBITDA, utilidad neta / ventas)', () => {
  assert.equal(values('| Margen EBITDA | 12,5% |\n| EBITDA | 400.000 |').ebitda, 400000);
  assert.equal(values('| Margen EBITDA | 0,125 |\n| EBITDA | 400.000 |').ebitda, 400000);
  assert.equal(values('| Utilidad neta / ventas | 5,0% |\n| Utilidad neta | 316.850 |').netIncome, 316850);
  assert.equal(values('| Deuda / EBITDA | 2,5x |\n| Deuda en el sistema financiero | 999.922 |').debt, 999922);
  assert.equal(values('| Cobertura de intereses EBITDA | 3,5 |\n| EBITDA | 400.000 |').ebitda, 400000);
});

test('un porcentaje de variación dentro de la fila de ventas no se toma como cifra', () => {
  const v = values('| Ventas | 6.337.000 | (9,5%) | 7.000.000 | 7,7% | 6.500.000 | 6.300.000 |');
  assert.deepEqual([v.sales24, v.sales23, v.sales22, v.sales21], [6337000, 7000000, 6500000, 6300000]);
  assert.equal(values('| Ventas | 6.337.000 | -9,5% |').sales24, 6337000);
});

test('la columna «Nota» (1–2 dígitos antes de las cifras) no desplaza los valores', () => {
  const v = values('| Concepto | Nota | dic-24 | dic-23 |\n| Ventas | 5 | 6.337.000 | 7.000.000 |\n| EBITDA | 6 | 400.000 | 380.000 |\n| Gastos financieros | 12 | 115.000 | 120.000 |');
  assert.deepEqual([v.sales24, v.sales23, v.ebitda, v.finExp], [6337000, 7000000, 400000, 115000]);
});

test('no se descarta un valor pequeño legítimo cuando no hay otras cifras grandes', () => {
  assert.equal(values('| Gastos financieros | 50 |').finExp, 50);
  assert.equal(values('Número de empleados: 38').employees, 38);
  assert.equal(values('Instituciones financieras con deuda: 3').institutions, 3);
});

test('gastos financieros entre paréntesis (presentación contable) se toman en positivo; patrimonio y utilidad conservan su signo', () => {
  const v = values('Gastos financieros: (115,000.00)\nPatrimonio: -150.000\nUtilidad neta | (85.000)');
  assert.equal(v.finExp, 115000);
  assert.equal(v.equity, -150000);
  assert.equal(v.netIncome, -85000);
});

test('formatos de cifra: USD, separadores EN/ES y guiones como cero', () => {
  const v = values('Ventas netas: USD 6,337,000.00\nEBITDA: $ 400.000,50\nEfectivo y equivalentes | -');
  assert.deepEqual([v.sales24, v.ebitda, v.cash], [6337000, 400000.5, 0]);
});

test('no confunde campos parecidos', () => {
  assert.equal(values('Ingresos financieros | 5.000\nVentas | 6.337.000').sales24, 6337000);
  assert.equal(values('Total pasivo y patrimonio | 1.800.000\nPatrimonio | 484.529').equity, 484529);
  assert.equal(values('Cartera vencidos de clientes | 12\nAccionistas con vencidos: Sí').overdue, 'si');
  assert.equal(values('Efectivo generado por operaciones | 1.250.000\nEfectivo y equivalentes de efectivo | 28.128').cash, 28128);
});

test('EBITDA calculado cuando solo hay utilidad operativa y depreciación', () => {
  const r = extract('Utilidad operativa | 300.000\nDepreciación y amortización | 100.000');
  assert.equal(r.values.ebitda, 400000);
});

test('avisa cuando el documento está en miles', () => {
  assert.ok(extract('Cifras en miles de USD\nVentas | 6.337').warnings.some((w) => /miles/.test(w)));
});

test('rendimiento: líneas patológicas y documentos grandes no congelan la página', () => {
  const t = (md) => { const s = Date.now(); extract(md); return Date.now() - s; };
  assert.ok(t(Array.from({ length: 4000 }, (_, i) => `| Concepto ${i} | ${i * 1000} | ${i * 900} |`).join('\n')) < 1500);
  assert.ok(t('Ventas ' + '1 '.repeat(25000)) < 1500);
  assert.ok(t('1.'.repeat(30000)) < 1500);
  assert.ok(t(' '.repeat(50000) + '1') < 1500);
});
