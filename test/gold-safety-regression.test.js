import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.NODE_ENV='test';
const {canSendSignal}=await import('../telegram-xau-bot-v3.js');
const {mirrorWindowOpen}=await import('../telegram-xau-bot-v2.js');
const {buildMonth5Context}=await import('../gold-confluence-model.js');
const now=Date.now();
const good={signalId:'test',status:'ACTIVE',entered:true,triggered:true,side:'BUY',confidence:80,price:4300,triggerPrice:4300,entry:4300,stopLoss:4298,target1:4302,target2:4303,target3:4304,target4:4305,quoteAgeMs:100,liveFeedFresh:true,updatedAt:new Date(now).toISOString(),tradeStyle:'ICT_ONLY_EXTERNAL_LIQUIDITY',ict:{legSweep:{name:'pdl',level:4297,liquidityClass:'EXTERNAL'}},agentStack:{agents:{trading:{advisoryReady:true}}}};
good.tradeState={active:true,signalId:'test',side:'BUY',sweptName:'pdl'};
test('Telegram rejects invalid, stale, stopped and consumed entries',()=>{
 assert.equal(canSendSignal(good,now),true);
 for(const patch of [{price:null},{entry:0,triggerPrice:0},{target2:4299},{stopLoss:0},{price:4297},{price:4302},{degraded:true},{quoteAgeMs:21000},{updatedAt:'bad'},{status:'CANDIDATE'},{signalId:null},{target1:null}])assert.equal(canSendSignal({...good,...patch},now),false,JSON.stringify(patch));
 assert.equal(canSendSignal({...good,side:'SELL',stopLoss:4302,target1:4298,target2:4297,target3:4296,target4:4295,tradeState:{...good.tradeState,side:'SELL',sweptName:'pdh'},ict:{legSweep:{name:'pdh',level:4303,liquidityClass:'EXTERNAL'}}},now),true);
 // An authoritative ACTIVE snapshot remains valid if mutable ICT context later changes.
 assert.equal(canSendSignal({...good,ict:{legSweep:{name:'localSellSide',level:4297,liquidityClass:'INTERNAL'}}},now),true);
 assert.equal(canSendSignal({...good,tradeState:{...good.tradeState,side:'SELL'}},now),false);
});

