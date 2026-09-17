import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v9.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "import { analyzeGoldSignal } from './gold-signal-model.js';",
    "import { analyzeGoldSignal } from './gold-signal-model.js';\nimport { getGoldNewsRisk } from './gold-news-risk.js';"
  ],
  [
    "const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);",
    "const MIN_CONFIDENCE=Math.max(80,Math.min(90,Number(process.env.MIN_CONFIDENCE||80)));"
  ],
  [
    "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));",
    "const BASE_MIN_TP1_R=Math.max(1.05,Math.min(1.40,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.10)));\nconst MAX_DAILY_SIGNALS=Math.max(1,Math.min(20,Number(process.env.GOLD_MAX_DAILY_SIGNALS||20)));\nconst POST_TRADE_COOLDOWN_MS=Math.max(300000,Number(process.env.GOLD_POST_TRADE_COOLDOWN_MS||300000));\nconst M5_ENTRY_WINDOW_MS=Math.max(60000,Math.min(150000,Number(process.env.GOLD_M5_ENTRY_WINDOW_MS||120000)));"
  ],
  [
    "const SL_COOLDOWN_MS=Math.max(120000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));",
    "const SL_COOLDOWN_MS=Math.max(600000,Number(process.env.GOLD_SL_COOLDOWN_MS||600000));"
  ],
  [
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v30-balanced-20day';"
  ],
  [
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null};",
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null,lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null};"
  ],
  [
    "const now=Date.now(),rawT=n(v.lp_time),stamp=rawT==null?NaN:(rawT>1e12?rawT:rawT*1000);",
    "const now=Date.now(),rawT=n(v.lp_time),parsed=rawT==null?null:(rawT>1e12?rawT:rawT*1000),stamp=Number.isFinite(parsed)&&parsed>0&&parsed<=now+5000?parsed:now;"
  ],
  [
    "maxRisk:round(clamp(atr1*2.80,2.00,5.00),3),",
    "maxRisk:round(clamp(atr1*3.20,2.50,5.00),3),"
  ],
  [
    "minTp1Usd:round(clamp(atr1*.60,.75,1.80),3),",
    "minTp1Usd:round(clamp(atr1*1.10,1.25,2.75),3),"
  ],
  [
    "}else state.cooldownUntil=now+60000;",
    "}else state.cooldownUntil=now+POST_TRADE_COOLDOWN_MS;"
  ],
  [
    "function maybeCreate(m,q,now){\n state.lastEntryGuard=null;",
    "const RIYADH_DAY_FORMATTER=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});\nfunction riyadhDayKey(ms=Date.now()){return RIYADH_DAY_FORMATTER.format(new Date(ms));}\nfunction refreshDailyQuota(now){const key=riyadhDayKey(now);if(state.dailySignalDate!==key){state.dailySignalDate=key;state.dailySignalCount=0;}}\nfunction maybeCreate(m,q,now){\n refreshDailyQuota(now);\n state.lastEntryGuard=null;\n if(state.dailySignalCount>=MAX_DAILY_SIGNALS){state.lastEntryGuard={atMs:now,reason:'DAILY_TOP20_LIMIT_REACHED',dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS};return;}\n const msInto5m=now%300000;\n if(msInto5m>M5_ENTRY_WINDOW_MS){state.lastEntryGuard={atMs:now,reason:'WAITING_NEXT_5M_CLOSE_WINDOW',nextWindowInSec:Math.ceil((300000-msInto5m)/1000)};return;}"
  ],
  [
    " const exit=exitPx(side,q),sl=n(m.stopLoss),tp1=n(m.target1);",
    " const exit=exitPx(side,q),sl=n(m.stopLoss);\n const policyForTargets=volatilityPolicy(now),liveRisk=Math.abs(p-sl),direction=side==='BUY'?1:-1;\n const tp1=round(p+direction*Math.max(1.50,liveRisk*1.10,(policyForTargets.atr1||1)*1.60),3);\n const tp2=round(p+direction*Math.max(3.00,liveRisk*1.80,(policyForTargets.atr1||1)*2.80),3);\n const tp3=round(p+direction*Math.max(5.00,liveRisk*2.60,(policyForTargets.atr1||1)*4.20),3);\n const tp4=round(p+direction*Math.max(8.00,liveRisk*3.50,(policyForTargets.atr1||1)*6.00),3);"
  ],
  [
    "originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,target1:tp1,target2:n(m.target2),target3:n(m.target3),target4:n(m.target4),",
    "originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,target1:tp1,target2:tp2,target3:tp3,target4:tp4,"
  ],
  [
    "source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,lockedTargets:true,",
    "source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,lockedTargets:true,tradeStyle:'BALANCED_5M_15M_SWING',maxDailySignals:MAX_DAILY_SIGNALS,dailySignalNumber:state.dailySignalCount+1,newsRiskAtEntry:state.lastNewsRisk,"
  ],
  [
    "reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — 1m confirm + volatility guard passed (${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$); managed stop active; Telegram only, AI off`",
    "reason:`CONFIRMED GOLD SETUP — ${Number(m.confidence)||0}% confidence; 5m execution + 15m context with 1m used only for timing; USD news guard clear; extended targets active (${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$); max ${MAX_DAILY_SIGNALS}/day; Telegram only, AI off`"
  ],
  [
    " state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);",
    " state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);state.dailySignalCount+=1;state.lastSignalAtMs=now;"
  ],
  [
    " const q=state.quote,now=Date.now();",
    " const q=state.quote,now=Date.now();\n const newsRisk=await getGoldNewsRisk(now);state.lastNewsRisk=newsRisk;"
  ],
  [
    " const model=analyzeGoldSignal(state.samples,q.price,now);\n if(!state.signal)maybeCreate(model,q,now);",
    " const model=analyzeGoldSignal(state.samples,q.price,now);\n if(!state.signal){if(newsRisk.blockEntries){state.lastEntryGuard={atMs:now,reason:'USD_NEWS_BLACKOUT',newsLevel:newsRisk.level,newsReason:newsRisk.reason,activeEvent:newsRisk.activeEvent};}else maybeCreate(model,q,now);}"
  ],
  [
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,volatilityPolicy:policy,",
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'BALANCED_5M_15M_SWING',newsRisk,volatilityPolicy:policy,"
  ],
  [
    "if(state.lastEntryGuard?.atMs===now)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:`ENTRY_GUARD: ${state.lastEntryGuard.reason} — no Telegram entry sent`};",
    "if(state.lastEntryGuard?.atMs===now)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:state.lastEntryGuard.reason==='USD_NEWS_BLACKOUT'?`NEWS RISK: ${newsRisk.reason} — no Telegram entry sent`:`ENTRY_GUARD: ${state.lastEntryGuard.reason} — no Telegram entry sent`};"
  ],
  [
    "if(stage===1){\n  const nearEntry=s.side==='BUY'?entry-Math.min(.18,initialRisk*.12):entry+Math.min(.18,initialRisk*.12);\n  const structure=swing==null?nearEntry:(s.side==='BUY'?swing-buffer:swing+buffer);\n  candidate=s.side==='BUY'?Math.max(nearEntry,structure):Math.min(nearEntry,structure);\n }else if(stage===2){",
    "if(stage===1){\n  // Keep the original structural stop after TP1. This swing profile deliberately gives the trade room to develop beyond the first target.\n  candidate=null;\n }else if(stage===2){"
  ],
  [
    "if(!freshQuote(q,now))throw new Error(`TRADINGVIEW_DIRECT_NOT_FRESH age=${Number.isFinite(quoteAgeMs(q,now))?round(quoteAgeMs(q,now)/1000,1):'na'}s connected=${state.wsConnected}`);",
    "if(!freshQuote(q,now)){const age=quoteAgeMs(q,now),ageSec=Number.isFinite(age)?round(age/1000,1):null;state.lastError=`TRADINGVIEW_DIRECT_STALE age=${ageSec??'na'}s connected=${state.wsConnected}`;if(now-(state.lastReconnectAttempt||0)>15000){state.lastReconnectAttempt=now;console.warn(`[tv-direct] stale live quote age=${ageSec??'unknown'}s; forcing websocket reconnect`);try{if(state.ws?.readyState===WebSocket.OPEN)state.ws.terminate();}catch(e){console.error('[tv-direct] stale reconnect',e?.message||e);}}return{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,liveFeedFresh:false,quoteAgeMs:Number.isFinite(age)?age:null,price:n(q?.price),bid:n(q?.bid),ask:n(q?.ask),provider:q?.provider||null,entered:false,triggered:false,signalId:null,terminalEvent:state.lastTerminal,reason:'DATA_RECOVERING: TradingView live price is stale; reconnecting before any new Telegram entry',updatedAt:iso(now),build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL};}"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`gold-site-signal-engine-v9: expected signature not found: ${from.slice(0, 60)}`);
  source = source.replace(from, to);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
