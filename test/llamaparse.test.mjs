// Parse API v2 de LlamaParse: forma de la configuración, del estado y del texto devuelto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, jobIdOf, statusOf, isDone, isFailed, markdownOf } from '../llamaparse.mjs';

test('configuración: nivel por defecto barato y override; siempre la versión más reciente', () => {
  assert.deepEqual(JSON.parse(configuration()), { tier: 'cost_effective', version: 'latest' });
  assert.deepEqual(JSON.parse(configuration('agentic')), { tier: 'agentic', version: 'latest' });
});

test('estado e id del trabajo: tolera job.status (v2), status plano y mayúsculas/minúsculas', () => {
  assert.equal(jobIdOf({ id: 'a' }), 'a');
  assert.equal(jobIdOf({ job: { id: 'b' } }), 'b');
  assert.equal(jobIdOf({}), '');
  assert.equal(statusOf({ job: { status: 'Completed' } }), 'COMPLETED');
  assert.equal(statusOf({ status: 'running' }), 'RUNNING');
  assert.equal(statusOf(null), '');
  assert.ok(isDone('COMPLETED') && isDone('SUCCESS') && !isDone('RUNNING'));
  assert.ok(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].every(isFailed) && !isFailed('PENDING'));
});

test('texto del documento: markdown.pages[] unido por páginas, markdown_full, cadena (servidor local) y vacío', () => {
  assert.equal(markdownOf({ markdown: { pages: [{ page_number: 1, markdown: 'uno' }, { page_number: 2, markdown: '' }, { markdown: 'tres' }] } }), 'uno\n\ntres');
  assert.equal(markdownOf({ markdown_full: 'completo' }), 'completo');
  assert.equal(markdownOf({ markdown: 'plano' }), 'plano');
  for (const vacio of [null, undefined, {}, { markdown: {} }, { markdown: { pages: [] } }, 'x']) assert.equal(markdownOf(vacio), '');
});