test('Telegram mirrors a recent authoritative ACTIVE trade after worker restart but not a stale one',()=>{
 assert.equal(mirrorWindowOpen({...good,issuedAtMs:now-60_000},now),true);
 assert.equal(mirrorWindowOpen({...good,issuedAtMs:now-11*60_000},now),false);
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

test('UI keeps confirmed trade locked when live quote becomes stale',()=>{
 const stale={...good,degraded:true,liveFeedFresh:false,quoteAgeMs:60000,updatedAt:new Date(now-60000).toISOString()};
 const r=ctx.goldSignalReading(stale);
 assert.equal(r.stale,true);
 assert.equal(r.plan.locked,true);
 assert.equal(r.plan.state,'UP');
 assert.equal(r.plan.feedPaused,true);
 assert.equal(r.plan.signalId,'test');
 assert.equal(r.plan.entry,4300);
 assert.equal(r.plan.target1,4302);
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
 assert.match(telegramV3,/s\?\.tradeState\?\.active===true/);
 assert.match(telegramV3,/validTrendContinuation/);
});


test('gold core entry contract uses external sweep plus M5 MSS retest and keeps confluence advisory',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 const confluenceSource=fs.readFileSync(new URL('../gold-confluence-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/executionGate:'EXTERNAL_SWEEP -> M5_MSS -> M5_RETEST_HOLD'/);
 assert.match(ictSource,/coreIctEntryReady/);
 assert.match(ictSource,/M5_MSS_RETEST_CONFIRMED/);
 assert.match(ictSource,/if\(coreIctEntryReady\)confidence=Math\.max\(75,confidence\)/);
 assert.match(ictSource,/FVG_OB_IFVG_BOS_AND_TIMEFRAME_ALIGNMENT_ARE_CONFLUENCE_ONLY/);
 assert.doesNotMatch(ictSource,/waiting for external sweep \+ shift \+ FVG/);
 assert.match(confluenceSource,/h4SwingHigh/);
 assert.match(confluenceSource,/m15SwingLow/);
 assert.match(confluenceSource,/M5 MSS → retest\/hold; FVG\/OB\/iFVG\/BOS are support only/);
});

test('ICT Month 4 context stays supportive and cannot replace the external sweep gate',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/ICT_MONTH4_LIQUIDITY_BASED_BIAS/);
 assert.match(ictSource,/externalTriggerOnly:true/);
 assert.match(ictSource,/internalCannotStartSetup:true/);
 assert.match(ictSource,/validated:Boolean\(validation\)/);
 assert.match(ictSource,/BULLISH_REJECTION_BLOCK/);
 assert.match(ictSource,/BEARISH_REJECTION_BLOCK/);
 assert.match(ictSource,/month4Bias\.aligned&&month4Bias\.bias===side/);
 assert.doesNotMatch(ictSource,/month4Bias\.aligned&&month4Bias\.bias!==side/);
});


test('ICT Month 5 context stays advisory and exposes quarterly/open-float references',()=>{
 const day=86400000,start=Date.UTC(2025,0,1);
 const makeBars=(count,step,base)=>Array.from({length:count},(_,i)=>{const open=base+i*.8,close=open+.3;return{t:start+i*step,open,high:open+2,low:open-2,close,volume:100+i};});
 const higherTimeframes={D1:makeBars(260,day,4080),W1:makeBars(60,7*day,4080),MN1:makeBars(24,30*day,4080)};
 const ctx=buildMonth5Context({
   price:4300,
   side:'BUY',
   ict:{legSweep:{name:'pdl',level:4297,liquidityClass:'EXTERNAL'},hasShift:true,entryMode:'ORIGIN_FVG_RETEST'},
   higherTimeframes
 });
 assert.equal(ctx.advisoryOnly,true);
 assert.equal(ctx.executionGate,false);
 assert.equal(ctx.confidenceBonus,0);
 assert.equal(ctx.quarterlyShift.ranges.d20.bars,20);
 assert.equal(ctx.quarterlyShift.ranges.d40.bars,40);
 assert.equal(ctx.quarterlyShift.ranges.d60.bars,60);
 assert.equal(ctx.openFloat.ranges.m12.bars,252);
 assert.ok(ctx.openFloat.buyStops.some(x=>x.basis==='OPEN_FLOAT'));
 assert.equal(ctx.institutionalSwing.confirmed,true);
 assert.equal(ctx.intermarket.used,false);
});

test('Month 5 additions cannot become a hidden execution gate',()=>{
 const confluenceSource=fs.readFileSync(new URL('../gold-confluence-model.js',import.meta.url),'utf8');
 const siteSource=fs.readFileSync(new URL('../site-indicator-start.js',import.meta.url),'utf8');
 assert.match(confluenceSource,/ICT_MONTH5_CONTEXT_V1/);
 assert.match(confluenceSource,/advisoryOnly:true/);
 assert.match(confluenceSource,/executionGate:false/);
 assert.match(confluenceSource,/confidenceBonus:0/);
 assert.match(siteSource,/siteMonth5Swing/);
 assert.match(siteSource,/siteMonth5Float/);
 assert.match(siteSource,/siteMonth5Pd/);
 assert.match(siteSource,/siteMonth5Quarterly/);
});

test('timeframe agreement supports confidence but never gates a valid ICT setup',()=>{
 const confluenceSource=fs.readFileSync(new URL('../gold-confluence-model.js',import.meta.url),'utf8');
 assert.match(confluenceSource,/TIMEFRAME_AGREEMENT_SUPPORT_V1/);
 assert.match(confluenceSource,/confidenceBonus/);
 assert.match(confluenceSource,/imageSupport\.confidence\+timeframeAgreement\.confidenceBonus/);
 assert.match(confluenceSource,/opposedFrames/);
 assert.doesNotMatch(confluenceSource,/if\(!topDown\.ready\)return/);
 assert.match(confluenceSource,/Timeframe agreement can add confidence only; disagreement never vetoes/);
});

test('site keeps existing ICT confidence contract and supports closed-session M5 momentum acceptance',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 assert.match(enginePatch,/function sessionContinuationMomentumAccepted/);
 assert.match(enginePatch,/status\|\|''\)\.toUpperCase\(\)==='CLOSED'/);
 assert.match(enginePatch,/prev\.close<=level\+\.10&&first\.close>level\+\.25/);
 assert.match(enginePatch,/prev\.close>=level-\.10&&first\.close<level-\.25/);
 assert.match(enginePatch,/second\.low>level:second\.high<level/);
 assert.match(enginePatch,/M5_MOMENTUM_ACCEPTANCE/);
 assert.match(enginePatch,/!momentumAccepted&&!coreRetestAccepted/);
 assert.match(enginePatch,/Number\(m\.confidence\)<MIN_CONFIDENCE/);
});

