import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBrokerTargetReport, confirmBrokerOpen, createSignal, processSignalLifecycle, signalResponse} from '../gold-trade-lifecycle.js';

const start = Date.UTC(2026, 8, 10, 12, 0, 0);
const buy = (overrides={}) => ({candidateAction:'BUY',side:'BUY',strategy:'TEST',setupId:'buy-a',confidence:80,entry:100,entryLow:99.5,entryHigh:100.5,stopLoss:98,target1:105,target2:107,target3:109,target4:111,riskReward:5.5,...overrides});
const quote = (price, overrides={}) => ({price,bid:price-.1,ask:price+.1,provider:'TEST',t:overrides.t??start,...overrides});
const state = signal => ({signal:signal||null,lastTerminal:null,cooldownUntil:0,blockedSetupIds:[]});
const approved = (model, at=start) => ({allowed:true,decision:'ALLOW',status:'APPROVED',code:'AI_ALLOW',setupId:model.setupId,model:'test-reviewer',reason:'approved',riskFlags:[],reviewedAtMs:at,reviewedAt:new Date(at).toISOString(),expiresAtMs:at+12_000});

test('historical pre-entry stop invalidates and blocks the setup', () => {
  const s=state(createSignal(buy(),start));
  processSignalLifecycle(s,{model:{candidateAction:'WAIT'},quote:quote(100,{t:start+20_000}),observations:[quote(97.9,{t:start+10_000})],now:start+20_000});
  assert.equal(s.signal,null);assert.equal(s.lastTerminal.outcome,'PREENTRY_INVALIDATED');assert.deepEqual(s.blockedSetupIds,['buy-a']);
});

test('entered stop closes as SL', () => {
  const active=createSignal(buy(),start);active.entered=true;active.enteredAtMs=start+1_000;active.lastProcessedAtMs=start+1_000;
  const s=state(active);
  processSignalLifecycle(s,{quote:quote(100,{t:start+20_000}),observations:[quote(97.9,{t:start+10_000})],now:start+20_000});
  assert.equal(s.lastTerminal.outcome,'SL');assert.equal(s.lastTerminal.stopped,true);
});

test('unfilled entry expires at 90 seconds', () => {
  const s=state(createSignal(buy(),start));
  processSignalLifecycle(s,{quote:quote(101,{t:start+90_001}),now:start+90_001});
  assert.equal(s.signal,null);assert.equal(s.lastTerminal.outcome,'ENTRY_EXPIRED');
});

test('observe mode cannot mark an entry', () => {
  const s=state(createSignal(buy(),start));
  processSignalLifecycle(s,{quote:quote(100,{t:start+1_000}),now:start+1_000,execute:false});
  assert.equal(s.signal.entered,false);
});

test('an unapproved legacy signal cannot execute or return an action', () => {
  const model=buy(),q=quote(100,{t:start+1_000}),s=state(createSignal(model,start));
  processSignalLifecycle(s,{model,quote:q,now:start+1_000,execute:true});
  assert.equal(s.signal.entered,false);
  assert.equal(signalResponse(s,model,q,start+1_000,true).action,'WAIT');
});

test('first fresh touch publishes immediately without claiming a broker entry', () => {
  const s=state(),model=buy({structureAt:start}),q=quote(100,{t:start+1_000});
  processSignalLifecycle(s,{model,quote:q,now:start+1_000,execute:false,publish:true,approval:approved(model,start+1_000)});
  assert.equal(s.signal.side,'BUY');
  assert.equal(s.signal.triggered,true);
  assert.equal(s.signal.entered,false);
  assert.equal(signalResponse(s,model,q,start+1_000,true).action,'BUY');
});

test('a fresh candidate cannot publish without an AI approval', () => {
  const s=state(),model=buy({structureAt:start}),q=quote(100,{t:start+1_000});
  const result=processSignalLifecycle(s,{model,quote:q,now:start+1_000,execute:false,publish:true});
  assert.equal(s.signal,null);
  assert.equal(result.rejection,'AI_APPROVAL_REQUIRED');
});

test('an approval for another setup cannot publish the candidate', () => {
  const s=state(),model=buy({structureAt:start}),q=quote(100,{t:start+1_000});
  const approval=approved({...model,setupId:'different'},start+1_000);
  const result=processSignalLifecycle(s,{model,quote:q,now:start+1_000,execute:false,publish:true,approval});
  assert.equal(s.signal,null);
  assert.equal(result.rejection,'AI_APPROVAL_REQUIRED');
});

test('a setup that already passed its entry zone cannot publish on a retrace', () => {
  const s=state(),model=buy({structureAt:start});
  const result=processSignalLifecycle(s,{
    model,
    quote:quote(100,{t:start+2_000}),
    observations:[quote(100.8,{t:start+1_000})],
    now:start+2_000,
    execute:false,
    publish:true
  });
  assert.equal(s.signal,null);
  assert.equal(result.rejection,'MISSED_ENTRY');
  assert.deepEqual(s.blockedSetupIds,['buy-a']);
});

test('a setup whose stop was touched before publication is invalidated', () => {
  const s=state(),model=buy({structureAt:start});
  const result=processSignalLifecycle(s,{
    model,
    quote:quote(100,{t:start+2_000}),
    observations:[quote(97.8,{t:start+1_000})],
    now:start+2_000,
    execute:false,
    publish:true
  });
  assert.equal(s.signal,null);
  assert.equal(result.rejection,'PREENTRY_INVALIDATED');
  assert.deepEqual(s.blockedSetupIds,['buy-a']);
});

