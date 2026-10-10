import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldDolMap } from '../gold-dol-map.js';

test('top-down DOL map only promotes named external references, not raw H1/H4/M15 swings',()=>{
  const source={price:4300,side:'BUY',ict:{levels:{
    h4SwingHigh:4350,h1SwingHigh:4330,m15SwingHigh:4310,
    pwh:4370,pdh:4320,asiaHigh:4315
  },dir15:1}};
  const d=buildGoldDolMap(source);
  assert.deepEqual(d.timeframeHierarchy,['W1','D1','H4','H1','M15','M5']);
  assert.equal(d.byTimeframe.H4[0].targetEligible,false);
  assert.equal(d.byTimeframe.H1[0].targetEligible,false);
  assert.equal(d.m15.direction,'BUY');
  assert.deepEqual(d.targetPreview.map(x=>x.price),[4315,4320,4370]);
  assert.equal(d.nearest.label,'ASIA_HIGH');
  assert.equal(d.primary.label,'PWH');
  assert.equal(d.targetPreview.some(x=>/SWING/.test(x.label)),false);
  assert.equal(d.canOverrideIctGate,false);
});

test('SELL preview contains only lower SSL references sorted outward',()=>{
  const d=buildGoldDolMap({price:4300,side:'SELL',ict:{levels:{
    pwh:4350,pwl:4200,pdl:4270,londonLow:4280,h1SwingLow:4290
  }}});
  assert.deepEqual(d.targetPreview.map(x=>x.label),['LONDON_LOW','PDL','PWL']);
  assert.equal(d.drawSide,'SSL');
  assert.equal(d.primary.label,'PWL');
});

test('no named sources or direction means WAIT, never fabricate a TP',()=>{
  assert.deepEqual(buildGoldDolMap({price:4300,side:'BUY',ict:{levels:{h4SwingHigh:4400}}}).targetPreview,[]);
  const unknown=buildGoldDolMap({price:4300,action:'WAIT',ict:{levels:{pdh:4400}}});
  assert.deepEqual(unknown.targetPreview,[]);
  assert.equal(unknown.drawSide,'WAIT');
  const pending=buildGoldDolMap({price:4300,side:'WAIT',candidateAction:'BUY',ict:{levels:{pdh:4400}}});
  assert.equal(pending.nearest?.label,'PDH');
  assert.equal(buildGoldDolMap({}).dataStatus,'NO_NAMED_LIQUIDITY_LEVELS');
});

test('DOL map is non-mutating and cannot promote an unconfirmed M5 retest to entry',()=>{
  const s={price:4300,side:'BUY',target1:4304,tradeState:{active:true},ict:{
    coreIctEntryReady:false,legSweep:{liquidityClass:'EXTERNAL'},
    m5MssEvent:{mss:true},m5MssRetest:{confirmed:false},
    levels:{pdh:4320}
  }};
  const before=JSON.stringify(s),d=buildGoldDolMap(s);
  assert.equal(d.m5.confirmed,false);
  assert.equal(d.canChangeActiveTargets,false);
  assert.equal(d.advisoryOnly,true);
  assert.equal(JSON.stringify(s),before);
  assert.equal(s.target1,4304);
});

test('duplicate named pools are deduplicated without inventing extra targets',()=>{
  const d=buildGoldDolMap({price:4300,side:'BUY',ict:{levels:{pwh:4320,pdh:4320.05,londonHigh:4310}}});
  assert.deepEqual(d.targetPreview.map(x=>x.price),[4310,4320]);
  assert.equal(d.targetPreview.length,2);
});
