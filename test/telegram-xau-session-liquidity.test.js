import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.TELEGRAM_FRIDAY_PRIMARY_MAX_DISTANCE_USD='25';

const {sessionTradeTargets,sessionLiquidityTargets,sessionRetestMessage,sessionReversalSetupMessage,sessionIctReversalGate,sessionIctContinuationGate,sessionMomentumArm,sessionMomentumAcceptance,sessionExecutionWatchMessage,sessionEarlyExitMessage}=await import('../telegram-xau-bot-v2.js');

const friday=Date.parse('2026-10-02T18:00:00Z');
const thursday=Date.parse('2026-10-01T18:00:00Z');

test('nearest closed-session external liquidity becomes Secondary and next becomes strategic Primary',()=>{
  const rows=[
    {id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715},
    {id:'LONDON',label:'LONDON',status:'CLOSED',high:4152.000,low:4138.000},
    {id:'NEW_YORK',label:'NEW YORK',status:'CLOSED',high:4166.000,low:4140.000}
  ];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,friday);
  assert.equal(t.secondary?.level,4152);
  assert.equal(t.primary?.level,4166);
  assert.equal(t.runner?.level,4192.280);
  assert.equal(t.primaryFiltered,false);

  const msg=sessionReversalSetupMessage(
    rows[0],
    'LOW',
    {open:4142.8,high:4144,low:4141.8,close:4143.225},
    {level:4133.715,reversalTrigger:4142.915,sweepExtreme:4133.427},
    rows,
    friday
  );
  assert.match(msg,/TP1 — Secondary BSL: 4152\.000/);
  assert.match(msg,/TP2 — Primary BSL: 4166\.000/);
  assert.match(msg,/Runner — External BSL: 4192\.280/);
  assert.match(msg,/BUY يستهدف BSL وSELL يستهدف SSL/);
  assert.match(msg,/Execution gate ثابت: External Liquidity Sweep → M5 MSS → Retest\/Hold → Entry/);
  assert.match(msg,/confluence only/);
});

test('Friday does not present a far-only external level as Primary',()=>{
  const rows=[{id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715}];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,friday);
  assert.equal(t.primary,null);
  assert.equal(t.secondary?.level,4192.280);
  assert.equal(t.primaryFiltered,true);
});

test('non-Friday single external objective remains Primary without duplicate Secondary',()=>{
  const rows=[{id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715}];
  const t=sessionLiquidityTargets(rows,'LOW',4143.225,thursday);
  assert.equal(t.primary?.level,4192.280);
  assert.equal(t.secondary,null);
  assert.equal(t.friday,false);
});


test('continuation retest uses external-liquidity targets while confluence stays advisory',()=>{
  const rows=[
    {id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192.280,low:4133.715},
    {id:'LONDON',label:'LONDON',status:'CLOSED',high:4166.000,low:4140.000},
    {id:'NEW_YORK',label:'NEW YORK',status:'CLOSED',high:4180.000,low:4150.000}
  ];
  const t=sessionTradeTargets(rows,'BUY',4167,thursday);
  assert.equal(t.secondary?.level,4180);
  assert.equal(t.primary?.level,4192.280);

  const msg=sessionRetestMessage(
    rows[1],
    'HIGH',
    {open:4165.8,high:4168,low:4165.7,close:4167},
    {level:4166},
    rows,
    thursday
  );
  assert.match(msg,/BUY continuation: external level event → M5 retest\/hold/);
  assert.match(msg,/TP1 — Secondary BSL: 4180\.000/);
  assert.match(msg,/TP2 — Primary BSL: 4192\.280/);
  assert.match(msg,/Execution gate: external level event \+ M5 retest\/hold/);
  assert.match(msg,/confluence only/);
});

test('sell continuation resolves nearest and next support levels as SSL targets',()=>{
  const rows=[
    {id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4192,low:4133},
    {id:'LONDON',label:'LONDON',status:'CLOSED',high:4170,low:4150},
    {id:'NEW_YORK',label:'NEW YORK',status:'CLOSED',high:4160,low:4140}
  ];
  const t=sessionTradeTargets(rows,'SELL',4155,thursday);
  assert.equal(t.secondary?.level,4150);
  assert.equal(t.primary?.level,4140);
});


