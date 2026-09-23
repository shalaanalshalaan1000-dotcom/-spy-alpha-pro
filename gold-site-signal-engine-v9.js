import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v9.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "import { analyzeGoldSignal } from './gold-signal-model.js';",
    "import { analyzeGoldSignal } from './gold-scenario-model.js';\nimport { getGoldNewsRisk } from './gold-news-risk.js';"
  ],
  [
    "const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);",
    "const MIN_CONFIDENCE=Math.max(82,Math.min(90,Number(process.env.MIN_CONFIDENCE||82)));"
  ],
  [
    "const REQUIRE_1M_CONFIRM=String(process.env.GOLD_REQUIRE_1M_CONFIRM||'true').toLowerCase()!=='false';",
    "const REQUIRE_1M_CONFIRM=false;"
  ],
  [
    "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));",
    "const BASE_MIN_TP1_R=Math.max(.65,Math.min(.90,Number(process.env.GOLD_MIN_LIVE_TP1_R||.90)));\nconst MAX_DAILY_SIGNALS=Math.max(1,Math.min(20,Number(process.env.GOLD_MAX_DAILY_SIGNALS||20)));\nconst POST_TRADE_COOLDOWN_MS=Math.max(300000,Number(process.env.GOLD_POST_TRADE_COOLDOWN_MS||300000));\nconst M5_ENTRY_WINDOW_MS=Math.max(60000,Math.min(180000,Number(process.env.GOLD_M5_ENTRY_WINDOW_MS||150000)));"
  ],
  [
    "const SL_COOLDOWN_MS=Math.max(120000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));",
    "const SL_COOLDOWN_MS=Math.max(300000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));"
  ],
  [
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v39-zone-scenario';"
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
    "minTp1Usd:round(clamp(atr1*.70,1.00,1.80),3),"
  ],
  [
    "}else state.cooldownUntil=now+60000;",
    "}else state.cooldownUntil=now+POST_TRADE_COOLDOWN_MS;"
  ],
  [
    "function maybeCreate(m,q,now){\n state.lastEntryGuard=null;",
    "const RIYADH_DAY_FORMATTER=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});\nfunction riyadhDayKey(ms=Date.now()){return RIYADH_DAY_FORMATTER.format(new Date(ms));}\nfunction refreshDailyQuota(now){const key=riyadhDayKey(now);if(state.dailySignalDate!==key){state.dailySignalDate=key;state.dailySignalCount=0;}}\nfunction completedTimeframeBars(spanMs,now=Date.now()){const buckets=new Map(),currentKey=Math.floor(now/spanMs)*spanMs;for(const x of state.samples){const t=n(x.t),p=n(x.p??x.price);if(t==null||p==null||p<=0)continue;const key=Math.floor(t/spanMs)*spanMs;if(key>=currentKey)continue;const b=buckets.get(key);if(!b)buckets.set(key,{t:key,open:p,high:p,low:p,close:p});else{b.high=Math.max(b.high,p);b.low=Math.min(b.low,p);b.close=p;}}return [...buckets.values()].sort((a,b)=>a.t-b.t);}\nfunction recentFiveMinuteSwing(side,now=Date.now(),count=4){const bars=completedTimeframeBars(300000,now).slice(-Math.max(2,count));if(bars.length<2)return null;return side==='BUY'?Math.min(...bars.map(b=>b.low)):Math.max(...bars.map(b=>b.high));}\nfunction structuralStop(side,entry,modelStop,now=Date.now()){const policy=volatilityPolicy(now),atr1=Number(policy.atr1)||1,swing=recentFiveMinuteSwing(side,now,4),buffer=clamp(atr1*.50,.45,.90),minDistance=clamp(atr1*1.60,2.00,3.50);let stop=n(modelStop);if(stop==null||!Number.isFinite(entry))return{ok:false,reason:'INVALID_STRUCTURAL_STOP',policy};if(swing!=null){const structural=side==='BUY'?swing-buffer:swing+buffer;stop=side==='BUY'?Math.min(stop,structural):Math.max(stop,structural);}stop=side==='BUY'?Math.min(stop,entry-minDistance):Math.max(stop,entry+minDistance);const risk=Math.abs(entry-stop),maxRisk=Number(policy.maxRisk)||5;if(!(risk>0))return{ok:false,reason:'INVALID_STRUCTURAL_RISK',policy};if(risk>maxRisk)return{ok:false,reason:'STRUCTURAL_STOP_TOO_WIDE',stop:round(stop,3),risk:round(risk,3),swing:round(swing,3),buffer:round(buffer,3),minDistance:round(minDistance,3),policy};return{ok:true,stop:round(stop,3),risk:round(risk,3),swing:round(swing,3),buffer:round(buffer,3),minDistance:round(minDistance,3),policy};}\nfunction maybeCreate(m,q,now){\n refreshDailyQuota(now);\n state.lastEntryGuard=null;\n if(state.dailySignalCount>=MAX_DAILY_SIGNALS){state.lastEntryGuard={atMs:now,reason:'DAILY_TOP20_LIMIT_REACHED',dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS};return;}\n const msInto5m=now%300000;\n if(false&&msInto5m>M5_ENTRY_WINDOW_MS){state.lastEntryGuard={atMs:now,reason:'WAITING_NEXT_5M_CLOSE_WINDOW',nextWindowInSec:Math.ceil((300000-msInto5m)/1000)};return;}"
  ],
  [
    " const exit=exitPx(side,q),sl=n(m.stopLoss),tp1=n(m.target1);",
    " const exit=exitPx(side,q),stopPlan=structuralStop(side,p,n(m.stopLoss),now);\n if(!stopPlan?.ok){state.lastEntryGuard={atMs:now,reason:stopPlan?.reason||'STRUCTURAL_STOP_REJECTED',side,price:round(p,3),risk:stopPlan?.risk??null,structuralSwing:stopPlan?.swing??null,policy:stopPlan?.policy??volatilityPolicy(now)};return;}\n const sl=stopPlan.stop;\n const policyForTargets=volatilityPolicy(now),liveRisk=Math.abs(p-sl),direction=side==='BUY'?1:-1;\n const tp1=round(p+direction*Math.max(1.75,liveRisk*1.35,(policyForTargets.atr1||1)*1.80),3);\n const tp2=round(p+direction*Math.max(3.50,liveRisk*2.00,(policyForTargets.atr1||1)*3.00),3);\n const tp3=round(p+direction*Math.max(5.50,liveRisk*2.80,(policyForTargets.atr1||1)*4.50),3);\n const tp4=round(p+direction*Math.max(8.50,liveRisk*3.80,(policyForTargets.atr1||1)*6.50),3);"
  ],
  [
    "originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,target1:tp1,target2:n(m.target2),target3:n(m.target3),target4:n(m.target4),",
    "originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,structuralStopPlan:stopPlan,target1:tp1,target2:tp2,target3:tp3,target4:tp4,"
  ],
  [
    "source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,lockedTargets:true,",
    "source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,lockedTargets:true,tradeStyle:'ZONE_SCENARIO_STRUCTURE',maxDailySignals:MAX_DAILY_SIGNALS,dailySignalNumber:state.dailySignalCount+1,newsRiskAtEntry:state.lastNewsRisk,"
  ],
  [
    "reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — 1m confirm + volatility guard passed (${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$); managed stop active; Telegram only, AI off`",
    "reason:`CONFIRMED GOLD SETUP — ${Number(m.confidence)||0}% confidence; 5m structure stop + ${round(stopPlan.buffer,2)}$ buffer; 5m execution + 15m context with 1m used only for timing; USD news guard clear; ${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$; max ${MAX_DAILY_SIGNALS}/day; Telegram only, AI off`"
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
    " const model=analyzeGoldSignal(state.samples,q.price,now);\n if(now-(state.lastDiagAt||0)>=60000){state.lastDiagAt=now;console.log(\`[xau-state] status=\${model.status} conf=\${Number(model.confidence)||0} bias=\${model.contextBias||'NA'} samples=\${state.samples.length} fresh=\${freshQuote(q,now)} reason=\${String(model.reason||'').slice(0,220)}\`);}\n if(!state.signal){if(newsRisk.blockEntries){state.lastEntryGuard={atMs:now,reason:'USD_NEWS_BLACKOUT',newsLevel:newsRisk.level,newsReason:newsRisk.reason,activeEvent:newsRisk.activeEvent};}else maybeCreate(model,q,now);}"
  ],
  [
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,volatilityPolicy:policy,",
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'ZONE_SCENARIO_STRUCTURE',newsRisk,volatilityPolicy:policy,"
  ],
  [
    "if(state.lastEntryGuard?.atMs===now)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:`ENTRY_GUARD: ${state.lastEntryGuard.reason} — no Telegram entry sent`};",
    "if(state.lastEntryGuard?.atMs===now)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:state.lastEntryGuard.reason==='USD_NEWS_BLACKOUT'?`NEWS RISK: ${newsRisk.reason} — no Telegram entry sent`:`ENTRY_GUARD: ${state.lastEntryGuard.reason} — no Telegram entry sent`};"
  ],
  [
    "if(stage===1){\n  const nearEntry=s.side==='BUY'?entry-Math.min(.18,initialRisk*.12):entry+Math.min(.18,initialRisk*.12);\n  const structure=swing==null?nearEntry:(s.side==='BUY'?swing-buffer:swing+buffer);\n  candidate=s.side==='BUY'?Math.max(nearEntry,structure):Math.min(nearEntry,structure);\n }else if(stage===2){",
    "if(stage===1){\n  candidate=n(s.target1)??entry;\n }else if(stage===2){"
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


// Zone-scenario upgrade: preserve HTF history/OHLC, use structural stops, support/resistance targets,
// and size risk by lot instead of forcing a tight dollar stop.
{
  const oldNormalize="function normalize(){const cutoff=Date.now()-3*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-2400);}";
  const newNormalize="function normalize(){const cutoff=Date.now()-96*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p??x.price??x.close)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-6500);}";
  if(!source.includes(oldNormalize))throw new Error('Zone scenario patch: normalize anchor missing');
  source=source.replace(oldNormalize,newNormalize);

  const oldAdd="function add(t,p,bid=p,ask=p){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;state.samples.push({t,p,price:p,bid:n(bid)??p,ask:n(ask)??p});}";
  const newAdd="function add(t,p,bid=p,ask=p,ohlc=null){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;const row={t,p,price:p,bid:n(bid)??p,ask:n(ask)??p};if(ohlc&&[ohlc.open,ohlc.high,ohlc.low,ohlc.close].every(v=>n(v)!=null)){row.open=n(ohlc.open);row.high=n(ohlc.high);row.low=n(ohlc.low);row.close=n(ohlc.close);row.p=row.close;row.price=row.close;}state.samples.push(row);}";
  if(!source.includes(oldAdd))throw new Error('Zone scenario patch: add anchor missing');
  source=source.replace(oldAdd,newAdd);

  source=source.replace("const t=n(v[0]),close=n(v[4]);","const t=n(v[0]),open=n(v[1]),high=n(v[2]),low=n(v[3]),close=n(v[4]);");
  source=source.replace("add(ms,close,close,close);","add(ms,close,close,close,{open,high,low,close});");
  source=source.replace("send('create_series',[cs,'s1','s1','symbol_1','1',180]);","send('create_series',[cs,'s1','s1','symbol_1','1',5000]);");

  const validStart=source.indexOf("function validLevels("),validEnd=source.indexOf("\nfunction entryPx",validStart);
  if(validStart<0||validEnd<0)throw new Error('Zone scenario patch: validLevels anchor missing');
  const validFn="function validLevels(m){const s=m.candidateAction,lo=n(m.entryLow),hi=n(m.entryHigh),sl=n(m.stopLoss),t=[m.target1,m.target2,m.target3,m.target4].map(n);if(!['BUY','SELL'].includes(s)||lo==null||hi==null||sl==null||lo<=0||hi<=0||sl<=0||lo>hi||t[0]==null)return false;if(s==='BUY'&&!(sl<lo&&t[0]>hi))return false;if(s==='SELL'&&!(sl>hi&&t[0]<lo))return false;let prev=t[0];for(let i=1;i<t.length;i++){if(t[i]==null)continue;if(s==='BUY'&&t[i]<=prev)return false;if(s==='SELL'&&t[i]>=prev)return false;prev=t[i];}return true;}";
  source=source.slice(0,validStart)+validFn+source.slice(validEnd);

  const stopStart=source.indexOf("function structuralStop("),stopEnd=source.indexOf("\nfunction maybeCreate",stopStart);
  if(stopStart<0||stopEnd<0)throw new Error('Zone scenario patch: structuralStop anchor missing');
  const stopFn="function structuralStop(side,entry,modelStop,now=Date.now()){const policy=volatilityPolicy(now),stop=n(modelStop);if(stop==null||!Number.isFinite(entry))return{ok:false,reason:'INVALID_MOMENTUM_STOP',policy};if(side==='BUY'&&stop>=entry)return{ok:false,reason:'INVALID_MOMENTUM_STOP_SIDE',policy};if(side==='SELL'&&stop<=entry)return{ok:false,reason:'INVALID_MOMENTUM_STOP_SIDE',policy};const risk=Math.abs(entry-stop);if(risk<.45)return{ok:false,reason:'MOMENTUM_STOP_TOO_TIGHT',stop:round(stop,3),risk:round(risk,3),policy};return{ok:true,stop:round(stop,3),risk:round(risk,3),swing:null,buffer:0,minDistance:0,policy,source:'ZONE_SCENARIO_MODEL'};}";
  source=source.slice(0,stopStart)+stopFn+source.slice(stopEnd);

  source=source.replace("if(risk>policy.maxRisk)return{ok:false,reason:'STOP_TOO_WIDE_FOR_VOLATILITY',risk,reward,rr,policy};","");

  const m5Anchor="const M5_ENTRY_WINDOW_MS=Math.max(60000,Math.min(180000,Number(process.env.GOLD_M5_ENTRY_WINDOW_MS||150000)));";
  if(!source.includes(m5Anchor))throw new Error('Zone scenario patch: config anchor missing');
  source=source.replace(m5Anchor,m5Anchor+"\nconst XAU_CONTRACT_SIZE=Math.max(1,Number(process.env.XAU_CONTRACT_SIZE||100));\nconst XAU_LOT_STEP=Math.max(.001,Number(process.env.XAU_LOT_STEP||.01));\nconst XAU_ACCOUNT_BALANCE_USD=Math.max(1,Number(process.env.XAU_ACCOUNT_BALANCE_USD||155));\nconst XAU_SAFE_RISK_USD=Math.max(1,Number(process.env.XAU_SAFE_RISK_USD||5));\nconst XAU_MAX_RISK_USD=Math.max(XAU_SAFE_RISK_USD,Number(process.env.XAU_MAX_RISK_USD||10));");

  const dayAnchor="const RIYADH_DAY_FORMATTER=";
  const dayAt=source.indexOf(dayAnchor);
  if(dayAt<0)throw new Error('Zone scenario patch: day formatter anchor missing');
  const lotFn="function goldLotForRisk(entry,stop,riskUsd){const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0)||!(riskUsd>0))return 0;const raw=riskUsd/(distance*XAU_CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/XAU_LOT_STEP);return steps>0?Number((steps*XAU_LOT_STEP).toFixed(3)):0;}\nfunction goldLotSizing(entry,stop){const stopDistance=Math.abs(Number(entry)-Number(stop)),safeLot=goldLotForRisk(entry,stop,XAU_SAFE_RISK_USD),maxLot=goldLotForRisk(entry,stop,XAU_MAX_RISK_USD),recommendedLot=safeLot>0?safeLot:(maxLot>0?XAU_LOT_STEP:0),actualRisk=recommendedLot>0?stopDistance*XAU_CONTRACT_SIZE*recommendedLot:null;return{allowed:maxLot>0,balanceUsd:XAU_ACCOUNT_BALANCE_USD,safeRiskUsd:XAU_SAFE_RISK_USD,maxRiskUsd:XAU_MAX_RISK_USD,contractSize:XAU_CONTRACT_SIZE,lotStep:XAU_LOT_STEP,stopDistance:round(stopDistance,3),safeLot:round(safeLot,3),maxLot:round(maxLot,3),recommendedLot:round(recommendedLot,3),actualRiskUsd:round(actualRisk,2)};}\n";
  source=source.slice(0,dayAt)+lotFn+source.slice(dayAt);

  const oldTargets="const policyForTargets=volatilityPolicy(now),liveRisk=Math.abs(p-sl),direction=side==='BUY'?1:-1;\n const tp1=round(p+direction*Math.max(1.75,liveRisk*1.35,(policyForTargets.atr1||1)*1.80),3);\n const tp2=round(p+direction*Math.max(3.50,liveRisk*2.00,(policyForTargets.atr1||1)*3.00),3);\n const tp3=round(p+direction*Math.max(5.50,liveRisk*2.80,(policyForTargets.atr1||1)*4.50),3);\n const tp4=round(p+direction*Math.max(8.50,liveRisk*3.80,(policyForTargets.atr1||1)*6.50),3);";
  const newTargets="const tp1=n(m.target1),tp2=n(m.target2),tp3=n(m.target3),tp4=n(m.target4),liquidityRisk=Math.abs(p-sl),liquidityReward=side==='BUY'?tp1-p:p-tp1,liquidityRR=liquidityRisk>0?liquidityReward/liquidityRisk:0;\n if(tp1==null||!(liquidityReward>0)||liquidityRR<.55){state.lastEntryGuard={atMs:now,reason:'MAIN_TARGET_BELOW_MIN_R',side,price:round(p,3),stop:round(sl,3),target1:round(tp1,3),liveRR:round(liquidityRR,2)};return;}\n const lotSizing=goldLotSizing(p,sl);\n if(!lotSizing.allowed){state.lastEntryGuard={atMs:now,reason:'MIN_LOT_EXCEEDS_MAX_RISK',side,price:round(p,3),stop:round(sl,3),lotSizing};return;}";
  if(!source.includes(oldTargets))throw new Error('Zone scenario patch: target generator anchor missing');
  source=source.replace(oldTargets,newTargets);

  source=source.replace("originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,structuralStopPlan:stopPlan,target1:tp1,target2:tp2,target3:tp3,target4:tp4,","originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,structuralStopPlan:stopPlan,lotSizing,scenarioPlan:m.scenarioPlan||null,momentum:m.momentum||m.prediction||null,targetLabels:m.targetLabels||[],target1:tp1,target2:tp2,target3:tp3,target4:tp4,");
  source=source.replace("reason:\`CONFIRMED GOLD SETUP — \${Number(m.confidence)||0}% confidence; 5m structure stop + \${round(stopPlan.buffer,2)}$ buffer; 5m execution + 15m context with 1m used only for timing; USD news guard clear; \${round(viability.rr,2)}R to TP1, risk \${round(viability.risk,2)}$, ATR1 \${viability.policy.atr1}$; max \${MAX_DAILY_SIGNALS}/day; Telegram only, AI off\`","reason:\`ZONE SCENARIO CONFIRMED — \${m.strategy||'TREND'}; planned zone + closed 5m rejection/engulfing/structure shift + structural invalidation; setup quality \${Number(m.confidence)||0}/100 (not win probability); live RR \${round(liquidityRR,2)}R; SL \${round(sl,2)}; lot \${lotSizing.recommendedLot||0}\`");

  source=source.replace("const result=outcome==='TP4'?'WIN':realizedR>0.05?'WIN':realizedR>=-.05?'BREAKEVEN':'LOSS';","const result=String(outcome).startsWith('TP')?'WIN':realizedR>0.05?'WIN':realizedR>=-.05?'BREAKEVEN':'LOSS';");
  const oldManage="if(s.targetHits[2])applyManagement(s,3,now);\n if(s.targetHits[3])return close('TP4',s.target4,now,{stopType:'TARGET'});";
  const newManage="if(s.targetHits[2])applyManagement(s,3,now);\n const targetList=[s.target1,s.target2,s.target3,s.target4],lastTargetIndex=targetList.reduce((last,v,i)=>n(v)!=null?i:last,-1);\n if(lastTargetIndex>=0&&s.targetHits[lastTargetIndex])return close('TP'+(lastTargetIndex+1),targetList[lastTargetIndex],now,{stopType:'TARGET'});";
  if(!source.includes(oldManage))throw new Error('Zone scenario patch: management anchor missing');
  source=source.replace(oldManage,newManage);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
