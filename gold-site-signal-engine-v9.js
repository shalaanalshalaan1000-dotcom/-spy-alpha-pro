import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v9.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "import { analyzeGoldSignal } from './gold-signal-model.js';",
    "import { analyzeGoldSignal } from './gold-confluence-model.js';\nimport { getGoldNewsRisk } from './gold-news-risk.js';\nimport { gateGoldModelWithNativeLuxAlgo } from './gold-luxalgo-native.js';"
  ],
  [
    "const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);",
    "const MIN_CONFIDENCE=Math.max(75,Number(process.env.MIN_CONFIDENCE||75));"
  ],
  [
    "const REQUIRE_1M_CONFIRM=String(process.env.GOLD_REQUIRE_1M_CONFIRM||'true').toLowerCase()!=='false';",
    "const REQUIRE_1M_CONFIRM=false;"
  ],
  [
    "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));",
    "const BASE_MIN_TP1_R=Math.max(.50,Math.min(.75,Number(process.env.GOLD_MIN_LIVE_TP1_R||.60)));\nconst MAX_DAILY_SIGNALS=Math.max(1,Math.min(100,Number(process.env.GOLD_MAX_DAILY_SIGNALS||100)));\nconst POST_TRADE_COOLDOWN_MS=Math.max(60000,Math.min(180000,Number(process.env.GOLD_POST_TRADE_COOLDOWN_MS||60000)));\nconst M5_ENTRY_WINDOW_MS=Math.max(60000,Math.min(180000,Number(process.env.GOLD_M5_ENTRY_WINDOW_MS||150000)));"
  ],
  [
    "const SL_COOLDOWN_MS=Math.max(120000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));",
    "const SL_COOLDOWN_MS=Math.max(300000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));"
  ],
  [
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v61-important-candles';"
  ],
  [
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null};",
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null,lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null,candidateLock:null,candidateLockBucket:null};"
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
    "const RIYADH_DAY_FORMATTER=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});\nfunction riyadhDayKey(ms=Date.now()){return RIYADH_DAY_FORMATTER.format(new Date(ms));}\nfunction refreshDailyQuota(now){const key=riyadhDayKey(now);if(state.dailySignalDate!==key){state.dailySignalDate=key;state.dailySignalCount=0;}}\nfunction completedTimeframeBars(spanMs,now=Date.now()){const buckets=new Map(),currentKey=Math.floor(now/spanMs)*spanMs;for(const x of state.samples){const t=n(x.t),p=n(x.p??x.price);if(t==null||p==null||p<=0)continue;const key=Math.floor(t/spanMs)*spanMs;if(key>=currentKey)continue;const b=buckets.get(key);if(!b)buckets.set(key,{t:key,open:p,high:p,low:p,close:p});else{b.high=Math.max(b.high,p);b.low=Math.min(b.low,p);b.close=p;}}return [...buckets.values()].sort((a,b)=>a.t-b.t);}\nfunction recentFiveMinuteSwing(side,now=Date.now(),count=4){const bars=completedTimeframeBars(300000,now).slice(-Math.max(2,count));if(bars.length<2)return null;return side==='BUY'?Math.min(...bars.map(b=>b.low)):Math.max(...bars.map(b=>b.high));}\nfunction structuralStop(side,entry,modelStop,now=Date.now()){const policy=volatilityPolicy(now),atr1=Number(policy.atr1)||1,swing=recentFiveMinuteSwing(side,now,4),buffer=clamp(atr1*.50,.45,.90),minDistance=clamp(atr1*1.60,2.00,3.50);let stop=n(modelStop);if(stop==null||!Number.isFinite(entry))return{ok:false,reason:'INVALID_STRUCTURAL_STOP',policy};if(swing!=null){const structural=side==='BUY'?swing-buffer:swing+buffer;stop=side==='BUY'?Math.min(stop,structural):Math.max(stop,structural);}stop=side==='BUY'?Math.min(stop,entry-minDistance):Math.max(stop,entry+minDistance);const risk=Math.abs(entry-stop),maxRisk=Number(policy.maxRisk)||5;if(!(risk>0))return{ok:false,reason:'INVALID_STRUCTURAL_RISK',policy};if(risk>maxRisk)return{ok:false,reason:'STRUCTURAL_STOP_TOO_WIDE',stop:round(stop,3),risk:round(risk,3),swing:round(swing,3),buffer:round(buffer,3),minDistance:round(minDistance,3),policy};return{ok:true,stop:round(stop,3),risk:round(risk,3),swing:round(swing,3),buffer:round(buffer,3),minDistance:round(minDistance,3),policy};}\nfunction maybeCreate(m,q,now){\n refreshDailyQuota(now);\n state.lastEntryGuard=null;\n if(state.dailySignalCount>=MAX_DAILY_SIGNALS){state.lastEntryGuard={atMs:now,reason:'DAILY_SIGNAL_LIMIT_REACHED',dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS};return;}\n const msInto5m=now%300000;\n if(false&&msInto5m>M5_ENTRY_WINDOW_MS){state.lastEntryGuard={atMs:now,reason:'WAITING_NEXT_5M_CLOSE_WINDOW',nextWindowInSec:Math.ceil((300000-msInto5m)/1000)};return;}"
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
    "source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,lockedTargets:true,tradeStyle:'MULTI_MODEL_CONFLUENCE',priceAction:m.priceAction||null,importantCandles:m.importantCandles||null,technicalRead:m.technicalRead||null,maxDailySignals:MAX_DAILY_SIGNALS,dailySignalNumber:state.dailySignalCount+1,newsRiskAtEntry:state.lastNewsRisk,"
  ],
  [
    "reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — 1m confirm + volatility guard passed (${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$); managed stop active; Telegram only, AI off`",
    "reason:`CONFIRMED GOLD SETUP — ${Number(m.confidence)||0}% confidence; 5m structure stop + ${round(stopPlan.buffer,2)}$ buffer; 5m execution + 15m context with 1m used only for timing; USD news guard clear; ${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$; max ${MAX_DAILY_SIGNALS}/day; Telegram only, AI off`"
  ],
  [
    " state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);",
    " state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);state.dailySignalCount+=1;state.lastSignalAtMs=now;state.candidateLock=null;state.candidateLockBucket=null;"
  ],
  [
    " const q=state.quote,now=Date.now();",
    " const q=state.quote,now=Date.now();\n const newsRiskRaw=await getGoldNewsRisk(now);const newsRisk={...newsRiskRaw,blockEntries:false,advisoryOnly:true,executionGate:false};state.lastNewsRisk=newsRisk;"
  ],
  [
    " const model=analyzeGoldSignal(state.samples,q.price,now);\n if(!state.signal)maybeCreate(model,q,now);",
    " const rawModel=analyzeGoldSignal(state.samples,q.price,now);\n const gatedModel=gateGoldModelWithNativeLuxAlgo(rawModel,state.samples,{now});\n let model=gatedModel;try{model=stabilizeCandidateModel(gatedModel,q,now);}catch(e){console.error('[candidate-lock-error]',e?.stack||e);}\n if(now-(state.lastDiagAt||0)>=60000){state.lastDiagAt=now;console.log(\`[xau-state] status=\${model.status} conf=\${Number(model.confidence)||0} bias=\${model.contextBias||'NA'} locked=\${Boolean(model.candidateLocked)} nativeICT=\${model.luxalgo?.gate||'NA'} samples=\${state.samples.length} fresh=\${freshQuote(q,now)} reason=\${String(model.reason||'').slice(0,220)}\`);}\n if(!state.signal)maybeCreate(model,q,now);"
  ],
  [
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,volatilityPolicy:policy,",
    "signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'MULTI_MODEL_CONFLUENCE',newsRisk,volatilityPolicy:policy,"
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
    "if(!freshQuote(q,now)){const age=quoteAgeMs(q,now),ageSec=Number.isFinite(age)?round(age/1000,1):null;state.lastError=`TRADINGVIEW_DIRECT_STALE age=${ageSec??'na'}s connected=${state.wsConnected}`;if(now-(state.lastReconnectAttempt||0)>15000){state.lastReconnectAttempt=now;console.warn(`[tv-direct] stale live quote age=${ageSec??'unknown'}s; forcing websocket reconnect`);try{if(state.ws?.readyState===WebSocket.OPEN)state.ws.terminate();}catch(e){console.error('[tv-direct] stale reconnect',e?.message||e);}}if(state.signal){persistActiveTradeState(now);const active=state.signal;return{...active,status:'ACTIVE',action:'WAIT',candidateAction:active.side,side:active.side,executable:false,degraded:true,liveFeedFresh:false,quoteAgeMs:Number.isFinite(age)?age:null,price:n(q?.price),bid:n(q?.bid),ask:n(q?.ask),provider:q?.provider||active.priceProvider||null,entered:true,triggered:true,signalId:active.signalId,terminalEvent:state.lastTerminal,tradeState:{...(active.tradeState||{}),lifecycle:'CONFIRMED',active:true,status:'ACTIVE',signalId:active.signalId,side:active.side,immutablePlan:true,feedState:'STALE',feedStaleSince:iso(now)},reason:'ACTIVE_TRADE_DATA_PAUSED: confirmed trade remains authoritative; no TP/SL management changes until live TradingView data returns',updatedAt:iso(now),build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL};}return{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,liveFeedFresh:false,quoteAgeMs:Number.isFinite(age)?age:null,price:n(q?.price),bid:n(q?.bid),ask:n(q?.ask),provider:q?.provider||null,entered:false,triggered:false,signalId:null,terminalEvent:state.lastTerminal,reason:'DATA_RECOVERING: TradingView live price is stale; reconnecting before any new Telegram entry',updatedAt:iso(now),build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL};}"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`gold-site-signal-engine-v9: expected signature not found: ${from.slice(0, 60)}`);
  source = source.replace(from, to);
}


