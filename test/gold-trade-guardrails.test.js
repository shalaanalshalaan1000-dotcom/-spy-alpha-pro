import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_GOLD_STOP_DISTANCE_USD, goldStopDistanceCheck, tp1HalfwayPrice,
  halfwayTp1Reached, entryZoneAudit, goldSetupAuditScore
} from '../gold-trade-guardrails.js';

process.env.NODE_ENV='test';
const { halfwayTp1NoticeEligible, halfwayTp1AlertMessage } = await import('../telegram-xau-bot-v2.js');

test('new XAU positions require structural stop within ten USD per ounce, inclusive',()=>{
  assert.equal(MAX_GOLD_STOP_DISTANCE_USD,10);
  assert.equal(goldStopDistanceCheck(4100,4090).allowed,true);
  assert.equal(goldStopDistanceCheck(4100,4089.999).reason,'STOP_DISTANCE_EXCEEDS_10_USD');
  assert.equal(goldStopDistanceCheck(4100,4113.09).allowed,false);
  assert.equal(goldStopDistanceCheck(null,4090).allowed,false);
  assert.equal(goldStopDistanceCheck(4100,4100).allowed,false);
});

test('halfway to TP1 works in both directions without triggering from adverse movement',()=>{
  assert.equal(tp1HalfwayPrice(4100,4120),4110);
  assert.equal(tp1HalfwayPrice(4100,4080),4090);
  assert.equal(halfwayTp1Reached('BUY',4100,4120,4109.99),false);
  assert.equal(halfwayTp1Reached('BUY',4100,4120,4110),true);
  assert.equal(halfwayTp1Reached('SELL',4100,4080,4090),true);
  assert.equal(halfwayTp1Reached('SELL',4100,4080,4090.01),false);
  assert.equal(halfwayTp1Reached('BUY',4100,4080,4090),false);
  assert.equal(halfwayTp1Reached('SELL',4100,4120,4110),false);
});

test('halfway alerts require fresh same-trade confirmed lifecycle and are not retroactive',()=>{
  const now=Date.now(),issued=now-5000;
  const s={signalId:'xau-test',side:'SELL',status:'ACTIVE',entered:true,triggered:true,
    entry:4100,triggerPrice:4100,target1:4080,price:4090,bid:4089.9,ask:4090,
    updatedAt:new Date(now).toISOString(),quoteAgeMs:50,liveFeedFresh:true,
    targetHits:[false,false,false,false],halfwayTp1Hit:true,halfwayTp1AtMs:now-1000};
  assert.equal(halfwayTp1NoticeEligible(s,issued,now),true);
  assert.match(halfwayTp1AlertMessage(s),/50% TO TP1 REACHED/);
  assert.match(halfwayTp1AlertMessage(s),/لا يتم تعديل SL/);
  assert.equal(halfwayTp1NoticeEligible({...s,halfwayTp1AtMs:issued-1},issued,now),false);
  assert.equal(halfwayTp1NoticeEligible({...s,targetHits:[true,false,false,false]},issued,now),false);
  assert.equal(halfwayTp1NoticeEligible({...s,degraded:true},issued,now),false);
  assert.equal(halfwayTp1NoticeEligible({...s,quoteAgeMs:30000},issued,now),false);
  assert.equal(halfwayTp1NoticeEligible({...s,status:'WAIT'},issued,now),false);
  assert.equal(halfwayTp1NoticeEligible({...s,halfwayTp1Hit:false},issued,now),false);
});

test('out-of-POI actual M1 retest fills are explicitly audited without hiding actual price',()=>{
  const audit=entryZoneAudit(4129.725,4130.3,4133.675,4136.185);
  assert.equal(audit.inside,false);
  assert.equal(audit.actualEntry,4129.725);
  assert.equal(audit.status,'EXECUTED_OUTSIDE_PLANNED_POI');
  assert.equal(audit.executionPolicy,'M1_MSS_RETEST_HOLD_NOT_ORIGINAL_POI_RETOUCH');
  assert.equal(entryZoneAudit(4131,4130,4132,4136).inside,true);
});

test('audit score distinguishes target practicality and zone drift but does not gate entry',()=>{
  const ict={legSweep:{liquidityClass:'EXTERNAL'},sequence1:{firstMss:{mss:true,closeT:12345}},hasDisplacement:true,coreIctEntryReady:true};
  const a=goldSetupAuditScore({ict,entry:4120,stopLoss:4125,target1:4110,entryLow:4119.8,entryHigh:4120.2,sessionAllowed:true});
  const b=goldSetupAuditScore({ict,entry:4120,stopLoss:4125,target1:4070,entryLow:4123,entryHigh:4124,sessionAllowed:true});
  assert.ok(a.score>b.score);
  assert.equal(a.calibratedWinProbability,false);
  assert.equal(a.entryGate,false);
  assert.ok(a.score<=100);
});

test('production engine persists one halfway event and hard-rejects wide stops only on new entry',()=>{
  const src=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
  assert.match(src,/halfwayTp1Hit:false/);
  assert.match(src,/halfwayTp1AtMs=now/);
  assert.match(src,/if\(!s\.halfwayTp1Hit&&halfwayTp1Reached/);
  assert.match(src,/goldStopDistanceCheck\(p,sl\)/);
  assert.match(src,/if\(!stopGate\.allowed\)/);
  assert.match(src,/goldSetupAuditScore/);
  assert.match(src,/coreRetestAccepted/);
  assert.doesNotMatch(src,/applyManagement\(s,0,/);
});
