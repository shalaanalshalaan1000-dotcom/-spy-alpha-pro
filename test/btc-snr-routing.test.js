import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBtcSignal, analyzeBtcSnr } from '../btc-snr-engine.js';

test('BTC runtime is SNR-only and has no Laura routing', () => {
  const render = readFileSync(new URL('../render-start.js', import.meta.url), 'utf8');
  const telegram = readFileSync(new URL('../btc-telegram-bot.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../btc-snr-engine.js', import.meta.url), 'utf8');

  assert.equal(typeof getBtcSignal, 'function');
  assert.equal(typeof analyzeBtcSnr, 'function');
  assert.match(engine, /strategy:\s*'SNR_CLASSICAL'/);
  assert.match(engine, /tradeStyle:\s*'SNR_ONLY'/);
  assert.doesNotMatch(render, /Laura|btc-ict-fast|btc-laura/i);
  assert.doesNotMatch(telegram, /Laura|btc-ict-fast|btc-laura/i);
  assert.doesNotMatch(engine, /Laura|btc-ict-fast|btc-laura/i);
});