test('confirmed core M5 MSS retest can activate without an Origin FVG retouch',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const uiSource=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
 assert.match(enginePatch,/function coreIctRetestExecutionAccepted/);
 assert.match(enginePatch,/ict\?\.coreIctEntryReady/);
 assert.match(enginePatch,/ict\?\.m5MssEvent\?\.mss/);
 assert.match(enginePatch,/retest\?\.confirmed!==true/);
 assert.match(enginePatch,/age>15\*60_000/);
 assert.match(enginePatch,/const held=side==='BUY'\?p>level:p<level/);
 assert.match(enginePatch,/consumed<\.65/);
 assert.match(enginePatch,/entryConfirmation:coreRetestAccepted\?'M5_MSS_RETEST_HOLD'/);
 assert.doesNotMatch(uiSource,/Origin FVG محددة؛ ننتظر رجوع السعر إلى منطقة الدخول/);
 assert.match(uiSource,/FVG\/OB\/iFVG دعم فقط/);
 assert.match(uiSource,/External Sweep → M5 MSS → Retest\/Hold \| FVG\/iFVG\/OB = Confluence/);
});



test('external ICT sweep remains armed through the same trading session instead of resetting after ~72 minutes',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 const uiSource=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
 assert.match(ictSource,/GOLD_EXTERNAL_SWEEP_TTL_MS\|\|12\*60\*60_000/);
 assert.match(ictSource,/recentSweeps\(m1,side,levels,24,m1Lookback\)/);
 assert.match(ictSource,/now-x\.t<=EXTERNAL_SWEEP_TTL_MS/);
 assert.match(ictSource,/EXTERNAL_LIQUIDITY_SWEEP -> WAIT_M5_MSS/);
 assert.match(ictSource,/EXTERNAL_LIQUIDITY_SWEEP -> M5_MSS -> WAIT_RETEST_HOLD/);
 assert.match(ictSource,/sweep retained; waiting for M5 MSS/);
 assert.match(ictSource,/sweep \+ M5 MSS retained; waiting for M5 retest\/hold/);
 assert.match(uiSource,/تم حفظ '\+sweepLabel\+' sweep — ننتظر M5 MSS/);
 assert.match(uiSource,/M5 MSS مؤكد — ننتظر Retest\/Hold/);
});


