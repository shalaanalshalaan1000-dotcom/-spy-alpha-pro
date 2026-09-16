import fs from 'node:fs';

const sourceUrl = new URL('./gold-site-signal-engine-v7.js', import.meta.url);
const runtimeUrl = new URL('./.runtime-gold-site-signal-engine-v9.mjs', import.meta.url);

let source = fs.readFileSync(sourceUrl, 'utf8');

const replacements = [
  [
    "const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);",
    "const MIN_CONFIDENCE=Math.max(68,Math.min(75,Number(process.env.MIN_CONFIDENCE||70)));"
  ],
  [
    "const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));",
    "const BASE_MIN_TP1_R=Math.max(.45,Math.min(.65,Number(process.env.GOLD_MIN_LIVE_TP1_R||.50)));"
  ],
  [
    "const BUILD='site-signal-noai-v19-trade-management';",
    "const BUILD='site-signal-noai-v23-feed-recovery';"
  ],
  [
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null};",
    "const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null,lastReconnectAttempt:0};"
  ],
  [
    "maxRisk:round(clamp(atr1*2.80,2.00,5.00),3),",
    "maxRisk:round(clamp(atr1*3.40,2.50,5.25),3),"
  ],
  [
    "if(REQUIRE_1M_CONFIRM&&!m.oneMinuteConfirmed){state.lastEntryGuard={atMs:now,reason:'WAITING_1M_CONFIRMATION',side};return;}",
    "if(REQUIRE_1M_CONFIRM&&!m.oneMinuteConfirmed&&Number(m.confidence)<82){state.lastEntryGuard={atMs:now,reason:'WAITING_1M_CONFIRMATION',side};return;}"
  ],
  [
    "if(!freshQuote(q,now))throw new Error(`TRADINGVIEW_DIRECT_NOT_FRESH age=${Number.isFinite(quoteAgeMs(q,now))?round(quoteAgeMs(q,now)/1000,1):'na'}s connected=${state.wsConnected}`);",
    "if(!freshQuote(q,now)){const age=quoteAgeMs(q,now),ageSec=Number.isFinite(age)?round(age/1000,1):null;state.lastError=`TRADINGVIEW_DIRECT_STALE age=${ageSec??'na'}s connected=${state.wsConnected}`;if(now-(state.lastReconnectAttempt||0)>15000){state.lastReconnectAttempt=now;console.warn(`[tv-direct] stale live quote age=${ageSec??'na'}s; forcing websocket reconnect`);try{if(state.ws?.readyState===WebSocket.OPEN)state.ws.terminate();}catch(e){console.error('[tv-direct] stale reconnect',e?.message||e);}}return{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,executable:false,degraded:true,liveFeedFresh:false,quoteAgeMs:Number.isFinite(age)?age:null,price:n(q?.price),bid:n(q?.bid),ask:n(q?.ask),provider:q?.provider||null,entered:false,triggered:false,signalId:null,terminalEvent:state.lastTerminal,reason:'DATA_RECOVERING: TradingView live price is stale; reconnecting before any new Telegram entry',updatedAt:iso(now),build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL};}"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`gold-site-signal-engine-v9: expected signature not found: ${from.slice(0, 60)}`);
  source = source.replace(from, to);
}

fs.writeFileSync(runtimeUrl, source, 'utf8');
await import(`${runtimeUrl.href}?v=${Date.now()}`);