// Candidate setup state machine: once a valid ICT candidate is formed, freeze the
// entry zone, SL and targets. Live ticks may execute that plan, but they may not
// rewrite it. A different confirmed setup can replace it only after a new M5 bucket.
{
  const candidateAnchor="function maybeCreate(m,q,now){\n refreshDailyQuota(now);";
  if(!source.includes(candidateAnchor))throw new Error('candidate-lock patch: maybeCreate anchor missing');
  const candidateFns="function m5Bucket(now=Date.now()){return Math.floor(now/300000);}\nfunction validCandidatePlan(m){return Boolean(m&&m.status==='CANDIDATE'&&['BUY','SELL'].includes(m.candidateAction)&&Number(m.confidence)>=MIN_CONFIDENCE&&validLevels(m));}\nfunction candidatePlanConsumed(lock,q){if(!lock)return true;const side=lock.candidateAction,px=side==='BUY'?(n(q?.bid)??n(q?.price)):(n(q?.ask)??n(q?.price)),sl=n(lock.stopLoss),tp1=n(lock.target1);if(px==null||!['BUY','SELL'].includes(side))return false;return side==='BUY'?((sl!=null&&px<=sl)||(tp1!=null&&px>=tp1)):((sl!=null&&px>=sl)||(tp1!=null&&px<=tp1));}\nfunction freezeCandidate(m,now){const bucket=m5Bucket(now);return{...m,candidateLocked:true,candidateLockedAtMs:now,candidateLockedM5Bucket:bucket,reason:'LOCKED CONFLUENCE CANDIDATE — entry zone, SL and targets fixed until execution, structural invalidation, target consumption, or a new confirmed M5 setup'};}\nfunction stabilizeCandidateModel(m,q,now){const bucket=m5Bucket(now);if(m?.hardConflict){state.candidateLock=null;state.candidateLockBucket=null;return m;}if(state.signal){state.candidateLock=null;state.candidateLockBucket=null;return m;}if(state.candidateLock&&candidatePlanConsumed(state.candidateLock,q)){state.candidateLock=null;state.candidateLockBucket=null;}const incomingValid=validCandidatePlan(m);if(!state.candidateLock){if(!incomingValid)return m;state.candidateLock=freezeCandidate(m,now);state.candidateLockBucket=bucket;}else{const lock=state.candidateLock,sameSide=m?.candidateAction===lock.candidateAction,sameSetup=Boolean(incomingValid&&sameSide&&((m.setupId&&lock.setupId&&m.setupId===lock.setupId)||(!m.setupId&&!lock.setupId)));const newM5=bucket!==state.candidateLockBucket;if(newM5){state.candidateLockBucket=bucket;if(incomingValid&&!sameSetup)state.candidateLock=freezeCandidate(m,now);}}const locked=state.candidateLock;return{...locked,price:n(q?.price)??locked.price,bid:n(q?.bid),ask:n(q?.ask),updatedAt:iso(now),candidateLocked:true,rawStatus:m?.status??null,rawReason:m?.reason??null};}\n";
  source=source.replace(candidateAnchor,candidateFns+candidateAnchor);
}


