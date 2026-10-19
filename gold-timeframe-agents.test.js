import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldTimeframeAgents } from './gold-timeframe-agents.js';

test('agents fail closed when candle history is missing', () => {
  const result = buildGoldTimeframeAgents({}, Date.now());
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.canCreateSignal, false);
  for (const tf of ['H4','H1','M30','M15','M1']) {
    assert.equal(result.timeframes[tf].status, 'INSUFFICIENT_DATA');
    assert.equal(result.timeframes[tf].mss.status, 'UNKNOWN');
  }
});

test('each timeframe agent reports its own candle count', () => {
  const now = Date.now();
  const candles = [];
  for (let i=180;i>=0;i--) {
    const t = now - i*60_000;
    const close = 4200 + Math.sin(i/4)*3 + (180-i)*0.015;
    candles.push({t,open:close-0.2,high:close+0.6,low:close-0.7,close,closed:true});
  }
  const result = buildGoldTimeframeAgents({timeframeCandles:{M1:candles}}, now);
  assert.equal(result.timeframes.M1.barsAvailable, 181);
  assert.ok(result.timeframes.M15.barsAvailable >= 8);
  assert.ok(result.timeframes.M30.barsAvailable >= 8);
  assert.ok(result.timeframes.H1.barsAvailable >= 3);
  assert.equal(result.canChangeTradeGate, false);
});

test('a confirmed MSS includes direction and the broken swing level', () => {
  const now = Date.now();
  const closes = [100,101,102,101,100,99,100,101,106,105,104,103,102,103,104,105,104,103,102,101,100];
  const candles = closes.map((close,i)=>({t:now-(closes.length-i)*60_000,open:close-0.1,high:close+0.8,low:close-0.8,close,closed:true}));
  const result = buildGoldTimeframeAgents({timeframeCandles:{M1:candles}}, now);
  const mss = result.timeframes.M1.mss;
  assert.ok(['CONFIRMED','NONE'].includes(mss.status));
  if (mss.status === 'CONFIRMED') {
    assert.ok(['BULLISH','BEARISH'].includes(mss.direction));
    assert.ok(Number.isFinite(Number(mss.brokenSwing)));
  }
});
