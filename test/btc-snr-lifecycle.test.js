import test from 'node:test';
import assert from 'node:assert/strict';
import { btcEntryBlockReason, lifecycleSignal, resetBtcLifecycleForTests } from '../btc-snr-engine.js';

const baseTime = Date.UTC(2026, 9, 8, 13, 0, 0);
function sell(overrides = {}) {
  return {
    symbol: 'BTCUSD', status: 'ACTIVE', action: 'SELL', side: 'SELL',
    strategy: 'SNR_CLASSICAL', setupId: 'BTC-TEST-SELL',
    confidence: 100, entry: 100, stopLoss: 110,
    target1: 90, target2: 80, target3: 70, target4: 60,
    price: 100, updatedAt: new Date(baseTime).toISOString(), ...overrides
  };
}
const quote = p => ({ status: 'WAIT', action: 'WAIT', price: p, updatedAt: new Date(baseTime + 1000).toISOString() });

test('BTC picture regression: already-consumed TP1 blocks SELL entry outright', () => {
  assert.equal(btcEntryBlockReason({
    action: 'SELL', price: 81943.93, entry: 82681.78,
    stopLoss: 82791.79, target1: 82510.37
  }), 'TP1_ALREADY_REACHED');
  resetBtcLifecycleForTests();
  const s = lifecycleSignal(sell({entry:82681.78,stopLoss:82791.79,target1:82510.37,target2:82283,price:81943.93}), baseTime);
  assert.equal(s.status, 'WAIT');
  assert.equal(s.action, 'WAIT');
  assert.equal(s.entryEligible, false);
});

test('TP1 disables new entry, TP2 closes signal and UI keeps closed result', () => {
  resetBtcLifecycleForTests();
  assert.equal(lifecycleSignal(sell(), baseTime).status, 'ACTIVE');
  const one = lifecycleSignal(quote(90), baseTime + 10000);
  assert.equal(one.status, 'TP1_HIT');
  assert.equal(one.action, 'WAIT');
  assert.equal(one.entryEligible, false);
  assert.deepEqual(one.targetHits.slice(0, 2), [true, false]);
  const two = lifecycleSignal(quote(80), baseTime + 20000);
  assert.equal(two.status, 'CLOSED');
  assert.equal(two.closedReason, 'TP2');
  assert.equal(two.terminalEvent.type, 'TP2');
  assert.deepEqual(two.targetHits.slice(0, 2), [true, true]);
  assert.equal(two.brokerPositionClosed, false);
  const later = lifecycleSignal(quote(99), baseTime + 90000);
  assert.equal(later.status, 'CLOSED');
  assert.equal(later.action, 'WAIT');
  assert.equal(later.terminalEvent.signalId, two.terminalEvent.signalId);
});

test('TP1 then rebound to TP1 closes signal with protected-stop, not old SELL', () => {
  resetBtcLifecycleForTests();
  lifecycleSignal(sell(), baseTime);
  assert.equal(lifecycleSignal(quote(90), baseTime + 10000).status, 'TP1_HIT');
  const exit = lifecycleSignal(quote(95), baseTime + 20000);
  assert.equal(exit.status, 'CLOSED');
  assert.equal(exit.closedReason, 'PROTECTED_STOP');
  assert.equal(exit.entryEligible, false);
});

test('Only TP1 exists: hitting TP1 closes the signal', () => {
  resetBtcLifecycleForTests();
  lifecycleSignal(sell({target2:null,target3:null,target4:null}), baseTime);
  const exit = lifecycleSignal(quote(90), baseTime + 5000);
  assert.equal(exit.status, 'CLOSED');
  assert.equal(exit.closedReason, 'TP1');
});

test('Expired untouched entry closes rather than stay ACTIVE forever', () => {
  resetBtcLifecycleForTests();
  lifecycleSignal(sell(), baseTime);
  const expired = lifecycleSignal(quote(99), baseTime + 305000);
  assert.equal(expired.status, 'CLOSED');
  assert.equal(expired.closedReason, 'EXPIRED');
  assert.equal(expired.action, 'WAIT');
});

test('Invalid live price does not fabricate a target or stop event', () => {
  resetBtcLifecycleForTests();
  lifecycleSignal(sell(), baseTime);
  const noPrice = lifecycleSignal(quote(null), baseTime + 1000);
  assert.equal(noPrice.status, 'ACTIVE');
  assert.deepEqual(noPrice.targetHits, [false,false,false,false]);
});