// Multi-model confluence upgrade: preserve HTF history/OHLC, execute on 1m/5m ICT structure,
// keep TP1/TP2 close, and size risk by lot.
{
  const oldNormalize="function normalize(){const cutoff=Date.now()-3*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-2400);}";
  const newNormalize="function normalize(){const cutoff=Date.now()-96*60*60_000,buckets=new Map();for(const x of state.samples){const t=n(x.t),close=n(x.close??x.p??x.price);if(t==null||close==null||close<=0||t<cutoff)continue;const key=Math.floor(t/60000)*60000,open=n(x.open)??close,high=n(x.high)??close,low=n(x.low)??close,bid=n(x.bid),ask=n(x.ask),volume=n(x.volume),old=buckets.get(key);if(!old){const row={...x,t:key,p:close,price:close,open,high,low,close};if(bid!=null)row.bid=bid;if(ask!=null)row.ask=ask;if(volume!=null&&volume>=0)row.volume=volume;buckets.set(key,row);}else{old.high=Math.max(n(old.high)??n(old.close)??close,high);old.low=Math.min(n(old.low)??n(old.close)??close,low);old.close=close;old.p=close;old.price=close;if(bid!=null)old.bid=bid;if(ask!=null)old.ask=ask;if(volume!=null&&volume>=0)old.volume=volume;}}state.samples=[...buckets.values()].sort((a,b)=>a.t-b.t).slice(-6500);}";
  if(!source.includes(oldNormalize))throw new Error('confluence patch: normalize anchor missing');
  source=source.replace(oldNormalize,newNormalize);

  const oldAdd="function add(t,p,bid=p,ask=p){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;state.samples.push({t,p,price:p,bid:n(bid)??p,ask:n(ask)??p});}";
  const newAdd="function add(t,p,bid=p,ask=p,ohlc=null,volume=null){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;const row={t,p,price:p,bid:n(bid)??p,ask:n(ask)??p};if(ohlc&&[ohlc.open,ohlc.high,ohlc.low,ohlc.close].every(v=>n(v)!=null)){row.open=n(ohlc.open);row.high=n(ohlc.high);row.low=n(ohlc.low);row.close=n(ohlc.close);row.p=row.close;row.price=row.close;}const vol=n(volume);if(vol!=null&&vol>=0)row.volume=vol;state.samples.push(row);}";
  if(!source.includes(oldAdd))throw new Error('confluence patch: add anchor missing');
  source=source.replace(oldAdd,newAdd);

  source=source.replace("const t=n(v[0]),close=n(v[4]);","const t=n(v[0]),open=n(v[1]),high=n(v[2]),low=n(v[3]),close=n(v[4]),volume=n(v[5]);");
  source=source.replace("add(ms,close,close,close);","add(ms,close,close,close,{open,high,low,close},volume);");
  source=source.replace("send('create_series',[cs,'s1','s1','symbol_1','1',180]);","send('create_series',[cs,'s1','s1','symbol_1','1',5000]);");

  const validStart=source.indexOf("function validLevels("),validEnd=source.indexOf("\nfunction entryPx",validStart);
  if(validStart<0||validEnd<0)throw new Error('confluence patch: validLevels anchor missing');
  const validFn="function validLevels(m){const s=m.candidateAction,lo=n(m.entryLow),hi=n(m.entryHigh),sl=n(m.stopLoss),t=[m.target1,m.target2,m.target3,m.target4].map(n);if(!['BUY','SELL'].includes(s)||lo==null||hi==null||sl==null||lo<=0||hi<=0||sl<=0||lo>hi||t[0]==null)return false;if(s==='BUY'&&!(sl<lo&&t[0]>hi))return false;if(s==='SELL'&&!(sl>hi&&t[0]<lo))return false;let prev=t[0];for(let i=1;i<t.length;i++){if(t[i]==null)continue;if(s==='BUY'&&t[i]<=prev)return false;if(s==='SELL'&&t[i]>=prev)return false;prev=t[i];}return true;}";
  source=source.slice(0,validStart)+validFn+source.slice(validEnd);

  const stopStart=source.indexOf("function structuralStop("),stopEnd=source.indexOf("\nfunction m5Bucket",stopStart);
  if(stopStart<0||stopEnd<0)throw new Error('confluence patch: structuralStop anchor missing');
  const stopFn="function structuralStop(side,entry,modelStop,now=Date.now()){const policy=volatilityPolicy(now),stop=n(modelStop);if(stop==null||!Number.isFinite(entry))return{ok:false,reason:'INVALID_MOMENTUM_STOP',policy};if(side==='BUY'&&stop>=entry)return{ok:false,reason:'INVALID_MOMENTUM_STOP_SIDE',policy};if(side==='SELL'&&stop<=entry)return{ok:false,reason:'INVALID_MOMENTUM_STOP_SIDE',policy};const risk=Math.abs(entry-stop);if(risk<.45)return{ok:false,reason:'MOMENTUM_STOP_TOO_TIGHT',stop:round(stop,3),risk:round(risk,3),policy};return{ok:true,stop:round(stop,3),risk:round(risk,3),swing:null,buffer:0,minDistance:0,policy,source:'ICT_ORIGIN_TO_LIQUIDITY_MODEL'};}";
  source=source.slice(0,stopStart)+stopFn+source.slice(stopEnd);

  source=source.replace("if(risk>policy.maxRisk)return{ok:false,reason:'STOP_TOO_WIDE_FOR_VOLATILITY',risk,reward,rr,policy};","");

  const m5Anchor="const M5_ENTRY_WINDOW_MS=Math.max(60000,Math.min(180000,Number(process.env.GOLD_M5_ENTRY_WINDOW_MS||150000)));";
  if(!source.includes(m5Anchor))throw new Error('confluence patch: config anchor missing');
  source=source.replace(m5Anchor,m5Anchor+"\nconst XAU_CONTRACT_SIZE=Math.max(1,Number(process.env.XAU_CONTRACT_SIZE||100));\nconst XAU_LOT_STEP=Math.max(.001,Number(process.env.XAU_LOT_STEP||.01));\nconst XAU_ACCOUNT_BALANCE_USD=Math.max(1,Number(process.env.XAU_ACCOUNT_BALANCE_USD||50));\nconst XAU_SAFE_RISK_USD=Math.max(1,Number(process.env.XAU_SAFE_RISK_USD||5));");

  const dayAnchor="const RIYADH_DAY_FORMATTER=";
  const dayAt=source.indexOf(dayAnchor);
  if(dayAt<0)throw new Error('confluence patch: day formatter anchor missing');
  const lotFn="function goldLotForRisk(entry,stop,riskUsd){const distance=Math.abs(Number(entry)-Number(stop));if(!(distance>0)||!(riskUsd>0))return 0;const raw=riskUsd/(distance*XAU_CONTRACT_SIZE),steps=Math.floor((raw+1e-12)/XAU_LOT_STEP);return steps>0?Number((steps*XAU_LOT_STEP).toFixed(3)):0;}\nfunction goldLotSizing(entry,stop){const stopDistance=Math.abs(Number(entry)-Number(stop)),safeLot=goldLotForRisk(entry,stop,XAU_SAFE_RISK_USD),recommendedLot=stopDistance>0?(safeLot>0?safeLot:XAU_LOT_STEP):0,actualRisk=recommendedLot>0?stopDistance*XAU_CONTRACT_SIZE*recommendedLot:null;return{allowed:stopDistance>0,balanceUsd:XAU_ACCOUNT_BALANCE_USD,safeRiskUsd:XAU_SAFE_RISK_USD,maxRiskUsd:null,hardDollarRiskCap:false,contractSize:XAU_CONTRACT_SIZE,lotStep:XAU_LOT_STEP,stopDistance:round(stopDistance,3),safeLot:round(safeLot,3),maxLot:null,recommendedLot:round(recommendedLot,3),actualRiskUsd:round(actualRisk,2),riskAdvisoryOnly:true};}\n";
  source=source.slice(0,dayAt)+lotFn+source.slice(dayAt);

  const oldTargets="const policyForTargets=volatilityPolicy(now),liveRisk=Math.abs(p-sl),direction=side==='BUY'?1:-1;\n const tp1=round(p+direction*Math.max(1.75,liveRisk*1.35,(policyForTargets.atr1||1)*1.80),3);\n const tp2=round(p+direction*Math.max(3.50,liveRisk*2.00,(policyForTargets.atr1||1)*3.00),3);\n const tp3=round(p+direction*Math.max(5.50,liveRisk*2.80,(policyForTargets.atr1||1)*4.50),3);\n const tp4=round(p+direction*Math.max(8.50,liveRisk*3.80,(policyForTargets.atr1||1)*6.50),3);";
  const newTargets="const tp1=n(m.target1),tp2=n(m.target2),tp3=n(m.target3),tp4=n(m.target4),liquidityRisk=Math.abs(p-sl),liquidityReward=side==='BUY'?tp1-p:p-tp1,liquidityRR=liquidityRisk>0?liquidityReward/liquidityRisk:0,minTargetMove=Math.max(1.25,(stopPlan?.policy?.atr1||1)*1.10);\n if(tp1==null||liquidityReward<minTargetMove||liquidityRR<.50){state.lastEntryGuard={atMs:now,reason:liquidityReward<minTargetMove?'TARGET_ROOM_TOO_SMALL':'TP1_BELOW_0_5R',side,price:round(p,3),stop:round(sl,3),target1:round(tp1,3),minTargetMove:round(minTargetMove,2),targetDistance:round(liquidityReward,2),liveRR:round(liquidityRR,2)};return;}\n const lotSizing=goldLotSizing(p,sl);";
  if(!source.includes(oldTargets))throw new Error('confluence patch: target generator anchor missing');
  source=source.replace(oldTargets,newTargets);

  source=source.replace("originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,structuralStopPlan:stopPlan,target1:tp1,target2:tp2,target3:tp3,target4:tp4,","originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,structuralStopPlan:stopPlan,lotSizing,confluence:m.confluence||null,ict:m.ict||null,luxalgoAtEntry:m.luxalgo||null,targetLabels:m.targetLabels||[],target1:tp1,target2:tp2,target3:tp3,target4:tp4,");
  source=source.replace("reason:\`CONFIRMED GOLD SETUP — \${Number(m.confidence)||0}% confidence; 5m structure stop + \${round(stopPlan.buffer,2)}$ buffer; 5m execution + 15m context with 1m used only for timing; USD news guard clear; \${round(viability.rr,2)}R to TP1, risk \${round(viability.risk,2)}$, ATR1 \${viability.policy.atr1}$; max \${MAX_DAILY_SIGNALS}/day; Telegram only, AI off\`","reason:\`CONFLUENCE CONFIRMED — \${m.strategy||'MULTI_MODEL_CONFLUENCE'}; score \${Number(m.confidence)||0}/100; BUY \${Number(m.confluence?.scores?.BUY||0)} / SELL \${Number(m.confluence?.scores?.SELL||0)}; target \${m.targetLabels?.[0]||'TP1'} \${round(tp1,2)}; room \${round(Math.abs(tp1-p),2)}$; live RR \${round(liquidityRR,2)}R; SL \${round(sl,2)}; lot \${lotSizing.recommendedLot||0}\`");

  source=source.replace("const result=outcome==='TP4'?'WIN':realizedR>0.05?'WIN':realizedR>=-.05?'BREAKEVEN':'LOSS';","const result=String(outcome).startsWith('TP')?'WIN':realizedR>0.05?'WIN':realizedR>=-.05?'BREAKEVEN':'LOSS';");
  const oldManage="if(s.targetHits[2])applyManagement(s,3,now);\n if(s.targetHits[3])return close('TP4',s.target4,now,{stopType:'TARGET'});";
  const newManage="if(s.targetHits[2])applyManagement(s,3,now);\n const targetList=[s.target1,s.target2,s.target3,s.target4],lastTargetIndex=targetList.reduce((last,v,i)=>n(v)!=null?i:last,-1);\n if(lastTargetIndex>=0&&s.targetHits[lastTargetIndex])return close('TP'+(lastTargetIndex+1),targetList[lastTargetIndex],now,{stopType:'TARGET'});";
  if(!source.includes(oldManage))throw new Error('confluence patch: management anchor missing');
  source=source.replace(oldManage,newManage);
}


