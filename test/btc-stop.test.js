import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { startTracking, sendTrackedTargetHits, isConfirmed } = await import('../btc-telegram-bot.js');
const buy = { action:'BUY', status:'ACTIVE', confidence:80, entry:100, stopLoss:90, target1:110, target2:120, target3:130, target4:140 };
const sell = { ...buy, action:'SELL', stopLoss:110, target1:90, target2:80, target3:70, target4:60 };

test('BUY and SELL stops terminate tracking even when price later reaches all targets', async () => {
  for (const signal of [buy, sell]) {
    const messages = [];
    const send = async (_, body) => messages.push(body.text);
    startTracking(signal, signal.action);
    await sendTrackedTargetHits({price:signal.stopLoss}, send);
    await sendTrackedTargetHits({price:signal.target4}, send);
    await sendTrackedTargetHits({price:signal.stopLoss}, send);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /تم ضرب وقف الخسارة/);
  }
});

test('failed stop delivery remains terminal and retries original stop after rebound', async () => {
  startTracking(buy, 'retry');
  await assert.rejects(sendTrackedTargetHits({price:89}, async () => { throw new Error('offline'); }));
  const messages = [];
  await sendTrackedTargetHits({price:140}, async (_, body) => messages.push(body.text));
  await sendTrackedTargetHits({price:140}, async (_, body) => messages.push(body.text));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /SL HIT/);
  assert.match(messages[0], /89.00/);
});

test('TP1 before SL remains valid but later targets are suppressed', async () => {
  startTracking(buy, 'partial');
  const messages = [];
  const send = async (_, body) => messages.push(body.text);
  for (const price of [110, 90, 140]) await sendTrackedTargetHits({price}, send);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /TP1 HIT/);
  assert.match(messages[1], /SL HIT/);
});

test('missing or invalid prices cause neither false stops nor false targets', async () => {
  for (const signal of [buy, sell]) {
    startTracking(signal, 'invalid');
    const messages = [];
    const send = async (_, body) => messages.push(body.text);
    for (const price of [null, undefined, '', ' ', false, 0, -1, NaN, Infinity]) {
      await sendTrackedTargetHits({price}, send);
      assert.equal(isConfirmed({...signal, stopLoss:price}), false);
    }
    assert.equal(messages.length, 0);
    await sendTrackedTargetHits({price:signal.target4}, send);
    assert.equal(messages.length, 4);
  }
});
