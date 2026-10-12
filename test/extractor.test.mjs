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

// ---------- Estados financieros reales y largos ----------
test('ventas: la tabla comparativa de 4 años gana al estado de resultados de 2 años', () => {
  const v = values(`| Concepto | Nota | 2024 | 2023 |
| Ventas netas | 16 | 12.400.000 | 11.200.000 |
| INFORMACIÓN COMPARATIVA | | | |
| Concepto | 2024 | 2023 | 2022 | 2021 |
| Ventas netas | 12.400.000 | 11.200.000 | 10.100.000 | 9.300.000 |`);
  assert.deepEqual([v.sales24, v.sales23, v.sales22, v.sales21], [12400000, 11200000, 10100000, 9300000]);
});

test('ventas: el orden de los años se decide por tabla (una descendente y otra ascendente)', () => {
  const v = values(`| Concepto | 2024 | 2023 |
| Utilidad neta | 1.020.000 | 950.000 |
| Concepto | 2021 | 2022 | 2023 | 2024 |
| Ventas netas | 9.300.000 | 10.100.000 | 11.200.000 | 12.400.000 |
| Utilidad neta | 790.000 | 870.000 | 950.000 | 1.020.000 |`);
  assert.deepEqual([v.sales24, v.sales23, v.sales22, v.sales21], [12400000, 11200000, 10100000, 9300000]);
  assert.equal(v.netIncome, 1020000);   // primera tabla (descendente): el último periodo es el primero
});

test('ventas: no toma filas de «Ventas por región» ni «Ingresos financieros» aunque tengan más columnas', () => {
  const v = values(`| Concepto | 2024 | 2023 |
| Ingresos financieros | 1.000 | 2.000 | 3.000 | 4.000 |
| Ventas por región norte | 1 | 2 | 3 | 4 | 5 |
| Ventas netas | 12.400.000 | 11.200.000 |`);
  assert.deepEqual([v.sales24, v.sales23], [12400000, 11200000]);
  assert.equal(v.sales22, undefined);
});

test('ventas: «Ingresos de actividades ordinarias» (NIIF) se reconoce', () => {
  assert.equal(values('| Ingresos de actividades ordinarias | 18 | 12.400.000 | 11.200.000 |').sales24, 12400000);
});

test('CSV exportado de Excel en español (; y tabulador) se lee igual que una tabla', () => {
  const v = values('Ventas netas;16;12.400.000;11.200.000\nEBITDA;;1.850.000;1.630.000\nGastos financieros;19;(160.000);(150.000)');
  assert.deepEqual([v.sales24, v.sales23, v.ebitda, v.finExp], [12400000, 11200000, 1850000, 160000]);
  assert.equal(values('Patrimonio\t3.900.000\t3.510.000').equity, 3900000);
});

test('deuda: prefiere el total; si solo hay corto y largo plazo, los suma; si hay un solo tramo, avisa', () => {
  assert.equal(values('| Obligaciones financieras a corto plazo | 900.000 |\n| Obligaciones financieras a largo plazo | 1.200.000 |\n| Total obligaciones financieras | 2.100.000 |').debt, 2100000);
  const suma = extract('| Obligaciones financieras a corto plazo | 12 | 900.000 | 850.000 |\n| Obligaciones financieras a largo plazo | 12 | 1.200.000 | 1.100.000 |');
  assert.equal(suma.values.debt, 2100000);
  const uno = extract('| Obligaciones financieras a corto plazo | 900.000 |');
  assert.equal(uno.values.debt, 900000);
  assert.ok(uno.warnings.some((w) => /un solo tramo/.test(w)));
  assert.equal(values('Deuda en el sistema financiero: $ 2.100.000\n| Obligaciones financieras a corto plazo | 900.000 |').debt, 2100000);   // el dato explícito manda
});

test('efectivo: no toma filas del estado de flujos aunque aparezca antes que el balance', () => {
  const v = values(`| Efectivo neto generado por actividades de operación | 1.120.000 |
| Efectivo y equivalentes de efectivo al inicio del periodo | 520.000 |
| Aumento neto de efectivo | 120.000 |
| Efectivo y equivalentes de efectivo | 4 | 640.000 | 520.000 |`);
  assert.equal(v.cash, 640000);
});

test('empleados: se leen de una frase de las notas, pero no de cualquier mención', () => {
  assert.equal(values('Al 31 de diciembre de 2024 la Compañía mantiene 112 empleados (2023: 104).').employees, 112);
  assert.equal(values('La NIIF define como PYME a entidades con menos de 200 empleados.').employees, undefined);
  assert.equal(values('| Número de empleados | 112 | 104 |\nLa Compañía mantiene 50 empleados.').employees, 112);   // la tabla manda sobre la frase
});

test('un dato que no está en el documento queda sin valor (nunca se inventa)', () => {
  const v = values('| Ventas netas | 12.400.000 | 11.200.000 |');
  for (const k of ['institutions', 'overdue', 'bbDebt', 'requested', 'equity', 'cash']) assert.equal(v[k], undefined, k);
});