// Session context only: scan the full gold market day. London/New York labels are context, never a hard entry gate.
{
  const stateAnchor="lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null,candidateLock:null,candidateLockBucket:null};";
  if(!source.includes(stateAnchor))throw new Error('opening-session patch: state anchor missing');
  source=source.replace(stateAnchor,"lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null,candidateLock:null,candidateLockBucket:null,openSessionKey:null,openSessionSignalCount:0};");

  const configAnchor="const XAU_SAFE_RISK_USD=Math.max(1,Number(process.env.XAU_SAFE_RISK_USD||5));";
  if(!source.includes(configAnchor))throw new Error('opening-session patch: config anchor missing');
  source=source.replace(configAnchor,configAnchor+"\nconst OPENING_WINDOW_MIN=Math.max(30,Math.min(120,Number(process.env.GOLD_OPENING_WINDOW_MIN||90)));\nconst MAX_OPENING_SESSION_SIGNALS=Math.max(1,Math.min(2,Number(process.env.GOLD_MAX_SIGNALS_PER_OPEN||2)));");

  const dayAnchor="const RIYADH_DAY_FORMATTER=";
  const dayAt=source.indexOf(dayAnchor);
  if(dayAt<0)throw new Error('opening-session patch: day anchor missing');
  const openingFn="const GOLD_OPENING_SESSIONS=[{id:'LONDON',timeZone:'Europe/London',startMinute:8*60},{id:'NEW_YORK_GOLD',timeZone:'America/New_York',startMinute:8*60+20}];\nfunction marketClock(ms,timeZone){const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(ms));const get=t=>parts.find(p=>p.type===t)?.value||'';return{date:get('year')+'-'+get('month')+'-'+get('day'),weekday:get('weekday'),minuteOfDay:Number(get('hour'))*60+Number(get('minute'))};}\nfunction refreshOpeningSession(now){for(const def of GOLD_OPENING_SESSIONS){const c=marketClock(now,def.timeZone);if(['Sat','Sun'].includes(c.weekday))continue;if(c.minuteOfDay>=def.startMinute&&c.minuteOfDay<def.startMinute+OPENING_WINDOW_MIN){const key=def.id+':'+c.date;if(state.openSessionKey!==key){state.openSessionKey=key;state.openSessionSignalCount=0;}return{id:def.id,key,timeZone:def.timeZone,startMinute:def.startMinute,windowMin:OPENING_WINDOW_MIN};}}return null;}\n";
  source=source.slice(0,dayAt)+openingFn+source.slice(dayAt);

  const maybeAnchor="function maybeCreate(m,q,now){\n refreshDailyQuota(now);\n state.lastEntryGuard=null;";
  if(!source.includes(maybeAnchor))throw new Error('opening-session patch: maybeCreate anchor missing');
  source=source.replace(maybeAnchor,"function maybeCreate(m,q,now){\n refreshDailyQuota(now);\n const openSession=refreshOpeningSession(now);\n state.lastEntryGuard=null;");

  const signalAnchor="tradeStyle:'MULTI_MODEL_CONFLUENCE',priceAction:m.priceAction||null,importantCandles:m.importantCandles||null,technicalRead:m.technicalRead||null,maxDailySignals:MAX_DAILY_SIGNALS,dailySignalNumber:state.dailySignalCount+1,newsRiskAtEntry:state.lastNewsRisk,";
  if(!source.includes(signalAnchor))throw new Error('opening-session patch: signal anchor missing');
  source=source.replace(signalAnchor,"tradeStyle:'MULTI_MODEL_CONFLUENCE',priceAction:m.priceAction||null,importantCandles:m.importantCandles||null,technicalRead:m.technicalRead||null,openingSession:openSession?.id||m?.ict?.session||'ALL_MARKET',maxDailySignals:MAX_DAILY_SIGNALS,dailySignalNumber:state.dailySignalCount+1,newsRiskAtEntry:state.lastNewsRisk,");

  const countAnchor="state.dailySignalCount+=1;state.lastSignalAtMs=now;";
  if(!source.includes(countAnchor))throw new Error('opening-session patch: count anchor missing');
  source=source.replace(countAnchor,"state.dailySignalCount+=1;state.lastSignalAtMs=now;");
}

{
  const catchAnchor="}catch(e){state.lastError=String(e?.message||e);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});";
  if(source.includes(catchAnchor))source=source.replace(catchAnchor,"}catch(e){state.lastError=String(e?.message||e);console.error('[signal-engine-error]',e?.stack||e);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});");
}