test('retained external sweep stays eligible for side selection until the configured ICT TTL expires',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/freshSweep=Boolean\(sweep&&now-sweep\.t>=0&&now-sweep\.t<=EXTERNAL_SWEEP_TTL_MS\)/);
 assert.doesNotMatch(ictSource,/freshSweep=Boolean\(sweep&&now-sweep\.t>=0&&now-sweep\.t<=120\*60_000\)/);
 assert.match(ictSource,/executionStage:'ENTRY_READY'/);
 assert.match(ictSource,/externalSweepTtlMinutes:Math\.round\(EXTERNAL_SWEEP_TTL_MS\/60_000\)/);
});

test('USD calendar risk is advisory and cannot suppress a completed gold ICT entry',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 assert.match(enginePatch,/blockEntries:false,advisoryOnly:true,executionGate:false/);
 assert.match(enginePatch,/if\(!state\.signal\)maybeCreate\(model,q,now\);/);
 assert.doesNotMatch(enginePatch,/if\(!state\.signal\)\{if\(newsRisk\.blockEntries\)/);
 assert.match(enginePatch,/site-signal-noai-v73-authoritative-active-through-stale-feed/);
});



test('confirmed XAU lifecycle has one authoritative state across engine agents site and Telegram',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const agentSource=fs.readFileSync(new URL('../gold-agent-orchestrator.js',import.meta.url),'utf8');
 const siteSource=fs.readFileSync(new URL('../site-indicator-start.js',import.meta.url),'utf8');
 const telegramSource=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
 assert.match(enginePatch,/XAU_TRADE_STATE_V1/);
 assert.match(enginePatch,/lifecycle:'CONFIRMED',active:true,status:'ACTIVE'/);
 assert.match(enginePatch,/side==='BUY'\?m\?\.ict\?\.m5MssEvent\?\.priorHigh:m\?\.ict\?\.m5MssEvent\?\.priorLow/);
 assert.match(agentSource,/if \(tradeState\.active\)/);
 assert.match(agentSource,/status: String\(source\.status \|\| ''\)\.toUpperCase\(\) === 'MANAGING' \? 'MANAGING' : 'ACTIVE'/);
 assert.match(agentSource,/ict\?\.m5MssEvent\?\.mss/);
 assert.match(agentSource,/ict\?\.m5MssRetest\?\.confirmed/);
 assert.match(siteSource,/CONFIRMED '\+activeSide\+' • ENTRY ACTIVE/);
 assert.match(siteSource,/ict\?\.m5MssRetest\?\.confirmed/);
 assert.match(siteSource,/CONFIRMED • MANUAL\/TELEGRAM/);
 assert.match(telegramSource,/mirrorWindowOpen\(s,now\)/);
 assert.doesNotMatch(telegramSource,/eligibleNewTrade=!tradeLock\.active&&startedThisRun\(s\)/);
});

test('stale TradingView feed cannot demote an already confirmed XAU trade to WAIT',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const uiSource=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
 assert.match(enginePatch,/if\(state\.signal\)\{persistActiveTradeState\(now\)/);
 assert.match(enginePatch,/ACTIVE_TRADE_DATA_PAUSED/);
 assert.match(enginePatch,/lifecycle:'CONFIRMED',active:true,status:'ACTIVE'/);
 assert.match(enginePatch,/feedState:'STALE'/);
 assert.doesNotMatch(uiSource,/const active=!stale&&Boolean\(raw\?\.signalId\)/);
 assert.match(uiSource,/const active=Boolean\(raw\?\.signalId\)/);
 assert.match(uiSource,/state:active\?\(side==='BUY'\?'UP':'DOWN'\):stale\?'STALE'/);
 assert.match(uiSource,/feedPaused:Boolean\(active&&stale\)/);
 assert.match(uiSource,/ENTRY ACTIVE • DATA PAUSED/);
});

