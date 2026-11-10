import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { tp1HalfwayPrice, halfwayTp1Reached } from '../gold-tp1-midpoint.js';
process.env.NODE_ENV='test';
const { halfwayTp1NoticeEligible, halfwayTp1AlertMessage } = await import('../telegram-xau-bot-v2.js');
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


test('actual generated manager emits once at executable midpoint and preserves the plan',()=>{
 const url=new URL('../gold-site-signal-engine-v9.js',import.meta.url);
 let generated='';
 const generator=fs.readFileSync(url,'utf8').replace("import fs from 'node:fs';",'').replaceAll('import.meta.url',JSON.stringify(url.href)).replace(/await import\(`\$\{runtimeUrl.href\}\?v=\$\{Date.now\(\)\}`\);/,'');
 vm.runInNewContext(generator,{URL,fs:{readFileSync:fs.readFileSync,writeFileSync:(_url,value)=>{generated=value;}}});
 const manager=generated.slice(generated.indexOf('function manage(q,now){'),generated.indexOf('function maybeCreate('));
 for(const side of ['BUY','SELL']){
  const sign=side==='BUY'?1:-1;
  const signal={side,entry:4101,triggerPrice:4100,target1:4100+sign*20,target2:null,target3:null,target4:null,stopLoss:4100-sign*10,bestPrice:4100,targetHits:[false,false,false,false],targetHitAt:[null,null,null,null]};
  const state={signal}; let managementCalls=0;
  const ctx={state,freshQuote:q=>!q.stale,exitPx:(side,q)=>side==='BUY'?q.bid:q.ask,stopped:(side,p,stop)=>side==='BUY'?p<=stop:p>=stop,n:v=>v==null?null:Number(v),halfwayTp1Reached,tp1HalfwayPrice,reached:(side,p,t)=>t!=null&&(side==='BUY'?p>=t:p<=t),applyManagement:()=>{managementCalls++},close:()=>assert.fail('midpoint must not close')};
  vm.runInNewContext(manager+';this.manage=manage;',ctx);
  const quote=p=>({bid:side==='BUY'?p:p-.2,ask:side==='SELL'?p:p+.2});
  ctx.manage(quote(4100+sign*9.99),1000);assert.equal(signal.halfwayTp1Hit,undefined);
  ctx.manage({...quote(4100+sign*10),stale:true},1500);assert.equal(signal.halfwayTp1Hit,undefined);
  ctx.manage(quote(4100+sign*10),2000);assert.equal(signal.halfwayTp1Hit,true);assert.equal(signal.halfwayTp1AtMs,2000);
  ctx.manage(quote(4100+sign*11),3000);assert.equal(signal.halfwayTp1AtMs,2000);
  assert.equal(signal.stopLoss,4100-sign*10);assert.equal(signal.target1,4100+sign*20);assert.equal(managementCalls,0);
 }
});

test('delivery retries failures, sends once per announced trade and rejects other trades',async()=>{
 const src=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('async function sendHalfwayTp1('),src.indexOf('async function sendTargetHits('));
 const sent={above:true,key:'trade-a',announcedAtMs:1000,halfwayTp1:false};
 let calls=0,fail=true;
 const ctx={sent,tradeLock:{active:true},signalKey:s=>s.signalId,halfwayTp1NoticeEligible:()=>true,halfwayTp1AlertMessage:()=>'',withTradeId:t=>t,send:async()=>{calls++;if(fail)throw new Error('network failure');},console:{log:()=>{}}};
 vm.runInNewContext(fn+';this.deliver=sendHalfwayTp1;',ctx);
 assert.equal(await ctx.deliver({signalId:'trade-b'},2000),false);assert.equal(calls,0);
 await assert.rejects(ctx.deliver({signalId:'trade-a'},2000),/network failure/);assert.equal(sent.halfwayTp1,false);
 fail=false;assert.equal(await ctx.deliver({signalId:'trade-a'},2000),true);
 assert.equal(await ctx.deliver({signalId:'trade-a'},3000),false);assert.equal(calls,2);
 sent.halfwayTp1=false;sent.above=false;
 assert.equal(await ctx.deliver({signalId:'trade-a'},3000),false);assert.equal(calls,2);
});