{
  const htfStateAnchor="lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null,candidateLock:null,candidateLockBucket:null,openSessionKey:null,openSessionSignalCount:0};";
  if(!source.includes(htfStateAnchor))throw new Error('top-down patch: state anchor missing');
  source=source.replace(htfStateAnchor,"lastReconnectAttempt:0,dailySignalDate:null,dailySignalCount:0,lastSignalAtMs:0,lastNewsRisk:null,candidateLock:null,candidateLockBucket:null,openSessionKey:null,openSessionSignalCount:0,higherTimeframes:{D1:[],D2:[],W1:[],MN1:[]}};");

  const ingestStart=source.indexOf("function ingestTimescale(msg){"),ingestEnd=source.indexOf("\nfunction connectTradingView()",ingestStart);
  if(ingestStart<0||ingestEnd<0)throw new Error('top-down patch: ingestTimescale anchor missing');
  const ingestFn="function mergeHigherTimeframe(kind,rows,maxBars){const merged=new Map((state.higherTimeframes?.[kind]||[]).map(b=>[b.t,b]));for(const row of rows){const v=row?.v;if(!Array.isArray(v)||v.length<5)continue;const t=n(v[0]),open=n(v[1]),high=n(v[2]),low=n(v[3]),close=n(v[4]),volume=n(v[5]);if(t==null||![open,high,low,close].every(Number.isFinite)||close<=0)continue;const ms=t>1e12?t:t*1000;merged.set(ms,{t:ms,open,high,low,close,volume:volume!=null&&volume>=0?volume:null});}state.higherTimeframes[kind]=[...merged.values()].sort((a,b)=>a.t-b.t).slice(-maxBars);}\nfunction ingestTimescale(msg){\n const payload=msg?.p?.[1];if(!payload||typeof payload!=='object')return;\n let newestT=0,newestClose=null,added=0;\n for(const [seriesId,series] of Object.entries(payload)){\n  const rows=Array.isArray(series?.s)?series.s:[];\n  if(seriesId==='sd1'){mergeHigherTimeframe('D1',rows,450);continue;}\n  if(seriesId==='s2d'){mergeHigherTimeframe('D2',rows,260);continue;}\n  if(seriesId==='sw1'){mergeHigherTimeframe('W1',rows,200);continue;}\n  if(seriesId==='sm1'){mergeHigherTimeframe('MN1',rows,96);continue;}\n  if(seriesId!=='s1')continue;\n  for(const row of rows){const v=row?.v;if(!Array.isArray(v)||v.length<5)continue;const t=n(v[0]),open=n(v[1]),high=n(v[2]),low=n(v[3]),close=n(v[4]),volume=n(v[5]);if(t==null||close==null||close<=0)continue;const ms=t>1e12?t:t*1000;add(ms,close,close,close,{open,high,low,close},volume);added++;if(ms>=newestT){newestT=ms;newestClose=close;}}\n }\n if(added)normalize();\n if(newestClose!=null&&!freshQuote(state.quote)){const now=Date.now();state.quote={price:newestClose,bid:newestClose,ask:newestClose,t:newestT,provider:'TRADINGVIEW_OANDA_BAR',degraded:true,symbol:TV_SYMBOL};state.lastTvAt=now;state.lastError=null;if(!state.loggedQuote){state.loggedQuote=true;console.log('[tv-bar] first chart fallback '+TV_SYMBOL+' '+newestClose);}}\n}";
  source=source.slice(0,ingestStart)+ingestFn+source.slice(ingestEnd);

  const sessionAnchor="const cs=rid('cs'),qs=rid('qs');";
  if(!source.includes(sessionAnchor))throw new Error('top-down patch: chart session anchor missing');
  source=source.replace(sessionAnchor,"const cs=rid('cs'),csD=rid('csd'),cs2D=rid('cs2d'),csW=rid('csw'),csM=rid('csm'),qs=rid('qs');");
  const seriesAnchor="send('create_series',[cs,'s1','s1','symbol_1','1',5000]);";
  if(!source.includes(seriesAnchor))throw new Error('top-down patch: 1m series anchor missing');
  const htfSeries="send('chart_create_session',[csD,'']);send('switch_timezone',[csD,'Etc/UTC']);send('resolve_symbol',[csD,'symbol_d1',qsym]);send('create_series',[csD,'sd1','sd1','symbol_d1','1D',450]);send('chart_create_session',[cs2D,'']);send('switch_timezone',[cs2D,'Etc/UTC']);send('resolve_symbol',[cs2D,'symbol_2d',qsym]);send('create_series',[cs2D,'s2d','s2d','symbol_2d','2D',260]);send('chart_create_session',[csW,'']);send('switch_timezone',[csW,'Etc/UTC']);send('resolve_symbol',[csW,'symbol_w1',qsym]);send('create_series',[csW,'sw1','sw1','symbol_w1','1W',200]);send('chart_create_session',[csM,'']);send('switch_timezone',[csM,'Etc/UTC']);send('resolve_symbol',[csM,'symbol_mn1',qsym]);send('create_series',[csM,'sm1','sm1','symbol_mn1','1M',96]);";
  source=source.replace(seriesAnchor,seriesAnchor+htfSeries);

  const modelAnchor="const rawModel=analyzeGoldSignal(state.samples,q.price,now);";
  if(!source.includes(modelAnchor))throw new Error('top-down patch: model call anchor missing');
  source=source.replace(modelAnchor,"const rawModel=analyzeGoldSignal(state.samples,q.price,now,state.higherTimeframes);");

  const responseAnchor="signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'MULTI_MODEL_CONFLUENCE',newsRisk,volatilityPolicy:policy,";
  if(!source.includes(responseAnchor))throw new Error('top-down patch: response anchor missing');
  source=source.replace(responseAnchor,"signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:model.multiTimeframe||model.confluence?.multiTimeframe||state.signal?.multiTimeframe||null,newsRisk,volatilityPolicy:policy,");

  const signalAnchor="tradeStyle:'MULTI_MODEL_CONFLUENCE',priceAction:m.priceAction||null,importantCandles:m.importantCandles||null,technicalRead:m.technicalRead||null,openingSession:openSession?.id||m?.ict?.session||'ALL_MARKET',";
  if(!source.includes(signalAnchor))throw new Error('top-down patch: signal payload anchor missing');
  source=source.replace(signalAnchor,"tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:m.multiTimeframe||m.confluence?.multiTimeframe||null,priceAction:m.priceAction||null,importantCandles:m.importantCandles||null,technicalRead:m.technicalRead||null,openingSession:openSession?.id||m?.ict?.session||'ALL_MARKET',");

  source=source.replace("const BUILD='site-signal-noai-v61-important-candles';","const BUILD='site-signal-noai-v62-top-down-mtf';");
}



// M15 session high/low context for Telegram and site consumers.
// DST-aware through each market's native IANA timezone.
{
  const dayAnchor="const RIYADH_DAY_FORMATTER=";
  const dayAt=source.indexOf(dayAnchor);
  if(dayAt<0)throw new Error('session-levels patch: day anchor missing');
  const sessionFns="let goldSessionLevelsCache={at:0,data:null};\nconst GOLD_SESSION_LEVEL_DEFS=[{id:'TOKYO',label:'TOKYO',icon:'🇯🇵',timeZone:'Asia/Tokyo',startMinute:9*60,endMinute:15*60,startLocal:'09:00',endLocal:'15:00'},{id:'LONDON',label:'LONDON',icon:'🇬🇧',timeZone:'Europe/London',startMinute:8*60,endMinute:16*60+30,startLocal:'08:00',endLocal:'16:30'},{id:'NEW_YORK',label:'NEW YORK',icon:'🇺🇸',timeZone:'America/New_York',startMinute:8*60+15,endMinute:13*60+30,startLocal:'08:15',endLocal:'13:30'}];\nfunction session15Bars(now=Date.now()){const cutoff=now-96*60*60_000,buckets=new Map();for(const x of state.samples){const t=n(x.t),close=n(x.close??x.p??x.price);if(t==null||close==null||close<=0||t<cutoff||t>now+60_000)continue;const key=Math.floor(t/900000)*900000,open=n(x.open)??close,high=n(x.high)??close,low=n(x.low)??close,b=buckets.get(key);if(!b)buckets.set(key,{t:key,open,high,low,close});else{b.high=Math.max(b.high,high);b.low=Math.min(b.low,low);b.close=close;}}return[...buckets.values()].sort((a,b)=>a.t-b.t);}\nfunction goldSessionLevels(now=Date.now()){if(goldSessionLevelsCache.data&&now-goldSessionLevelsCache.at<15000)return goldSessionLevelsCache.data;const bars=session15Bars(now),sessions={};for(const def of GOLD_SESSION_LEVEL_DEFS){const days=new Map();for(const b of bars){const c=marketClock(b.t,def.timeZone);if(['Sat','Sun'].includes(c.weekday)||c.minuteOfDay<def.startMinute||c.minuteOfDay>=def.endMinute)continue;const arr=days.get(c.date)||[];arr.push(b);days.set(c.date,arr);}const dates=[...days.keys()].sort();const date=dates.at(-1)||null,rows=date?days.get(date)||[]:[],clock=marketClock(now,def.timeZone);const high=rows.length?Math.max(...rows.map(x=>x.high)):null,low=rows.length?Math.min(...rows.map(x=>x.low)):null;let status='PENDING';if(date){if(date<clock.date)status='CLOSED';else if(date===clock.date&&clock.minuteOfDay>=def.endMinute)status='CLOSED';else if(date===clock.date&&clock.minuteOfDay>=def.startMinute)status='OPEN';}sessions[def.id]={id:def.id,label:def.label,icon:def.icon,date,status,timeZone:def.timeZone,startLocal:def.startLocal,endLocal:def.endLocal,high:round(high,3),low:round(low,3),range:high!=null&&low!=null?round(high-low,3):null,bars:rows.length,basis:'M15'};}const lastClosedM15=completedTimeframeBars(900000,now).at(-1)||null,lastClosedM5=completedTimeframeBars(300000,now).at(-1)||null;const data={basis:'M15',updatedAt:iso(now),lastClosedM15:lastClosedM15?{t:lastClosedM15.t,open:round(lastClosedM15.open,3),high:round(lastClosedM15.high,3),low:round(lastClosedM15.low,3),close:round(lastClosedM15.close,3)}:null,lastClosedM5:lastClosedM5?{t:lastClosedM5.t,open:round(lastClosedM5.open,3),high:round(lastClosedM5.high,3),low:round(lastClosedM5.low,3),close:round(lastClosedM5.close,3)}:null,sessions};goldSessionLevelsCache={at:now,data};return data;}\n";
  source=source.slice(0,dayAt)+sessionFns+source.slice(dayAt);

  const responseAnchor="signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:model.multiTimeframe||model.confluence?.multiTimeframe||state.signal?.multiTimeframe||null,newsRisk,volatilityPolicy:policy,";
  if(!source.includes(responseAnchor))throw new Error('session-levels patch: response anchor missing');
  source=source.replace(responseAnchor,"signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,dailySignalCount:state.dailySignalCount,maxDailySignals:MAX_DAILY_SIGNALS,tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:model.multiTimeframe||model.confluence?.multiTimeframe||state.signal?.multiTimeframe||null,sessionLevels:goldSessionLevels(now),newsRisk,volatilityPolicy:policy,");

  source=source.replace("const BUILD='site-signal-noai-v62-top-down-mtf';","const BUILD='site-signal-noai-v63-session-levels';");
}