test('BUY entry uses ask instead of midpoint', () => {
  const s=state(createSignal(buy(),start));
  const q=quote(100.25,{bid:99.7,ask:100.8,t:start+1_000});
  processSignalLifecycle(s,{quote:q,now:start+1_000,execute:true});
  assert.equal(s.signal.entered,false);assert.equal(signalResponse(s,buy(),q,start+1_000,true).action,'WAIT');
});

test('target progress survives a retrace', () => {
  const active=createSignal(buy(),start);active.entered=true;active.enteredAtMs=start+1_000;active.lastProcessedAtMs=start+1_000;
  const s=state(active);
  processSignalLifecycle(s,{quote:quote(101,{t:start+20_000}),observations:[quote(108,{t:start+10_000})],now:start+20_000});
  assert.deepEqual(s.signal.targetHits,[true,true,false,false]);
});

test('TP4 before a later stop remains TP4', () => {
  const active=createSignal(buy(),start);active.entered=true;active.enteredAtMs=start+1_000;active.lastProcessedAtMs=start+1_000;
  const s=state(active);
  processSignalLifecycle(s,{quote:quote(100,{t:start+30_000}),observations:[quote(111.2,{t:start+10_000}),quote(97.8,{t:start+20_000})],now:start+30_000});
  assert.equal(s.lastTerminal.outcome,'TP4');
});

test('stop before a later TP4 remains SL', () => {
  const active=createSignal(buy(),start);active.entered=true;active.enteredAtMs=start+1_000;active.lastProcessedAtMs=start+1_000;
  const s=state(active);
  processSignalLifecycle(s,{quote:quote(100,{t:start+30_000}),observations:[quote(97.8,{t:start+10_000}),quote(111.2,{t:start+20_000})],now:start+30_000});
  assert.equal(s.lastTerminal.outcome,'SL');
});

test('TP1 reached before entry is a missed setup, not a win', () => {
  const s=state(createSignal(buy(),start));
  processSignalLifecycle(s,{quote:quote(100.8,{t:start+20_000}),observations:[quote(105.2,{t:start+10_000})],now:start+20_000});
  assert.equal(s.lastTerminal.outcome,'MISSED_ENTRY');
});

test('transient opposite setup cannot unblock a stopped setup', () => {
  const s=state();s.blockedSetupIds=['buy-a'];s.cooldownUntil=start+60_000;
  processSignalLifecycle(s,{model:buy({candidateAction:'SELL',side:'SELL',setupId:'sell-a',entryLow:99.5,entryHigh:100.5,stopLoss:102,target1:95,target4:89}),quote:quote(100),now:start,execute:true});
  processSignalLifecycle(s,{model:buy(),quote:quote(100,{t:start+61_000}),now:start+61_000,execute:true});
  assert.equal(s.signal,null);assert.equal(s.blockedSetupIds.includes('buy-a'),true);
});

test('a genuinely new structure can create a new entry after cooldown', () => {
  const s=state();s.blockedSetupIds=['buy-a'];s.cooldownUntil=start+60_000;
  const model=buy({setupId:'buy-b'}),q=quote(100,{t:start+61_000});
  processSignalLifecycle(s,{model,quote:q,now:start+61_000,execute:true,approval:approved(model,start+61_000)});
  assert.equal(s.signal.setupId,'buy-b');assert.equal(s.signal.entered,true);
});

test('SELL entry uses bid and target order is retained', () => {
  const model=buy({candidateAction:'SELL',side:'SELL',setupId:'sell-a',entryLow:99.5,entryHigh:100.5,stopLoss:102,target1:95,target2:93,target3:91,target4:89});
  const s=state(createSignal(model,start,approved(model,start))),q=quote(100.2,{bid:100.0,ask:100.7,t:start+1_000});
  processSignalLifecycle(s,{model,quote:q,now:start+1_000,execute:true});
  assert.equal(s.signal.entered,true);
  processSignalLifecycle(s,{model,quote:quote(92.8,{bid:92.7,ask:92.9,t:start+10_000}),now:start+10_000});
  assert.deepEqual(s.signal.targetHits,[true,true,false,false]);
});

test('MT5 OPEN confirms the matching active signal', () => {
  const s=state(createSignal(buy(),start));
  const active=confirmBrokerOpen(s,{side:'BUY',positionId:'42',entry:100.15,openedAt:new Date(start+2_000).toISOString()},start+2_000);
  assert.equal(active.brokerConfirmed,true);assert.equal(active.brokerPositionId,'42');assert.equal(active.executedPrice,100.15);
});

test('MT5 OPEN with the opposite side cannot claim the signal', () => {
  const s=state(createSignal(buy(),start));
  assert.equal(confirmBrokerOpen(s,{side:'SELL',positionId:'42'},start+2_000),null);
  assert.equal(s.signal.brokerConfirmed,false);
});

test('MT5 UPDATE merges target progress without clearing earlier hits', () => {
  const s=state(createSignal(buy(),start));s.signal.targetHits=[true,false,false,false];
  applyBrokerTargetReport(s,{tp2Hit:true});
  applyBrokerTargetReport(s,{tp1Hit:false,tp3Hit:true});
  assert.deepEqual(s.signal.targetHits,[true,true,true,false]);
});

test('a degraded or stale quote cannot create an executable signal', () => {
  const s=state(),q={...quote(100),degraded:true};
  processSignalLifecycle(s,{model:buy(),quote:q,now:start,execute:true});
  assert.equal(s.signal,null);
});