test('ICT external-liquidity reversal is not vetoed by advisory model side or confidence',()=>{
  assert.equal(sessionIctReversalGate({phase:'MSS',structureShift:true,modelSide:'SELL',confidence:10}),true);
  assert.equal(sessionIctReversalGate({phase:'RETEST',retestTouch:true,held:true,modelSide:'SELL',confidence:10}),true);
  assert.equal(sessionIctReversalGate({phase:'MSS',structureShift:false,modelSide:'BUY',confidence:99}),false);
  assert.equal(sessionIctReversalGate({phase:'RETEST',retestTouch:true,held:false,modelSide:'BUY',confidence:99}),false);
});

test('ICT continuation retest or momentum acceptance is not vetoed by advisory model side or confidence',()=>{
  assert.equal(sessionIctContinuationGate({retestTouch:true,held:true,modelSide:'SELL',confidence:10}),true);
  assert.equal(sessionIctContinuationGate({retestTouch:false,held:true,momentumAccepted:true,modelSide:'SELL',confidence:10}),true);
  assert.equal(sessionIctContinuationGate({retestTouch:false,held:true,momentumAccepted:false,modelSide:'BUY',confidence:99}),false);
  assert.equal(sessionIctContinuationGate({retestTouch:true,held:false,momentumAccepted:false,modelSide:'BUY',confidence:99}),false);
});

test('M5 momentum acceptance requires a decisive close then a later no-reclaim directional hold',()=>{
  const level=4140;
  const first={t:1000,open:4139.9,high:4139.95,low:4136.8,close:4137.2};
  const second={t:2000,open:4137.2,high:4139.7,low:4134.8,close:4135.4};
  assert.equal(sessionMomentumArm({side:'SELL',level,bar:first}),true);
  assert.equal(sessionMomentumAcceptance({side:'SELL',level,bar:second,armedAt:first.t}),true);
  assert.equal(sessionMomentumAcceptance({side:'SELL',level,bar:{...second,high:4140.1},armedAt:first.t}),false);
  assert.equal(sessionMomentumAcceptance({side:'SELL',level,bar:{...second,t:first.t},armedAt:first.t}),false);

  const msg=sessionRetestMessage(
    {id:'LONDON',label:'LONDON',status:'CLOSED',high:4170,low:4140},
    'LOW',
    second,
    {level,continuationMode:'MOMENTUM_ACCEPTANCE',continuationModelSide:'BUY',continuationConfidence:20,continuationModelAligned:false},
    [
      {id:'TOKYO',label:'TOKYO',status:'CLOSED',high:4170,low:4125},
      {id:'LONDON',label:'LONDON',status:'CLOSED',high:4165,low:4140}
    ],
    thursday
  );
  assert.match(msg,/MOMENTUM ACCEPTANCE CONFIRMED/);
  assert.match(msg,/decisive M5 close → next M5 no-reclaim hold/);
  assert.match(msg,/not gating/);
});