test('authoritative ACTIVE trade state survives worker restart and Render deploy handoff',()=>{
 const enginePatch=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 const telegramSource=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
 assert.match(enginePatch,/XAU_ACTIVE_STATE_V1/);
 assert.match(enginePatch,/GOLD_ACTIVE_TRADE_STATE_PATH/);
 assert.match(enginePatch,/persistActiveTradeState/);
 assert.match(enginePatch,/restoreLocalActiveTradeState/);
 assert.match(enginePatch,/recoverPreviousDeployment/);
 assert.match(enginePatch,/APP_BASE_URL/);
 assert.match(enginePatch,/PREVIOUS_DEPLOYMENT/);
 assert.match(enginePatch,/clearPersistedActiveTradeState/);
 assert.match(enginePatch,/bootGoldEngine/);
 assert.doesNotMatch(telegramSource,/adopted restored active trade without replaying entry/);
 assert.match(telegramSource,/suppressed orphan lifecycle alerts: entry not delivered/);
 assert.match(telegramSource,/await sendTargetHits\(s\)/);
 assert.match(telegramSource,/await sendTradeManagement\(s\)/);
});

test('stale external sweep is invalidated after closed M5 accepts beyond the swept level',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/function sweepStillValid\(m5,side,sweep,atr5\)/);
 assert.match(ictSource,/side==='SELL'\?Number\(b\.close\)>Number\(sweep\.level\)\+tolerance:Number\(b\.close\)<Number\(sweep\.level\)-tolerance/);
 assert.match(ictSource,/sweepStillValid\(m5,side,x,atr5\)/);
});

test('fresh armed M5 external sweep outranks older completed or trend-continuation state while retest is pending',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/const m5Armed=Boolean\(seq5\?\.firstMss\)/);
 assert.match(ictSource,/\(m5Armed\?2200:complete\?1000:0\)/);
 assert.match(ictSource,/const armedReversalWinner=\[buy5Preview,sell5Preview\]/);
 assert.match(ictSource,/\.filter\(x=>x\.freshSweep&&x\.m5Mss\)/);
 assert.match(ictSource,/reversalWinner\?\?armedReversalWinner\?\?\(trendWinner/);
});



test('gold ICT targets use the correct liquidity side: BUY to BSL highs, SELL to SSL lows',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/const requiredLiquiditySide=side==='BUY'\?'BSL':'SSL'/);
 assert.match(ictSource,/directionalPools=pools\.filter\(x=>liquiditySideOf\(x\.label\)===requiredLiquiditySide\)/);
 assert.match(ictSource,/HIGH\|PDH\|PWH\|EQH/);
 assert.match(ictSource,/LOW\|PDL\|PWL\|EQL/);
});
test('gold liquidity targets remain monotonic so valid candidates are not silently rejected',()=>{
 const ictSource=fs.readFileSync(new URL('../gold-ict-swing-model.js',import.meta.url),'utf8');
 assert.match(ictSource,/ordered\.sort\(\(a,b\)=>Math\.abs\(a\.price-entry\)-Math\.abs\(b\.price-entry\)\)/);
 assert.match(ictSource,/primaryAlreadyIncluded/);
 assert.doesNotMatch(ictSource,/const ordered=\[secondary\];\s*if\(Math\.abs\(primary\.price-secondary\.price\)>=1\)ordered\.push\(primary\)/);
});



test('XAU sizing has no hard $10 per-trade cap or max-lot warning',()=>{
 const agentSource=fs.readFileSync(new URL('../gold-agent-orchestrator.js',import.meta.url),'utf8');
 const telegramSource=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
 const engineSource=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
 assert.doesNotMatch(agentSource,/XAU_MAX_RISK_USD/);
 assert.doesNotMatch(telegramSource,/XAU_MAX_RISK_USD/);
 assert.doesNotMatch(engineSource,/XAU_MAX_RISK_USD/);
 assert.match(agentSource,/hardDollarRiskCap: false/);
 assert.match(engineSource,/hardDollarRiskCap:false/);
 assert.doesNotMatch(telegramSource,/أقصى لوت/);
 assert.match(telegramSource,/لا يوجد سقف \$10 مفروض على الصفقة/);
});
