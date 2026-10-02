import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.NODE_ENV='test';
const {canSendSignal}=await import('../telegram-xau-bot-v3.js');
const now=Date.now();
const good={signalId:'test',status:'ACTIVE',entered:true,triggered:true,side:'BUY',price:4300,triggerPrice:4300,entry:4300,stopLoss:4298,target1:4301,target2:4302,target3:4303,target4:4304,quoteAgeMs:100,liveFeedFresh:true,updatedAt:new Date(now).toISOString(),tradeStyle:'ICT_ONLY_EXTERNAL_LIQUIDITY',ict:{legSweep:{name:'pdl',level:4297,liquidityClass:'EXTERNAL'}},agentStack:{agents:{trading:{advisoryReady:true}}}};
test('Telegram rejects invalid, stale, stopped and consumed entries',()=>{
 assert.equal(canSendSignal(good,now),true);
 for(const patch of [{price:null},{entry:0,triggerPrice:0},{target2:4299},{stopLoss:0},{price:4297},{price:4301},{degraded:true},{quoteAgeMs:21000},{updatedAt:'bad'},{status:'CANDIDATE'},{signalId:null},{target1:null}])assert.equal(canSendSignal({...good,...patch},now),false,JSON.stringify(patch));
 assert.equal(canSendSignal({...good,side:'SELL',stopLoss:4302,target1:4299,target2:4298,target3:4297,target4:4296,ict:{legSweep:{name:'pdh',level:4303,liquidityClass:'EXTERNAL'}}},now),true);\n assert.equal(canSendSignal({...good,ict:{legSweep:{name:'localSellSide',level:4297,liquidityClass:'INTERNAL'}}},now),false);
});
const ui=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
const mapper=ui.split('const mapper = `')[1].split('`;')[0];
const ctx=vm.createContext({goldBrowserReading:raw=>({price:raw.price,stale:false}),Date});
vm.runInContext(mapper,ctx);
test('UI never invents entries for a high confidence WAIT candidate',()=>{
 const r=ctx.goldSignalReading({...good,status:'WAIT',entry:null,stopLoss:null,signalConfidence:90}).plan;
 assert.equal(r.locked,false);assert.equal(r.entry,null);assert.equal(r.target1,null);assert.equal(r.serverOwned,true);
});
test('UI follows actual server entry, managed stop and target hits',()=>{
 const r=ctx.goldSignalReading({...good,entry:null,stopLoss:4300.5,targetHits:[true,false,false,false]}).plan;
 assert.equal(r.entry,4300);assert.equal(r.invalidation,4300.5);assert.equal(r.locked,true);assert.equal(r.tp1Hit,true);
 assert.equal(ctx.goldSignalReading({...good,triggerPrice:null,entry:null}).plan.locked,false);
});
let engine=fs.readFileSync(new URL('../gold-site-signal-engine-v7.js',import.meta.url),'utf8');
engine=engine.replace(/^import .*;\n/gm,'').split('const server=http.createServer')[0];
const e=vm.createContext({process:{env:{}},console,Date,Buffer,setTimeout,analyzeGoldSignal:()=>({status:'WAIT'})});
vm.runInContext(engine+'\nthis.state=state;',e);
test('quote timestamps cannot be refreshed by receipt or historical candles',()=>{
 e.ingestQuote({p:[null,{v:{lp:4300,lp_time:(Date.now()-60000)/1000}}]});
 assert.equal(e.freshQuote(e.state.quote),false);
 e.ingestQuote({p:[null,{v:{lp:4300}}]});assert.equal(e.freshQuote(e.state.quote),false);
 e.state.lastLpAt=0;e.ingestTimescale({p:[null,{s1:{s:[{v:[(Date.now()-3600000)/1000,4300,4300,4300,4300]}]}}]});
 assert.equal(e.freshQuote(e.state.quote),false);assert.equal(e.state.quote.degraded,true);
});
test('rapid quotes accumulate samples rather than indefinitely replacing one',()=>{
 e.state.samples=[];const t=Date.now();for(let i=0;i<10;i++)e.recordLive(4300+i,t+i*1000);
 assert.ok(e.state.samples.length>=3);
});
test('zero stop and missing values cannot pass level validation',()=>{
 assert.equal(e.validLevels({...good,candidateAction:'BUY',entryLow:4299.9,entryHigh:4300.1,stopLoss:0}),false);
});


test('session breakout logic only uses completed M15 candles and suppresses stale replay',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const telegramBot=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
 assert.match(enginePatch,/lastClosedM15=completedTimeframeBars\(900000,now\)\.at\(-1\)\|\|null/);
 assert.match(telegramBot,/closedBarIsFresh\(m15,900000,now\)/);
 assert.match(telegramBot,/TELEGRAM_SESSION_ALERT_FRESH_MS\|\|180_000/);
});


test('ICT-only gold setups cannot originate from internal liquidity sweeps',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.doesNotMatch(ictSource,/localSellSide|localBuySide/);
 assert.match(ictSource,/ICT_EXTERNAL_LIQUIDITY_ONLY/);
 assert.match(ictSource,/pwh/);
 assert.match(ictSource,/pwl/);
 assert.match(ictSource,/EXTERNAL_LIQUIDITY_KEYS/);
});

test('confluence wrapper and Telegram require the external ICT contract',()=>{
 const confluenceSource=fs.readFileSync(new URL('../gold-confluence-model.js',import.meta.url),'utf8');
 const telegramV3=fs.readFileSync(new URL('../telegram-xau-bot-v3.js',import.meta.url),'utf8');
 assert.match(confluenceSource,/ICT_ONLY_EXTERNAL_LIQUIDITY/);
 assert.match(confluenceSource,/externalSweepValid/);
 assert.match(confluenceSource,/analyzeIctModel\(samples,rawPrice,now,higherTimeframes\)/);
 assert.match(telegramV3,/ICT_ONLY_EXTERNAL_LIQUIDITY/);
 assert.match(telegramV3,/liquidityClass!=='EXTERNAL'/);
});