{
  // Final runtime contract: only the ICT external-liquidity model may own a trade.
  const signalStyle="tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:m.multiTimeframe||m.confluence?.multiTimeframe||null,";
  if(!source.includes(signalStyle))throw new Error('ICT-only patch: signal tradeStyle anchor missing');
  source=source.replace(signalStyle,"tradeStyle:m.tradeStyle||'ICT_ONLY_EXTERNAL_LIQUIDITY',multiTimeframe:m.multiTimeframe||m.confluence?.multiTimeframe||null,");

  const responseStyle="tradeStyle:'MULTI_MODEL_CONFLUENCE',multiTimeframe:model.multiTimeframe||model.confluence?.multiTimeframe||state.signal?.multiTimeframe||null,sessionLevels:";
  if(!source.includes(responseStyle))throw new Error('ICT-only patch: response tradeStyle anchor missing');
  source=source.replace(responseStyle,"tradeStyle:state.signal?.tradeStyle||model.tradeStyle||'ICT_ONLY_EXTERNAL_LIQUIDITY',multiTimeframe:model.multiTimeframe||model.confluence?.multiTimeframe||state.signal?.multiTimeframe||null,sessionLevels:");

  const oldReason="reason:\`CONFLUENCE CONFIRMED — \${m.strategy||'MULTI_MODEL_CONFLUENCE'}; score \${Number(m.confidence)||0}/100; BUY \${Number(m.confluence?.scores?.BUY||0)} / SELL \${Number(m.confluence?.scores?.SELL||0)}; target \${m.targetLabels?.[0]||'TP1'} \${round(tp1,2)}; room \${round(Math.abs(tp1-p),2)}$; live RR \${round(liquidityRR,2)}R; SL \${round(sl,2)}; lot \${lotSizing.recommendedLot||0}\`";
  const newReason="reason:\`ICT ONLY CONFIRMED — external \${String(m.ict?.legSweep?.name||'LIQUIDITY').toUpperCase()} → MSS/displacement → FVG/OB; confidence \${Number(m.confidence)||0}/100; target \${m.targetLabels?.[0]||'EXTERNAL_LIQUIDITY'} \${round(tp1,2)}; room \${round(Math.abs(tp1-p),2)}$; live RR \${round(liquidityRR,2)}R; SL \${round(sl,2)}; lot \${lotSizing.recommendedLot||0}\`";
  if(!source.includes(oldReason))throw new Error('ICT-only patch: active-signal reason anchor missing');
  source=source.replace(oldReason,newReason);

  source=source.replace("const BUILD='site-signal-noai-v63-session-levels';","const BUILD='site-signal-noai-v64-ict-external-only';");
}


{
  // A fresh, independently confirmed ICT setup must not be silently lost to the
  // generic post-trade cooldown. Same-side-after-SL and same-setup lockouts remain.
  const cooldownGate="if(state.signal||now<state.cooldownUntil||!freshQuote(q,now)||m.status!=='CANDIDATE'||Number(m.confidence)<MIN_CONFIDENCE||!validLevels(m))return;";
  if(!source.includes(cooldownGate))throw new Error('ict-entry-unblock patch: cooldown gate missing');
  source=source.replace(cooldownGate,"if(state.signal||!freshQuote(q,now)||m.status!=='CANDIDATE'||Number(m.confidence)<MIN_CONFIDENCE||!validLevels(m))return;");

  // Do not fail silently when a locked plan is waiting for its actual entry zone.
  const rangeGate="if(!inRange(p,lo,hi))return;";
  if(!source.includes(rangeGate))throw new Error('ict-entry-unblock patch: entry-range gate missing');
  source=source.replace(rangeGate,"if(!inRange(p,lo,hi)){state.lastEntryGuard={atMs:now,reason:'WAITING_ENTRY_RANGE',side,price:round(p,3),entryLow:round(lo,3),entryHigh:round(hi,3),candidateLocked:Boolean(m.candidateLocked),entryMode:m?.ict?.entryMode||null};return;}");

  source=source.replace("const BUILD='site-signal-noai-v64-ict-external-only';","const BUILD='site-signal-noai-v66-stop-advisory-only';");
}




