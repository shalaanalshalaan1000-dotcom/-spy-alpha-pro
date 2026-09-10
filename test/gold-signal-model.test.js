import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGoldSignal} from '../gold-signal-model.js';

const minute = 60_000;
const start = Date.UTC(2026, 8, 10, 12, 0, 0);

function bar(index, prices) {
  return prices.map((price, offset) => ({t:start + index * minute + offset * 10_000, p:price}));
}

const risingStructure = [
  ...bar(0, [100, 100.5, 99.8, 100.2]),
  ...bar(1, [100.2, 100.8, 100, 100.5]),
  ...bar(2, [100.5, 101, 100.3, 100.8]),
  ...bar(3, [100.8, 101.2, 100.6, 101]),
  ...bar(4, [101, 101.4, 100.8, 101.2])
];

test('live quote triggers a trend entry before the current minute closes', () => {
  const now=start + 5 * minute + 20_000;
  const model=analyzeGoldSignal(risingStructure,101.4,now);
  assert.equal(model.status,'CANDIDATE');
  assert.equal(model.candidateAction,'BUY');
  assert.equal(model.entry,101.4);
  assert.ok(model.confidence>=70);
});

test('price that has already run beyond the live entry is not chased', () => {
  const now=start + 5 * minute + 20_000;
  const model=analyzeGoldSignal(risingStructure,102.8,now);
  assert.equal(model.status,'WAIT');
  assert.equal(model.candidateAction,'WAIT');
  assert.match(model.reason,/NO CHASE/);
});
