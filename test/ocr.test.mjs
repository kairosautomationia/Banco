import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WAIT_MS, pollDelay } from '../ocr.mjs';

test('el sondeo del OCR cabe en el límite de 50 subpeticiones del plan Free, incluso en el peor caso', () => {
  let elapsed = 0;
  let polls = 0;
  while (elapsed <= MAX_WAIT_MS) { elapsed += pollDelay(polls); polls += 1; }
  assert.ok(polls + 2 <= 45, `${polls} sondeos + subida + resultado`);        // con intervalo fijo de 2 s eran 78
  assert.equal(pollDelay(0), 2000);                                            // un OCR corto sigue respondiendo rápido
  assert.ok(pollDelay(1000) <= 6000);                                          // la espera nunca crece sin límite
});
