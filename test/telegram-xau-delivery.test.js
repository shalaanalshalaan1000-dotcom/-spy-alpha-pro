import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV='test';
const {canSendSignal,targetMessage}=await import('../telegram-xau-bot-v3.js');
const {entryNoticeFresh,withTradeId,terminalMatchesLock}=await import('../telegram-xau-bot-v2.js');

const now=Date.UTC(2026,9,8,0,15,0);
function siteTrade(overrides={}) {
  const signalId='XAU-DELIVERY-SELL';
  return {
    signalId, source:'GOLD_ALPHA_SITE',status:'ACTIVE',side:'SELL',
    entered:true,triggered:true,tradeState:{active:true,signalId,side:'SELL'},
    tradeStyle:'ICT_ONLY_EXTERNAL_LIQUIDITY',
    price:4108,triggerPrice:4110,entry:4110,stopLoss:4113.5,
    target1:4103.515,target2:4099,target3:4095,target4:4090,
    confidence:75,liveFeedFresh:true,degraded:false,quoteAgeMs:1000,
    updatedAt:new Date(now-1000).toISOString(),issuedAtMs:now-10000,
    targetHits:[false,false,false,false],targetHitAt:[null,null,null,null],
    ...overrides
  };
}

test('authoritative fresh site entry is mirrored and includes its signalId',()=>{
  const s=siteTrade();
  assert.equal(canSendSignal(s,now),true);
  assert.match(targetMessage(s),/XAU-DELIVERY-SELL/);
});

test('advisory confidence does not veto a previously confirmed site trade',()=>{
  assert.equal(canSendSignal(siteTrade({confidence:20,signalConfidence:20}),now),true);
});

test('unconfirmed or mismatched trade cannot be mirrored',()=>{
  assert.equal(canSendSignal(siteTrade({status:'WAIT'}),now),false);
  assert.equal(canSendSignal(siteTrade({tradeState:{active:false,signalId:'XAU-DELIVERY-SELL'}}),now),false);
  assert.equal(canSendSignal(siteTrade({tradeState:{active:true,signalId:'OTHER'}}),now),false);
  assert.equal(canSendSignal(siteTrade({triggered:false}),now),false);
});

test('stale quote and consumed target cannot produce an entry',()=>{
  assert.equal(canSendSignal(siteTrade({quoteAgeMs:25000}),now),false);
  assert.equal(canSendSignal(siteTrade({price:4103.4}),now),false);
  assert.equal(canSendSignal(siteTrade({targetHits:[true,false,false,false]}),now),false);
});

test('new entry must be prompt and cannot already have target progress',()=>{
  assert.equal(entryNoticeFresh(siteTrade(),now),true);
  assert.equal(entryNoticeFresh(siteTrade({issuedAtMs:now-61000}),now),false);
  assert.equal(entryNoticeFresh(siteTrade({targetHits:[true,false,false,false]}),now),false);
  assert.equal(entryNoticeFresh(siteTrade({tp1:true}),now),false);
});

test('management and terminal notifications preserve the trade identity',()=>{
  assert.match(withTradeId('TP1 HIT','XAU-DELIVERY-SELL'),/🆔 XAU-DELIVERY-SELL/);
  const s=siteTrade({terminalEvent:{signalId:'XAU-DELIVERY-SELL',closedAtMs:now,outcome:'MANAGED_STOP'}});
  assert.equal(terminalMatchesLock({active:true,key:'XAU-DELIVERY-SELL',startedAtMs:now-30000},s),true);
  assert.equal(terminalMatchesLock({active:true,key:'OTHER',startedAtMs:now-30000},s),false);
});

test('worker does not mark a restored, unannounced trade as delivered',()=>{
  const src=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/adopted restored active trade without replaying entry/);
  assert.match(src,/if\(active&&!tradeLock.active&&!eligibleNewTrade\)/);
  assert.match(src,/suppressed orphan lifecycle alerts: entry not delivered/);
});
