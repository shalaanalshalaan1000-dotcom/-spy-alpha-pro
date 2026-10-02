import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewSnapshot, executableEntryPrice, reviewGoldCandidate} from '../gold-ai-reviewer.js';

const start=Date.UTC(2026,8,10,12,0,0);
const model=(overrides={})=>({
  candidateAction:'BUY',side:'BUY',strategy:'TREND_CONTINUATION',setupId:'buy-live-1',structureAt:start,
  confidence:78,entry:100,entryLow:99.5,entryHigh:100.5,stopLoss:98,
  target1:103,target2:105,target3:107,target4:109,riskReward:4.5,reason:'استمرار ترند حي',...overrides
});
const quote=(overrides={})=>({price:100,bid:99.9,ask:100.1,t:start+1_000,provider:'MT5_BROKER',degraded:false,...overrides});

test('review snapshot exposes every deterministic site-rule hard check',()=>{
  const snapshot=buildReviewSnapshot({model:model(),quote:quote(),now:start+1_000,minConfidence:70});
  assert.deepEqual(Object.values(snapshot.hardChecks),[true,true,true,true,true,true,true,true]);
  assert.equal(snapshot.setupId,'buy-live-1');
  assert.equal(snapshot.reviewPhase,'EXECUTION');
  assert.equal(executableEntryPrice('BUY',quote()),100.1);
});

test('approval does not require an external AI key or request',async()=>{
  let called=false;
  const review=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'',fetchImpl:async()=>{called=true;}
  });
  assert.equal(called,false);
  assert.equal(review.required,false);
  assert.equal(review.allowed,true);
  assert.equal(review.code,'SITE_RULE_APPROVED');
  assert.equal(review.model,'GOLD_ALPHA_SITE_RULES');
});

test('a hard-rule failure is denied deterministically',async()=>{
  const review=await reviewGoldCandidate({model:model(),quote:quote({degraded:true}),now:start+1_000});
  assert.equal(review.allowed,false);
  assert.equal(review.code,'SITE_RULE_DENY');
  assert.ok(review.riskFlags.includes('quoteFresh'));
});

test('a valid execution setup creates a short-lived deterministic approval',async()=>{
  const review=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,clock:()=>start+1_100
  });
  assert.equal(review.allowed,true);
  assert.equal(review.decision,'ALLOW');
  assert.equal(review.status,'APPROVED');
  assert.equal(review.expiresAtMs,start+13_100);
});

test('invalid levels remain a denial with explicit risk flags',async()=>{
  const review=await reviewGoldCandidate({
    model:model({stopLoss:101}),quote:quote(),now:start+1_000
  });
  assert.equal(review.allowed,false);
  assert.equal(review.status,'DENIED');
  assert.equal(review.code,'SITE_RULE_DENY');
  assert.ok(review.riskFlags.includes('levelsOrdered'));
});

test('external AI-style arguments cannot override deterministic site rules',async()=>{
  let called=false;
  const review=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'test-key',
    fetchImpl:async()=>{called=true;throw new Error('should not be called');}
  });
  assert.equal(called,false);
  assert.equal(review.allowed,true);
  assert.equal(review.code,'SITE_RULE_APPROVED');
});