{
  // Preserve the existing ICT candidate/confidence contract. Only relax the literal entry-zone
  // touch when closed M5 candles prove acceptance beyond a CLOSED external session level:
  // decisive break close -> next M5 no-reclaim directional hold.
  const maybeCreateAnchor="function maybeCreate(m,q,now){\n refreshDailyQuota(now);";
  if(!source.includes(maybeCreateAnchor))throw new Error('momentum-acceptance patch: maybeCreate anchor missing');
  const helper="function sessionContinuationMomentumAccepted(side,now=Date.now()){if(!['BUY','SELL'].includes(side))return false;const rows=Object.values(goldSessionLevels(now)?.sessions||{}).filter(x=>String(x?.status||'').toUpperCase()==='CLOSED');const bars=completedTimeframeBars(300000,now).slice(-6);if(!rows.length||bars.length<3)return false;for(const row of rows){const level=n(side==='BUY'?row?.high:row?.low);if(level==null)continue;for(let i=Math.max(1,bars.length-3);i<bars.length-1;i++){const prev=bars[i-1],first=bars[i],second=bars[i+1];if(!prev||!first||!second||second.t!==bars.at(-1).t)continue;const crossed=side==='BUY'?prev.close<=level+.10&&first.close>level+.25:prev.close>=level-.10&&first.close<level-.25;const firstDirectional=side==='BUY'?first.close>=first.open:first.close<=first.open;const noReclaim=side==='BUY'?second.low>level:second.high<level;const held=side==='BUY'?second.close>level:second.close<level;const secondDirectional=side==='BUY'?second.close>=second.open:second.close<=second.open;if(crossed&&firstDirectional&&noReclaim&&held&&secondDirectional)return{id:row.id,date:row.date,level,firstT:first.t,holdT:second.t};}}return false;}\n\nfunction coreIctRetestExecutionAccepted(m,p,now=Date.now()){const ict=m?.ict||{},side=m?.candidateAction,retest=ict?.m5MssRetest,level=n(retest?.level),t=n(retest?.t);if(!['BUY','SELL'].includes(side)||!ict?.coreIctEntryReady||!ict?.hasSweep||!ict?.m5MssEvent?.mss||retest?.confirmed!==true||level==null||t==null||p==null)return false;const age=now-t;if(age<0||age>15*60_000)return false;const held=side==='BUY'?p>level:p<level;if(!held)return false;const entry=n(m?.entry),tp1=n(m?.target1),path=entry!=null&&tp1!=null?Math.abs(tp1-entry):0,travel=entry!=null?(side==='BUY'?p-entry:entry-p):0,consumed=path>0?Math.max(0,travel)/path:1;return consumed<.65?{level:round(level,3),retestT:t,ageMs:age,pathConsumed:round(consumed,3)}:false;}\n";
  source=source.replace(maybeCreateAnchor,helper+maybeCreateAnchor);

  const rangeGate="if(!inRange(p,lo,hi)){state.lastEntryGuard={atMs:now,reason:'WAITING_ENTRY_RANGE',side,price:round(p,3),entryLow:round(lo,3),entryHigh:round(hi,3),candidateLocked:Boolean(m.candidateLocked),entryMode:m?.ict?.entryMode||null};return;}";
  if(!source.includes(rangeGate))throw new Error('momentum-acceptance patch: entry-range guard missing');
  source=source.replace(rangeGate,"const momentumAcceptance=sessionContinuationMomentumAccepted(side,now);const momentumAccepted=Boolean(momentumAcceptance);const coreRetestAcceptance=coreIctRetestExecutionAccepted(m,p,now);const coreRetestAccepted=Boolean(coreRetestAcceptance);if(!inRange(p,lo,hi)&&!momentumAccepted&&!coreRetestAccepted){state.lastEntryGuard={atMs:now,reason:'WAITING_ENTRY_RANGE',side,price:round(p,3),entryLow:round(lo,3),entryHigh:round(hi,3),candidateLocked:Boolean(m.candidateLocked),entryMode:m?.ict?.entryMode||null,momentumAcceptance:'WAITING',coreRetestAcceptance:'WAITING'};return;}");

  const payloadAnchor="confidence:Number(m.confidence)||0,signalConfidence:Number(m.confidence)||0,entry:p,entryLow:lo,entryHigh:hi,";
  if(!source.includes(payloadAnchor))throw new Error('momentum-acceptance patch: signal payload anchor missing');
  source=source.replace(payloadAnchor,"confidence:Number(m.confidence)||0,signalConfidence:Number(m.confidence)||0,entryConfirmation:coreRetestAccepted?'M5_MSS_RETEST_HOLD':momentumAccepted?'M5_MOMENTUM_ACCEPTANCE':'ENTRY_RANGE_TOUCH',coreRetestAcceptance:coreRetestAcceptance||null,momentumAcceptance:momentumAcceptance||null,entry:p,entryLow:lo,entryHigh:hi,");

  source=source.replace("const BUILD='site-signal-noai-v66-stop-advisory-only';","const BUILD='site-signal-noai-v69-core-retest-entry';");
}

// News is advisory only: a complete ICT gate must not be suppressed by calendar state.
source=source.replace("const BUILD='site-signal-noai-v69-core-retest-entry';","const BUILD='site-signal-noai-v70-ict-confirmation-pipeline';");


// Authoritative lifecycle snapshot: once the engine promotes an ICT setup to ACTIVE,
// freeze the confirmed entry plan so every downstream layer reads the same trade state.
{
  const confirmedPush="state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);state.dailySignalCount+=1;state.lastSignalAtMs=now;state.candidateLock=null;state.candidateLockBucket=null;";
  if(!source.includes(confirmedPush))throw new Error('authoritative trade-state patch: confirmed signal anchor missing');
  const snapshot="state.signal.tradeState={version:'XAU_TRADE_STATE_V1',lifecycle:'CONFIRMED',active:true,status:'ACTIVE',signalId:state.signal.signalId,setupId:state.signal.setupId||null,side,entry:round(p,3),entryLow:round(lo,3),entryHigh:round(hi,3),initialStopLoss:round(sl,3),targets:[tp1,tp2,tp3,tp4].map(v=>round(v,3)),sweptName:m?.ict?.legSweep?.name||m?.ict?.sweep?.name||null,sweptAtMs:n(m?.ict?.legSweep?.t??m?.ict?.sweep?.t),mssAtMs:n(m?.ict?.m5MssEvent?.t),retestAtMs:n(m?.ict?.m5MssRetest?.t),sweptLevel:round(m?.ict?.legSweep?.level??m?.ict?.sweep?.level,3),mssTrigger:round(m?.ict?.m5MssEvent?.level??m?.ict?.m5MssEvent?.trigger??(side==='BUY'?m?.ict?.m5MssEvent?.priorHigh:m?.ict?.m5MssEvent?.priorLow),3),m5RetestConfirmed:Boolean(m?.ict?.m5MssRetest?.confirmed),retestLevel:round(m?.ict?.m5MssRetest?.level,3),entryConfirmation:state.signal.entryConfirmation||null,confirmedAtMs:now,confirmedAt:iso(now),immutablePlan:true};";
  source=source.replace(confirmedPush,snapshot+confirmedPush);
  source=source.replace("const BUILD='site-signal-noai-v70-ict-confirmation-pipeline';","const BUILD='site-signal-noai-v71-authoritative-trade-state';");
}

