import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBtcDolMap, projectBtcDolSide } from '../btc-dol-map.js';

const DAY=86400000,start=Date.UTC(2026,9,1),now=Date.UTC(2026,9,14,12);
const D1=Array.from({length:13},(_,i)=>({
  t:start+i*DAY,open:1000,close:1000,
  high:i===12?1040:1020+i*8,
  low:i===12?980:900+i*2
}));
const map=overrides=>buildBtcDolMap({D1,price:1000,now,...overrides});

test('BTC previous full Monday-Sunday UTC week and prior complete day are external references',()=>{
  const d=map();
  assert.equal(d.model,'BTC_ICT_MULTI_TIMEFRAME_DOL_V1');
  assert.equal(d.byTimeframe.W1.find(x=>x.label==='PWH').level,1100);
  assert.equal(d.byTimeframe.W1.find(x=>x.label==='PWL').level,908);
  assert.equal(d.byTimeframe.D1.find(x=>x.label==='PDH').level,1040);
  assert.equal(d.byTimeframe.D1.find(x=>x.label==='PDL').level,980);
  assert.deepEqual(d.timeframeHierarchy,['W1','D1','SESSION','H4','H1','M15','M5']);
  assert.equal(d.executionStrategy,'ICT_ONLY_EXTERNAL_LIQUIDITY');
});

test('BUY and SELL maps independently draw to correct side without opening a BTC signal',()=>{
  const base=map(),buy=projectBtcDolSide(base,'BUY',1000),sell=projectBtcDolSide(base,'SELL',1000);
  assert.equal(buy.nearest.label,'PDH');
  assert.equal(buy.primary.label,'PWH');
  assert.deepEqual(buy.targetPreview.map(x=>x.label),['PDH','PWH']);
  assert.deepEqual(sell.targetPreview.map(x=>x.label),['PDL','PWL']);
  assert.equal(sell.primary.label,'PWL');
  assert.equal(base.drawSide,'WAIT');
  assert.equal(buy.canOpenTrade,false);
  assert.equal(sell.canChangeActiveTargets,false);
});

test('partial week does not promote an old or incomplete week to DOL',()=>{
  const insufficient=map({D1:D1.filter(x=>x.t!==Date.UTC(2026,9,9))});
  assert.equal(insufficient.byTimeframe.W1.length,0);
  assert.equal(insufficient.byTimeframe.D1.length,2);
  const gapYesterday=map({D1:D1.filter(x=>x.t!==Date.UTC(2026,9,13))});
  assert.equal(gapYesterday.byTimeframe.D1.length,0);
  assert.equal(gapYesterday.byTimeframe.W1.length,2);
});

test('H4/H1 confirmed pivots remain unverified context and never enter external DOL TP previews',()=>{
  const h1=[1000,1020,1040,1025,1010,1000,1020].map((high,i)=>({t:Date.UTC(2026,9,14,i),high,low:high-20,close:high-7,open:high-8}));
  const h4=[1000,1020,1060,1025,1010,1000,1020].map((high,i)=>({t:Date.UTC(2026,9,13,8)+i*14400000,high,low:high-20,close:high-7,open:high-8}));
  const d=map({H1:h1,H4:h4});
  for(const tf of ['H1','H4'])for(const row of d.byTimeframe[tf]){
    assert.equal(row.targetEligible,false);
    assert.equal(row.liquidityClass,'UNVERIFIED_SWING');
  }
  assert.equal(d.levels.some(x=>x.label==='H1_SWING_HIGH'),true);
  assert.equal(projectBtcDolSide(d,'BUY',1000).targetPreview.every(x=>['W1','D1'].includes(x.timeframe)),true);
});

test('M15 is context only, BTC ICT M5/M1 confirmation unchanged and NO ICT MSS imposed',()=>{
  const M15=[{t:now-2700000,close:1000,high:1010,low:990},{t:now-1800000,close:1005,high:1015,low:995},{t:now-900000,close:1010,high:1020,low:1000}];
  const d=map({M15});
  assert.equal(d.m15.direction,'BUY');
  assert.equal(d.m5.mssRequired,true);
  assert.match(d.m5.confirmation,/M5_MSS_DISPLACEMENT_PLUS_LATER_M5_RETEST_HOLD/);
  const engine=readFileSync(new URL('../btc-ict-engine.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../render-start.js',import.meta.url),'utf8');
  assert.match(engine,/tradeStyle:'ICT_ONLY_EXTERNAL_LIQUIDITY'/);
  assert.match(engine,/lifecycleSignal\(candidate\)/);
  assert.match(ui,/btcDolW1/);
  assert.match(ui,/btcDolTargets/);
  assert.doesNotMatch(engine,/Laura/);
});

test('incomplete DOL data must not invent targets and map must not mutate existing ICT plan',()=>{
  const original={entry:1000,stopLoss:970,target1:1045,target2:1055,side:'BUY'};
  const copy=JSON.stringify(original);
  const empty=buildBtcDolMap({price:1000,now});
  assert.equal(empty.status,'NO_CONFIRMED_EXTERNAL_REFERENCES');
  assert.deepEqual(projectBtcDolSide(empty,'BUY',1000).targetPreview,[]);
  projectBtcDolSide(map(),original.side,original.entry);
  assert.equal(JSON.stringify(original),copy);
});
