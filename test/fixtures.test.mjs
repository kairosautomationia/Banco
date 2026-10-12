// Estados financieros sintéticos de más de 24 KB (Distribuidora Andina S.A., cifras inventadas): PDF, DOCX, XLSX y CSV
// renderizados como texto/tablas. Mide la extracción campo por campo contra la verdad conocida.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { extract } = createRequire(import.meta.url)('../public/extractor.js');
const dir = new URL('./fixtures/', import.meta.url);
const truth = JSON.parse(fs.readFileSync(new URL('ground-truth.json', dir), 'utf8'));
const read = (f) => fs.readFileSync(new URL(f, dir), 'utf8').replace(/^﻿/, '');
const csvAsTable = (t) => t.split('\n').map((l) => (l.trim() ? `| ${l.split(';').join(' | ')} |` : '')).join('\n');

const docs = {
  'PDF (texto con columnas)': read('golden/pdf-layout.txt'),
  'DOCX (tablas)': read('golden/docx-pipes.md'),
  'XLSX (hojas)': read('golden/xlsx-shown.md'),
  'CSV crudo con ;': read('estados-financieros.csv'),
  'CSV como tabla': csvAsTable(read('estados-financieros.csv'))
};
const SOLO_ESTADOS = ['sales24', 'sales23', 'sales22', 'sales21', 'debt', 'ebitda', 'finExp', 'cash', 'netIncome', 'equity'];

for (const [name, md] of Object.entries(docs)) {
  test(`${name} (${(md.length / 1024).toFixed(0)} KB): extrae los 15 campos exactos`, () => {
    const t = Date.now();
    const v = extract(md).values;
    assert.ok(Date.now() - t < 1500, 'debe ser instantáneo');
    assert.ok(md.length > 24 * 1024, 'el archivo supera 24 KB');
    for (const [k, expected] of Object.entries(truth)) assert.equal(v[k], expected, k);
  });

  test(`${name}: sin la solicitud, lo que encuentra es correcto (nunca un dato equivocado)`, () => {
    const cut = md.search(/ESTADO DE SITUACI|## Balance/);
    const v = extract(cut > 0 ? md.slice(cut) : md).values;
    for (const k of SOLO_ESTADOS) assert.equal(v[k], truth[k], `${k} debe estar y ser correcto`);
    for (const [k, got] of Object.entries(v)) assert.equal(got, truth[k], `${k}: si se extrae, debe ser exacto`);
  });
}
