import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeGoldChartPatterns } from '../gold-chart-patterns.js';

function bars(prices, start=1_700_000_000_000) {
  return prices.map((v,i)=>({t:start+i*900_000,open:v-.13,high:v+.28,low:v-.29,close:v}));
}
const flat=[...Array(40)].map((_,i)=>100+Math.sin(i/3)*.15);
const doubleTop=[...flat,100,102,104,106,108,110,107,104,101,98,101,104,107,109.9,107,104,101,97,96];

test('M15 context requires sufficient completed candles and never authorizes a trade',()=>{
  const insufficient=analyzeGoldChartPatterns({m15:bars([100,99,101])});
  assert.equal(insufficient.status,'INSUFFICIENT_M15_DATA');
  assert.equal(insufficient.primary,null);
  for(const k of ['canOpenTrade','canBlockTrade','canChangeStopOrTargets'])assert.equal(insufficient[k],false);
  assert.equal(insufficient.timeframe,'M15');
  assert.equal(insufficient.executionTimeframe,'M5_MSS_RETEST_HOLD');
  assert.equal(insufficient.m1Role,'OPTIONAL_ENTRY_TIMING_ONLY');
});
test('double top is recognized on closed M15 candle neckline breach, read-only',()=>{
  const data=analyzeGoldChartPatterns({m15:bars(doubleTop),m5:bars(Array(25).fill(100))});
  assert.equal(data.primary?.name,'DOUBLE_TOP');
  assert.equal(data.primary?.side,'SELL');
  assert.equal(data.primary?.stage,'BREAKOUT_CONFIRMED');
  assert.equal(data.primary?.confirmed,true);
  assert.equal(data.advisoryOnly,true);
  assert.equal(data.qualityScoreNotProbability,true);
  assert.equal(data.canOpenTrade,false);
  assert.equal(data.canChangeStopOrTargets,false);
});
test('M1 and M5 cannot override an M15 classical pattern',()=>{
  const m15=bars(doubleTop),baseline=analyzeGoldChartPatterns({m15});
  const oppositeM5=bars(Array(36).fill(0).map((_,i)=>100+i*.5));
  const alternative=analyzeGoldChartPatterns({m15,m5:oppositeM5});
  assert.deepEqual(alternative.primary,baseline.primary);
  assert.equal(alternative.timeframe,'M15');
  assert.equal(alternative.m5ClosedBars,36);
});
test('pattern catalogue and integration remain advisory; ICT gate remains external sweep / M5 MSS / retest',()=>{
  const patterns=fs.readFileSync(new URL('../gold-chart-patterns.js',import.meta.url),'utf8');
  for(const pattern of ['DOUBLE_TOP','DOUBLE_BOTTOM','TRIPLE_TOP','TRIPLE_BOTTOM','HEAD_AND_SHOULDERS',
    'INVERSE_HEAD_AND_SHOULDERS','RISING_WEDGE','FALLING_WEDGE','BULLISH_RECTANGLE','BEARISH_RECTANGLE',
    'BULLISH_PENNANT','BEARISH_PENNANT','BULLISH_FLAG','BEARISH_FLAG','BULLISH_CUP_AND_HANDLE',
    'INVERTED_CUP_AND_HANDLE','ASCENDING_TRIANGLE','DESCENDING_TRIANGLE','SYMMETRICAL_TRIANGLE',
    'SYMMETRICAL_EXPANDING_TRIANGLE'])assert.ok(patterns.includes(pattern),pattern);
  const source=fs.readFileSync(new URL('../gold-confluence-model.js',import.meta.url),'utf8');
  assert.match(source,/chartPatterns:base\.chartPatterns/);
  assert.match(source,/const ictCandidate=Boolean\(ict\?\.status==='CANDIDATE'&&ictSide&&\(externalSweepValid\|\|trendContinuationValid\)\)/);
  const core=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
  assert.match(core,/EXTERNAL_LIQUIDITY_SWEEP -> M5_MSS -> RETEST_HOLD/);
  const ui=fs.readFileSync(new URL('../site-indicator-start.js',import.meta.url),'utf8');
  assert.match(ui,/Chart Patterns — M15 \(قراءة فقط\)/);
  assert.match(ui,/chartPatterns: source\.chartPatterns \|\| null/);
});
