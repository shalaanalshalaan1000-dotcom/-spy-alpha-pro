import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewSnapshot, reviewGoldCandidate} from '../gold-ai-reviewer.js';

const start=Date.UTC(2026,8,10,12,0,0);
const model=(overrides={})=>({
  candidateAction:'BUY',side:'BUY',strategy:'TREND_CONTINUATION',setupId:'buy-live-1',structureAt:start,
  confidence:78,entry:100,entryLow:99.5,entryHigh:100.5,stopLoss:98,
  target1:103,target2:105,target3:107,target4:109,riskReward:4.5,reason:'استمرار ترند حي',...overrides
});
const quote=(overrides={})=>({price:100,bid:99.9,ask:100.1,t:start+1_000,provider:'MT5_BROKER',degraded:false,...overrides});
const response=(review,status='completed')=>({
  ok:true,status:200,
  json:async()=>({status,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(review)}]}]})
});

test('review snapshot exposes every deterministic hard check',()=>{
  const snapshot=buildReviewSnapshot({model:model(),quote:quote(),now:start+1_000,minConfidence:70});
  assert.deepEqual(Object.values(snapshot.hardChecks),[true,true,true,true,true,true,true,true]);
  assert.equal(snapshot.market.executablePrice,100.1);
});

test('missing API key fails closed without making a request',async()=>{
  let called=false;
  const review=await reviewGoldCandidate({model:model(),quote:quote(),now:start+1_000,apiKey:'',fetchImpl:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(review.allowed,false);
  assert.equal(review.code,'NOT_CONFIGURED');
});

test('a hard-rule failure is denied before OpenAI is called',async()=>{
  let called=false;
  const review=await reviewGoldCandidate({model:model(),quote:quote({degraded:true}),now:start+1_000,apiKey:'test-key',fetchImpl:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(review.allowed,false);
  assert.equal(review.code,'HARD_RULE_DENY');
  assert.ok(review.riskFlags.includes('quoteFresh'));
});

test('an explicit structured ALLOW creates a short-lived approval',async()=>{
  let request;
  const review=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'test-key',modelId:'gpt-5.6-luna',clock:()=>start+1_100,
    fetchImpl:async(url,options)=>{request={url,options};return response({decision:'ALLOW',reason:'الشروط متسقة',riskFlags:[]});}
  });
  assert.equal(review.allowed,true);
  assert.equal(review.decision,'ALLOW');
  assert.equal(review.expiresAtMs,start+13_100);
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(request.options.body);
  assert.equal(body.model,'gpt-5.6-luna');
  assert.equal(body.text.format.type,'json_schema');
  assert.equal(body.text.format.strict,true);
});

test('AI denial remains a denial with its stated risk flags',async()=>{
  const review=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'test-key',clock:()=>start+1_100,
    fetchImpl:async()=>response({decision:'DENY',reason:'المخاطرة غير مناسبة',riskFlags:['RISK']})
  });
  assert.equal(review.allowed,false);
  assert.equal(review.status,'DENIED');
  assert.equal(review.code,'AI_DENY');
  assert.deepEqual(review.riskFlags,['RISK']);
});

test('invalid or timed-out AI responses fail closed',async()=>{
  const invalid=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'test-key',
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'not-json'}]}]})})
  });
  const timeout=await reviewGoldCandidate({
    model:model(),quote:quote(),now:start+1_000,apiKey:'test-key',
    fetchImpl:async()=>{const error=new Error('timeout');error.name='TimeoutError';throw error;}
  });
  assert.equal(invalid.code,'INVALID_AI_JSON');
  assert.equal(timeout.code,'OPENAI_TIMEOUT');
  assert.equal(invalid.allowed,false);
  assert.equal(timeout.allowed,false);
});