// ---------- Auditoría independiente: cada caso se reprodujo antes de corregirse ----------
test('un año suelto en una frase no es una cifra', () => {
  const v = values('Ventas netas del año 2024: 6.337.000 frente a 7.000.000 en 2023');
  assert.deepEqual([v.sales24, v.sales23, v.sales22], [6337000, 7000000, undefined]);
  assert.equal(values('EBITDA 2024: 400.000').ebitda, 400000);
  assert.equal(values('| Ventas | 2024 |').sales24, undefined);
});

test('«por acción», «sobre» y otras razones no son el dato', () => {
  assert.equal(values('| Utilidad neta por acción | 0,25 |\n| Utilidad neta | 316.850 |').netIncome, 316850);
  assert.equal(values('| Deuda neta sobre EBITDA | 2,5 |\n| EBITDA | 400.000 |').ebitda, 400000);
  assert.equal(values('| Utilidad neta por acción | 0,25 |').netIncome, undefined);
});

test('el signo: pérdida neta, menos tipográfico, guion largo pegado y menos al final son negativos', () => {
  assert.equal(values('| Pérdida neta | 85.000 |').netIncome, -85000);
  assert.equal(values('| Utilidad neta | −85.000 |').netIncome, -85000);
  assert.equal(values('| Patrimonio | –150.000 |').equity, -150000);
  assert.equal(values('| Patrimonio | 150.000- |').equity, -150000);
  assert.equal(values('Ventas netas – 6.337.000   7.000.000').sales24, 6337000);                  // con espacio detrás, el guion es un separador, no un signo
});

test('columnas numéricas extra sin % (variación, % del total, nota de 3 dígitos) no entran como periodos', () => {
  let v = values('| Ventas | 6.337.000 | 7.000.000 | -9,5 |');
  assert.deepEqual([v.sales24, v.sales23, v.sales22], [6337000, 7000000, undefined]);
  v = values('| Ventas | 6.337.000 | 100 | 7.000.000 | 100 |');
  assert.deepEqual([v.sales24, v.sales23, v.sales22], [6337000, 7000000, undefined]);
  v = values('| Ventas | 105 | 1.300.000 | 1.200.000 |');
  assert.deepEqual([v.sales24, v.sales23], [1300000, 1200000]);
});

test('la nota se descarta también con cifras en miles y en campos enteros', () => {
  assert.equal(values('| Efectivo y equivalentes | 4 | 800 | 700 |').cash, 800);
  assert.equal(values('| Número de empleados | 5 | 112 |').employees, 112);
  assert.equal(values('| Gastos financieros | 20 | 30 |').finExp, 20);       // sin cifras claramente mayores no hay nota que descartar
});

test('patrimonio: gana «Total patrimonio» sobre los subtotales atribuibles', () => {
  assert.equal(values('| Patrimonio atribuible a los propietarios | 400.000 |\n| Participación no controladora | 84.529 |\n| Total patrimonio | 484.529 |').equity, 484529);
  assert.equal(values('| Patrimonio atribuible a los propietarios | 400.000 |').equity, undefined);
});

test('una frase con dos años no cambia el orden de los periodos de las tablas siguientes', () => {
  const v = values('| Concepto | 2024 | 2023 |\n| Ventas | 6.337.000 | 7.000.000 |\nNota: comparativo 2022 y 2023 de la gestión\n| EBITDA | 500.000 | 450.000 |');
  assert.equal(v.ebitda, 500000);
});

test('miles con espacio dentro de una tabla («6 337 000») es una cifra; en texto corrido son dos columnas', () => {
  const v = values('| Ventas | 6 337 000 | 7 000 000 |');
  assert.deepEqual([v.sales24, v.sales23], [6337000, 7000000]);
  assert.equal(values('Efectivo y equivalentes de efectivo   640 520').cash, 640);
});

test('«vencidos»: solo cuenta una respuesta explícita sobre accionistas; manda el riesgo si hay varias', () => {
  assert.equal(values('Cuentas por cobrar vencidos: No\nAccionistas con vencidos: Sí').overdue, 'si');
  assert.equal(values('Accionistas con vencidos: no se dispone de información').overdue, undefined);
  assert.equal(values('Cuentas por cobrar vencidos: No').overdue, undefined);
  assert.equal(values('| ¿Accionista ha reportado vencidos? | No |').overdue, 'no');
  assert.equal(values('Vencidos en la Central de Riesgos: Sí').overdue, 'si');
});

test('efectivo restringido, deuda neta y «3 empleados clave» no se toman como el dato', () => {
  assert.equal(values('| Efectivo restringido | 5.000 |').cash, undefined);
  assert.equal(values('| Deuda neta | 1.000.000 |').debt, undefined);
  assert.equal(values('La gerencia tiene 3 empleados clave en la operación.').employees, undefined);
});

test('avisa de la escala en todas las formas habituales', () => {
  for (const txt of ['Cifras en millones de USD', 'Expresado en dólares (miles)', 'USD miles', 'US$ miles', 'MUSD', 'USD 000', '(Expresado en miles de dólares)', 'Valores en miles']) {
    assert.ok(extract(`${txt}\nVentas | 6,3 |`).warnings.some((w) => /miles o millones/.test(w)), txt);
  }
  assert.equal(extract('Ventas | 6.337.000 |').warnings.some((w) => /miles/.test(w)), false);
});