test('gold session lookback preserves Friday levels through a normal weekend',async()=>{
  const fs=await import('node:fs');
  const src=fs.readFileSync(new URL('../gold-site-signal-engine-v9.js',import.meta.url),'utf8');
  assert.match(src,/session15Bars\(now=Date\.now\(\)\)\{const cutoff=now-96\*60\*60_000/);
  assert.match(src,/const cutoff=Date\.now\(\)-96\*60\*60_000/);
});


test('session completion alert cannot masquerade as an authoritative trade entry',()=>{
  const msg=sessionExecutionWatchMessage(
    {id:'TOKYO',label:'TOKYO',status:'CLOSED'},
    'HIGH',
    {open:4141,high:4142,low:4138,close:4139.31},
    {level:4163.375,reversalTrigger:4156.420},
    'REVERSAL'
  );
  assert.match(msg,/WAIT FOR AUTHORITATIVE SITE SIGNAL/);
  assert.match(msg,/تنبيه جلسة فقط، وليس صفقة دخول مستقلة/);
  assert.match(msg,/ACTIVE أو MANAGING/);
  assert.doesNotMatch(msg,/Entry reference|Structural SL|TP1 —|TP2 —/);
});

test('session alert loop no longer sends independent trade plans',async()=>{
  const fs=await import('node:fs');
  const src=fs.readFileSync(new URL('../telegram-xau-bot-v2.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/await send\(sessionReversalSetupMessage\(/);
  assert.doesNotMatch(src,/await send\(sessionRetestMessage\(/);
  assert.match(src,/await send\(sessionExecutionWatchMessage\(/);
});

test('active site signal never shows a pre-entry blocker',async()=>{
  const fs=await import('node:fs');
  const src=fs.readFileSync(new URL('../gold-site-ui-start.js',import.meta.url),'utf8');
  assert.match(src,/const blocker=active\?'لا يوجد مانع — الصفقة مفعلة/);
});

const earlyExitAt=Date.parse('2026-10-08T02:50:10Z');
const earlyExitBar={t:Date.parse('2026-10-08T02:45:00Z'),open:4140.2,high:4140.5,low:4137.2,close:4137.690};
const earlyExitTrade={
  signalId:'XAU-1791425809185-BUY',side:'BUY',status:'ACTIVE',entered:true,triggered:true,
  entry:4139.490,stopLoss:4132.133,price:4137.690,
  liveFeedFresh:true,degraded:false,quoteAgeMs:1000,updatedAt:new Date(earlyExitAt-1000).toISOString(),
  issuedAtMs:Date.parse('2026-10-08T02:20:00Z'),
  tradeState:{active:true,signalId:'XAU-1791425809185-BUY',side:'BUY'},
  liveModelAction:'BUY',liveModelConfidence:97
};
const earlyExitLock={active:true,key:earlyExitTrade.signalId,side:'BUY'};
const earlyExitSent={above:true,key:earlyExitTrade.signalId,exitAdvised:false};
const failedHigh={session:{id:'LONDON',label:'LONDON'},side:'HIGH',level:4139.660,bar:earlyExitBar,now:earlyExitAt};

test('London failed HIGH breakout tells the locked ACTIVE BUY to exit before SL despite model BUY 97%',()=>{
  const message=sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,earlyExitSent,failedHigh);
  assert.match(message,/EXIT BUY/);
  assert.match(message,/اخرج من صفقة BUY/);
  assert.match(message,/4139\\.660/);
  assert.match(message,/4137\\.690/);
  assert.match(message,/4132\\.133/);
  assert.match(message,/ليس دخول SELL/);
  assert.doesNotMatch(message,/SELL CONFIRMED|ادخل SELL/);
});

test('early exit is never sent for unknown, closed, unannounced, stale or already advised trades',()=>{
  assert.equal(sessionEarlyExitMessage({...earlyExitTrade,tradeState:{active:false}},earlyExitLock,earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage({...earlyExitTrade,entered:false},earlyExitLock,earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,{...earlyExitLock,key:'different'},earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,{...earlyExitSent,above:false},failedHigh),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,{...earlyExitSent,exitAdvised:true},failedHigh),null);
  assert.equal(sessionEarlyExitMessage({...earlyExitTrade,liveFeedFresh:false},earlyExitLock,earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage({...earlyExitTrade,quoteAgeMs:30000},earlyExitLock,earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,earlyExitSent,{...failedHigh,now:earlyExitAt+240000}),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,earlyExitSent,{...failedHigh,bar:{...earlyExitBar,close:4139.8}}),null);
  assert.equal(sessionEarlyExitMessage({...earlyExitTrade,price:4132.0},earlyExitLock,earlyExitSent,failedHigh),null);
  assert.equal(sessionEarlyExitMessage(earlyExitTrade,earlyExitLock,earlyExitSent,{...failedHigh,side:'LOW'}),null);
});

test('failed LOW breakout also protects an already announced active SELL without issuing a BUY entry',()=>{
  const sell={...earlyExitTrade,signalId:'sell-1',side:'SELL',entry:4134.0,stopLoss:4144.0,price:4137.69,tradeState:{active:true,signalId:'sell-1',side:'SELL'}};
  const message=sessionEarlyExitMessage(sell,{active:true,key:'sell-1',side:'SELL'},{above:true,key:'sell-1',exitAdvised:false},{
    ...failedHigh,side:'LOW',level:4135.0
  });
  assert.match(message,/EXIT SELL/);
  assert.match(message,/اخرج من صفقة SELL/);
  assert.match(message,/ليس دخول BUY/);
});