// Persist the authoritative ACTIVE trade across worker restarts and hand it off
// from the previous Render deployment during zero-downtime deploys. This state is
// lifecycle data only; it never creates a new trade that was not already ACTIVE.
{
  source="import fs from 'node:fs';\n"+source;

  const utilAnchor="const n=v=>v!=null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;";
  if(!source.includes(utilAnchor))throw new Error('active persistence patch: utility anchor missing');
  const persistenceFns=[
    "const ACTIVE_TRADE_STATE_PATH=String(process.env.GOLD_ACTIVE_TRADE_STATE_PATH||'/tmp/gold-alpha-active-trade-state.json').trim();",
    "const ACTIVE_TRADE_MAX_AGE_MS=Math.max(60*60_000,Number(process.env.GOLD_ACTIVE_TRADE_MAX_AGE_MS||24*60*60_000));",
    "const HANDOFF_BASE_URL=String(process.env.APP_BASE_URL||'').trim().replace(/\\/+$/,'');",
    "let lastActivePersistAt=0;",
    "function activeStateEnvelope(now=Date.now()){return{version:'XAU_ACTIVE_STATE_V1',savedAtMs:now,dailySignalDate:state.dailySignalDate,dailySignalCount:state.dailySignalCount,lastSignalAtMs:state.lastSignalAtMs,signal:state.signal};}",
    "function persistActiveTradeState(now=Date.now(),force=false){if(!state.signal)return false;if(!force&&now-lastActivePersistAt<5000)return true;try{const tmp=ACTIVE_TRADE_STATE_PATH+'.tmp';fs.writeFileSync(tmp,JSON.stringify(activeStateEnvelope(now)),'utf8');fs.renameSync(tmp,ACTIVE_TRADE_STATE_PATH);lastActivePersistAt=now;return true;}catch(e){console.error('[active-trade-persist]',e?.message||e);return false;}}",
    "function clearPersistedActiveTradeState(){try{if(fs.existsSync(ACTIVE_TRADE_STATE_PATH))fs.unlinkSync(ACTIVE_TRADE_STATE_PATH);}catch(e){console.error('[active-trade-persist-clear]',e?.message||e);}}",
    "function restorableActiveSignal(s,now=Date.now()){const side=['BUY','SELL'].includes(s?.side)?s.side:null,status=String(s?.status||'').toUpperCase(),issued=n(s?.issuedAtMs)??Date.parse(s?.issuedAt||'');if(!side||!s?.signalId||s?.entered!==true||s?.triggered!==true||!['ACTIVE','MANAGING','CONFIRMED'].includes(status)||!Number.isFinite(issued)||issued>now+5000||now-issued>ACTIVE_TRADE_MAX_AGE_MS)return false;if(s?.tp4===true||s?.targetHits?.[3]===true)return false;return n(s?.entry??s?.triggerPrice)>0&&n(s?.stopLoss??s?.managedStopLoss)>0&&n(s?.target1)>0;}",
    "function sanitizedRestoredSignal(input){const s={...(input||{})};delete s.agentStack;delete s.agents;delete s.agentDecision;delete s.agentSchema;delete s.scenarioPlan;delete s.telegramBrief;return s;}",
    "function restoreActivePayload(payload,origin='LOCAL_STATE',now=Date.now()){const raw=payload?.signal||payload;if(!restorableActiveSignal(raw,now))return false;const s=sanitizedRestoredSignal(raw),side=s.side;state.signal={...s,status:'ACTIVE',action:'WAIT',candidateAction:side,side,executable:false,restoredFrom:origin,restoredAt:iso(now)};const snap=state.signal.tradeState&&typeof state.signal.tradeState==='object'?state.signal.tradeState:{};state.signal.tradeState={...snap,version:snap.version||'XAU_TRADE_STATE_V1',lifecycle:'CONFIRMED',active:true,status:'ACTIVE',signalId:state.signal.signalId,setupId:state.signal.setupId||snap.setupId||null,side,entry:round(state.signal.triggerPrice??state.signal.entry??snap.entry,3),entryLow:round(state.signal.entryLow??snap.entryLow,3),entryHigh:round(state.signal.entryHigh??snap.entryHigh,3),initialStopLoss:round(snap.initialStopLoss??state.signal.originalStopLoss??state.signal.stopLoss,3),managedStopLoss:round(state.signal.stopLoss??state.signal.managedStopLoss??snap.managedStopLoss,3),targets:[state.signal.target1,state.signal.target2,state.signal.target3,state.signal.target4].map(v=>round(v,3)),targetHits:Array.isArray(state.signal.targetHits)?[...state.signal.targetHits]:(Array.isArray(snap.targetHits)?[...snap.targetHits]:[false,false,false,false]),immutablePlan:true,restoredFrom:origin,restoredAt:iso(now)};if(payload?.dailySignalDate)state.dailySignalDate=payload.dailySignalDate;if(n(payload?.dailySignalCount)!=null)state.dailySignalCount=Math.max(state.dailySignalCount,n(payload.dailySignalCount));state.lastSignalAtMs=Math.max(state.lastSignalAtMs,n(payload?.lastSignalAtMs)??n(state.signal.issuedAtMs)??0);persistActiveTradeState(now,true);console.log('[active-trade-restore] '+origin+' '+side+' '+state.signal.signalId);return true;}",
    "function restoreLocalActiveTradeState(){try{if(!fs.existsSync(ACTIVE_TRADE_STATE_PATH))return false;const payload=JSON.parse(fs.readFileSync(ACTIVE_TRADE_STATE_PATH,'utf8'));if(restoreActivePayload(payload,'LOCAL_STATE'))return true;clearPersistedActiveTradeState();}catch(e){console.error('[active-trade-restore-local]',e?.message||e);clearPersistedActiveTradeState();}return false;}",
    "async function recoverPreviousDeployment(){if(state.signal||!HANDOFF_BASE_URL)return false;try{const url=HANDOFF_BASE_URL+'/api/auto-trade/signal?observe=1&handoff=1';const r=await fetch(url,{headers:{accept:'application/json','x-gold-state-handoff':'1'},cache:'no-store',signal:AbortSignal.timeout(3500)});if(!r.ok)return false;const prior=await r.json();return restoreActivePayload({signal:prior,dailySignalDate:prior?.dailySignalDate||null,dailySignalCount:n(prior?.dailySignalCount)??n(prior?.dailySignalNumber)??0,lastSignalAtMs:n(prior?.issuedAtMs)??0},'PREVIOUS_DEPLOYMENT');}catch(e){console.warn('[active-trade-handoff]',e?.message||e);return false;}}"
  ].join("\n");
  source=source.replace(utilAnchor,persistenceFns+"\n"+utilAnchor);

  const closeAnchor="state.trades.push({...state.lastTerminal,status:'CLOSED'});state.trades=state.trades.slice(-300);state.signal=null;";
  if(!source.includes(closeAnchor))throw new Error('active persistence patch: close anchor missing');
  source=source.replace(closeAnchor,closeAnchor+"clearPersistedActiveTradeState();");

  const manageAnchor="manage(q,now);";
  if(!source.includes(manageAnchor))throw new Error('active persistence patch: manage anchor missing');
  source=source.replace(manageAnchor,"manage(q,now);if(state.signal)persistActiveTradeState(now);");

  const createAnchor="state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);state.dailySignalCount+=1;state.lastSignalAtMs=now;state.candidateLock=null;state.candidateLockBucket=null;";
  if(!source.includes(createAnchor))throw new Error('active persistence patch: create anchor missing');
  source=source.replace(createAnchor,"persistActiveTradeState(now,true);"+createAnchor);

  const listenAnchor="server.listen(PORT,'0.0.0.0',()=>{console.log(\`[gold-site-signal-engine] \${BUILD} listening on \${PORT}; TradingView OANDA LP primary + 1m chart fallback; confidence score \${MIN_CONFIDENCE}; 1m confirmation \${REQUIRE_1M_CONFIRM?'required':'optional'}; volatility-adaptive risk/TP guard; TP1 structure protection; TP2 profit lock; TP3 M1 trailing; SL cooldown \${SL_COOLDOWN_MS/1000}s; same-side block \${SAME_SIDE_REENTRY_MS/1000}s; AI=off; execution=off; telegram-only\`);connectTradingView();});";
  if(!source.includes(listenAnchor))throw new Error('active persistence patch: server listen anchor missing');
  source=source.replace(listenAnchor,"async function bootGoldEngine(){restoreLocalActiveTradeState();if(!state.signal)await recoverPreviousDeployment();server.listen(PORT,'0.0.0.0',()=>{console.log(\`[gold-site-signal-engine] \${BUILD} listening on \${PORT}; TradingView OANDA LP primary + 1m chart fallback; confidence score \${MIN_CONFIDENCE}; 1m confirmation \${REQUIRE_1M_CONFIRM?'required':'optional'}; volatility-adaptive risk/TP guard; TP1 structure protection; TP2 profit lock; TP3 M1 trailing; SL cooldown \${SL_COOLDOWN_MS/1000}s; same-side block \${SAME_SIDE_REENTRY_MS/1000}s; AI=off; execution=off; telegram-only\`);connectTradingView();});}\nvoid bootGoldEngine();");

  source=source.replace("const BUILD='site-signal-noai-v71-authoritative-trade-state';","const BUILD='site-signal-noai-v73-authoritative-active-through-stale-feed';");
}

// marketClock runs for every retained M15 bar. Reuse its native formatter.
{
  const allocation="new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(ms))";
  if(!source.includes(allocation))throw new Error('memory patch: marketClock anchor missing');
  source="import { clockParts } from './runtime-memory-policy.js';\n"+source.replace(allocation,'clockParts(ms,timeZone)');
}
// Final entry permission guard: Asian/Tokyo levels remain readable, but only
// a London or New York window may turn an ICT candidate into an ACTIVE trade.
// Manage existing ACTIVE trades normally; this applies only to maybeCreate.
{
  const maybeAnchor=" const openSession=refreshOpeningSession(now);\n state.lastEntryGuard=null;";
  if(!source.includes(maybeAnchor))throw new Error('xau session policy: maybeCreate insertion anchor missing');
  source="import { goldEntryWindow } from './gold-session-entry-policy.js';\n"+source;
  source=source.replace(maybeAnchor,maybeAnchor+"\n const entryWindow=goldEntryWindow(now);\n if(!entryWindow.allowed){state.lastEntryGuard={atMs:now,reason:entryWindow.reason,session:entryWindow.session,marketMode:'READ_ONLY'};return;}");
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
