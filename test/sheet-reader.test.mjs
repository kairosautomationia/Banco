// Lector de hojas de cálculo (public/sheet-reader.js) + extractor sobre exportaciones tipo EMIS (cifras en miles).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SheetReader = require('../public/sheet-reader.js');
const Extractor = require('../public/extractor.js');
const fx = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const bufferOf = (name) => { const b = fs.readFileSync(fx(name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const skip = typeof DecompressionStream === 'undefined' ? { skip: 'sin DecompressionStream' } : {};

test('xlsx: se lee la hoja a markdown con números sin ambigüedad, fechas ISO y huecos marcados «n.d.»', skip, async () => {
  const md = await SheetReader.xlsxToMarkdown(bufferOf('emis-miles.xlsx'));
  const lines = md.split('\n');
  assert.ok(lines.includes('| Unidades | Miles USD | Miles USD | Miles USD | Miles USD | Miles USD |'));
  assert.ok(lines.includes('| Fecha final del período | 2024-12-31 | 2023-12-31 | 2022-12-31 | 2021-12-31 | 2020-12-31 |'));   // celdas de fecha → ISO
  assert.ok(lines.includes('| Ingresos netos por ventas | 51250.75 | 48900.1 | 46100 | 43800 | 40200 |'));
  assert.ok(lines.includes('| Pasivos corrientes por impuesto a la renta | n.d. | n.d. | n.d. | 80 | 70 |'));       // huecos del inicio, sin desalinear
  assert.ok(lines.includes('| Gastos administrativos | -2000 | -1900 | -1800 |'));                                    // huecos del final, descartados
  assert.ok(!/<|&amp;|undefined|NaN/.test(md));
});

test('exportación EMIS en miles de USD: las 10 cifras salen exactas y en USD completos, con evidencia y aviso de escala', skip, async () => {
  const truth = JSON.parse(fs.readFileSync(fx('emis-miles.truth.json'), 'utf8'));
  const r = Extractor.extract(await SheetReader.xlsxToMarkdown(bufferOf('emis-miles.xlsx')));
  assert.deepEqual(r.values, truth);
  assert.equal(r.scale, 1000);
  assert.match(r.evidence.sales24, /Ingresos netos por ventas.*×1\.000/);                      // la fila (no «Total Ingreso Operativo») y la escala aplicada
  assert.match(r.evidence.debt, /^Calculado: Créditos y préstamos no corrientes \+ Créditos y préstamos corrientes \+ Deudas por Emisión de Bonos/);
  assert.ok(r.warnings.some((w) => /miles.*×1\.000/.test(w)));
  assert.ok(r.warnings.some((w) => /deuda se calculó/.test(w)));
  assert.ok(!r.warnings.some((w) => /verifica la escala/.test(w)));                          // la escala está resuelta: no se pide verificarla
  assert.equal(r.values.equity, 10000000);                                                   // «Total de patrimonio», no «…y pasivos» ni el atribuible
});

test('un 0 en la primera columna es un valor, no un número de nota (antes se descartaba y se leía el año anterior)', () => {
  const md = '| Estado | 2024 | 2023 | 2022 |\n| Créditos y préstamos no corrientes | 0 | 19960.05 | 7726.77 |\n| Créditos y préstamos corrientes | 0 | 1544.12 | 8886.97 |\n| Deudas por Emisión de Bonos | 85130.54 | 49629.95 | 43777.24 |';
  assert.equal(Extractor.extract(md).values.debt, 85130.54);
});

test('periodo más reciente vacío («n.d.»): no se toma el año anterior como si fuera el último', () => {
  const md = '| Estado de Resultados | 2024 | 2023 | 2022 |\n| Ganancia (Pérdida) Neta | n.d. | 20489.5 | 21800.3 |\n| EBITDA | 100 | 90 | 80 |';
  const r = Extractor.extract(md);
  assert.equal(r.values.netIncome, undefined);
  assert.equal(r.values.ebitda, 100);
});

test('la escala solo se aplica con una fila «Unidades» uniforme; «Unidades originales…» y el texto suelto «en miles» solo avisan', () => {
  const sin = '| Unidades originales como se reportó | 1 USD | USD Miles |\n| EBITDA | 100 | 90 |';
  const a = Extractor.extract(sin);
  assert.equal(a.values.ebitda, 100); assert.equal(a.scale, 1);
  const mixta = '| Unidades | Miles USD | USD |\n| EBITDA | 100 | 90 |';
  assert.equal(Extractor.extract(mixta).values.ebitda, 100);
  const texto = Extractor.extract('Cifras en miles de dólares\n| EBITDA | 100 | 90 |');
  assert.equal(texto.values.ebitda, 100);
  assert.ok(texto.warnings.some((w) => /verifica la escala/.test(w)));
  const millones = Extractor.extract('| Unidades | Millones USD |\n| EBITDA | 2,5 |');
  assert.equal(millones.values.ebitda, 2500000);
  assert.equal(Extractor.extract('| Unidades | Miles USD |\n| Número de empleados | 112 |').values.employees, 112);   // empleados no se escala
});

test('csv: detecta ; , y tabulación, respeta comillas y BOM, y decodifica Windows-1252', () => {
  assert.equal(SheetReader.csvToMarkdown('﻿Concepto;2024;2023\nVentas;6.337.000;7.000.000\n'), '| Concepto | 2024 | 2023 |\n| Ventas | 6.337.000 | 7.000.000 |');
  assert.equal(SheetReader.csvToMarkdown('Concepto,2024\n"Ventas, netas","6,337,000"\n"Dice ""hola"""\n'), '| Concepto | 2024 |\n| Ventas, netas | 6,337,000 |\n| Dice "hola" |');
  assert.equal(SheetReader.csvToMarkdown('a\tb\n\n1\t\t3'), '| a | b |\n| 1 | n.d. | 3 |');
  assert.equal(SheetReader.csvToMarkdown(''), '');
  assert.equal(SheetReader.decodeCsv(new Uint8Array([0x4d, 0x61, 0x72, 0x7a, 0x6f, 0x20, 0xf1]).buffer), 'Marzo ñ');   // Windows-1252, no UTF-8
  assert.equal(SheetReader.decodeCsv(new TextEncoder().encode('Ñandú').buffer), 'Ñandú');
});

test('csv real de los fixtures: se extraen las cifras igual que por OCR', () => {
  const buf = fs.readFileSync(fx('estados-financieros.csv'));
  const truth = JSON.parse(fs.readFileSync(fx('ground-truth.json'), 'utf8'));
  const r = Extractor.extract(SheetReader.csvToMarkdown(SheetReader.decodeCsv(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))));
  for (const k of ['sales24', 'sales23', 'sales22', 'sales21', 'ebitda', 'cash', 'netIncome', 'equity', 'debt']) assert.equal(r.values[k], truth[k], k);
});

test('archivos dañados o que no son xlsx fallan con un error claro (la app sigue con el OCR)', skip, async () => {
  await assert.rejects(SheetReader.xlsxToMarkdown(new TextEncoder().encode('esto no es un zip').buffer), /no parece un Excel/);
  const recortado = bufferOf('emis-miles.xlsx').slice(0, 300);
  await assert.rejects(SheetReader.xlsxToMarkdown(recortado));
  await assert.rejects(SheetReader.xlsxToMarkdown(bufferOf('estados-financieros.pdf')), /no parece un Excel/);
});

test('xlsx de los fixtures (el que se prueba por OCR) también se lee en local con las cifras correctas', skip, async () => {
  const truth = JSON.parse(fs.readFileSync(fx('ground-truth.json'), 'utf8'));
  const r = Extractor.extract(await SheetReader.xlsxToMarkdown(bufferOf('estados-financieros.xlsx')));
  for (const k of ['sales24', 'sales23', 'sales22', 'sales21', 'ebitda', 'cash', 'netIncome', 'equity', 'debt']) assert.equal(r.values[k], truth[k], k);
});
