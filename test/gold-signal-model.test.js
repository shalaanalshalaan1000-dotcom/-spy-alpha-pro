import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGoldSignal, bars5m, bars15m} from '../gold-signal-model.js';

const minute = 60_000;
const start = Date.UTC(2026, 8, 10, 12, 0, 0);

function minuteSamples(index, base) {
  return [
    {t:start + index * minute + 5_000, p:base},
    {t:start + index * minute + 20_000, p:base + .12},
    {t:start + index * minute + 35_000, p:base - .05},
    {t:start + index * minute + 50_000, p:base + .08}
  ];
}

const risingStructure = Array.from({length:30}, (_, i) => minuteSamples(i, 100 + i * .10)).flat();

test('aggregates samples into true 5m and 15m structures', () => {
  assert.equal(bars5m(risingStructure).length, 6);
  assert.equal(bars15m(risingStructure).length, 2);
});

test('live quote triggers 5m trend entry without waiting for another 15m close', () => {
  const now=start + 30 * minute + 20_000;
  const model=analyzeGoldSignal(risingStructure,103.25,now);
  assert.equal(model.status,'CANDIDATE');
  assert.equal(model.candidateAction,'BUY');
  assert.equal(model.contextBias,'BUY');
  assert.equal(model.modelTimeframes.context,'15m');
  assert.equal(model.modelTimeframes.execution,'5m');
  assert.ok(model.confidence>=70);
});

test('price that has already run beyond the 5m entry is not chased', () => {
  const now=start + 30 * minute + 20_000;
  const model=analyzeGoldSignal(risingStructure,106.5,now);
  assert.equal(model.status,'WAIT');
  assert.equal(model.candidateAction,'WAIT');
  assert.match(model.reason,/NO CHASE/);
});
