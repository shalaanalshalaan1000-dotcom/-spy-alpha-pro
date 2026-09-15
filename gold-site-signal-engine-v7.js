import http from 'node:http';
import WebSocket from 'ws';
import { analyzeGoldSignal } from './gold-signal-model.js';

const PORT=Number(process.env.PORT||3002);
const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||72);
const BASE_MIN_TP1_R=Math.max(.9,Number(process.env.GOLD_MIN_LIVE_TP1_R||1.20));
const SL_COOLDOWN_MS=Math.max(120000,Number(process.env.GOLD_SL_COOLDOWN_MS||300000));
const SAME_SIDE_REENTRY_MS=Math.max(SL_COOLDOWN_MS,Number(process.env.GOLD_SAME_SIDE_REENTRY_MS||600000));
const SAME_SETUP_REENTRY_MS=Math.max(SAME_SIDE_REENTRY_MS,Number(process.env.GOLD_SAME_SETUP_REENTRY_MS||1800000));
const REQUIRE_1M_CONFIRM=String(process.env.GOLD_REQUIRE_1M_CONFIRM||'true').toLowerCase()!=='false';
const BUILD='site-signal-noai-v19-trade-management';
const TV_SYMBOL=String(process.env.TV_PUBLIC_SYMBOL||'OANDA:XAUUSD').trim();
const MAX_QUOTE_AGE_MS=20_000;
const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,sameSideBlockUntil:0,lastLossSide:null,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0,lastLpAt:0,loggedQuote:false,loggedLp:false,lastEntryGuard:null};

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const iso=v=>new Date(v).toISOString();
const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-engine':BUILD});res.end(JSON.stringify(body));}
function quoteAgeMs(q,now=Date.now()){const t=n(q?.t);return t==null?Infinity:Math.max(0,now-t);}
function freshQuote(q,now=Date.now()){return Boolean(q)&&!q.degraded&&quoteAgeMs(q,now)<=MAX_QUOTE_AGE_MS&&n(q.price)>0;}
function normalize(){const cutoff=Date.now()-3*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-2400);}
function add(t,p,bid=p,ask=p){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;state.samples.push({t,p,price:p,bid:n(bid)??p,ask:n(ask)??p});}
function recordLive(price,t=Date.now()){price=n(price);if(price==null||price<=0)return;const last=state.samples.at(-1);if(!last||t-last.t>=2500)add(t,price,price,price);else Object.assign(last,{p:price,price,bid:price,ask:price,t});normalize();}

function minuteBars(now=Date.now()){
 const buckets=new Map(),span=60_000,currentKey=Math.floor(now/span)*span;
 for(const x of state.samples){
  const t=n(x.t),p=n(x.p??x.price);if(t==null||p==null||p<=0)continue;
  const key=Math.floor(t/span)*span;if(key>=currentKey)continue;
  const b=buckets.get(key);
  if(!b)buckets.set(key,{t:key,open:p,high:p,low:p,close:p});
  else{b.high=Math.max(b.high,p);b.low=Math.min(b.low,p);b.close=p;}
 }
 return [...buckets.values()].sort((a,b)=>a.t-b.t);
}
function avgRange(bars,count=8){
 const r=bars.slice(-count).map(b=>b.high-b.low).filter(x=>x>0);
 return r.length?r.reduce((a,b)=>a+b,0)/r.length:null;
}
function volatilityPolicy(now=Date.now()){
 const bars=minuteBars(now);
 const atr1=avgRange(bars,10)??1.0;
 return{
  atr1:round(atr1,3),
  minRisk:round(clamp(atr1*.70,.70,1.60),3),
  maxRisk:round(clamp(atr1*2.80,2.00,5.00),3),
  minTp1Usd:round(clamp(atr1*.60,.75,1.80),3),
  minTp1R:BASE_MIN_TP1_R,
  swingBuffer:round(clamp(atr1*.18,.12,.45),3)
 };
}
function recentSwing(side,now=Date.now(),count=3){
 const bars=minuteBars(now).slice(-Math.max(2,count));
 if(bars.length<2)return null;
 return side==='BUY'?Math.min(...bars.map(b=>b.low)):Math.max(...bars.map(b=>b.high));
}

const frame=obj=>{const s=typeof obj==='string'?obj:JSON.stringify(obj);return `~m~${s.length}~m~${s}`};
const send=(m,p)=>{if(state.ws?.readyState===WebSocket.OPEN)state.ws.send(frame({m,p}));};
const rid=prefix=>`${prefix}_${Math.random().toString(36).slice(2,12)}`;
function parseFrames(raw){const text=Buffer.isBuffer(raw)?raw.toString('utf8'):String(raw??'');const out=[];let i=0;while(i<text.length){if(!text.startsWith('~m~',i)){i+=1;continue}const j=text.indexOf('~m~',i+3);if(j<0)break;const len=Number(text.slice(i+3,j));if(!Number.isFinite(len))break;const start=j+3,end=start+len;out.push(text.slice(start,end));i=end;}return out;}
function ingestQuote(msg){const d=msg?.p?.[1];const v=d?.v;if(!v||typeof v!=='object')return;const price=n(v.lp??v.last_price??v.close);if(price==null||price<=0)return;const now=Date.now(),rawT=n(v.lp_time),stamp=rawT==null?now:(rawT>1e12?rawT:rawT*1000);state.quote={price,bid:price,ask:price,t:Math.abs(now-stamp)>MAX_QUOTE_AGE_MS?now:stamp,provider:'TRADINGVIEW_OANDA_LP',degraded:false,symbol:TV_SYMBOL};state.lastTvAt=now;state.lastLpAt=now;state.lastError=null;recordLive(price,now);if(!state.loggedLp){state.loggedLp=true;console.log(`[tv-lp] first live quote ${TV_SYMBOL} ${price}`);}}
function ingestTimescale(msg){
 const payload=msg?.p?.[1];if(!payload||typeof payload!=='object')return;
 let newestT=0,newestClose=null,added=0;
 for(const series of Object.values(payload)){
  const rows=Array.isArray(series?.s)?series.s:[];
  for(const row of rows){const v=row?.v;if(!Array.isArray(v)||v.length<5)continue;const t=n(v[0]),close=n(v[4]);if(t==null||close==null||close<=0)continue;const ms=t>1e12?t:t*1000;add(ms,close,close,close);added++;if(ms>=newestT){newestT=ms;newestClose=close;}}
 }
 if(added)normalize();
 if(newestClose!=null&&Date.now()-state.lastLpAt>5000){const now=Date.now();state.quote={price:newestClose,bid:newestClose,ask:newestClose,t:now,provider:'TRADINGVIEW_OANDA_BAR',degraded:false,symbol:TV_SYMBOL};state.lastTvAt=now;state.lastError=null;recordLive(newestClose,now);if(!state.loggedQuote){state.loggedQuote=true;console.log(`[tv-bar] first chart fallback ${TV_SYMBOL} ${newestClose}`);}}
}
function connectTradingView(){
 const cs=rid('cs'),qs=rid('qs');
 try{
  const ws=new WebSocket(`wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=${Date.now()}`,{headers:{Origin:'https://www.tradingview.com','User-Agent':'Mozilla/5.0'}});state.ws=ws;
  ws.on('open',()=>{state.wsConnected=true;state.lastError=null;const qsym=`={"symbol":"${TV_SYMBOL}","adjustment":"splits"}`;send('set_auth_token',['unauthorized_user_token']);send('quote_create_session',[qs]);send('quote_set_fields',[qs,'lp','lp_time','ch','chp']);send('quote_add_symbols',[qs,qsym]);send('quote_fast_symbols',[qs,qsym]);send('chart_create_session',[cs,'']);send('switch_timezone',[cs,'Etc/UTC']);send('resolve_symbol',[cs,'symbol_1',`={"symbol":"${TV_SYMBOL}","adjustment":"splits","session":"regular"}`]);send('create_series',[cs,'s1','s1','symbol_1','1',180]);console.log(`[tv-direct] connected quote+chart ${TV_SYMBOL}`);});
  ws.on('message',data=>{for(const part of parseFrames(data)){if(part.startsWith('~h~')){try{ws.send(frame(part))}catch{}continue}let msg;try{msg=JSON.parse(part)}catch{continue}if(msg.m==='qsd')ingestQuote(msg);if(msg.m==='timescale_update')ingestTimescale(msg);if(msg.m==='protocol_error'||msg.m==='critical_error'){state.lastError=`TV_${msg.m}`;console.error('[tv-direct]',msg.m,JSON.stringify(msg.p||[]).slice(0,300));}}});
  ws.on('error',e=>{state.lastError=`TV_WEBSOCKET_ERROR:${e?.message||e}`;console.error('[tv-direct] error',e?.message||e);});
  ws.on('close',(code,reason)=>{state.wsConnected=false;state.ws=null;console.error('[tv-direct] closed',code,String(reason||''));setTimeout(connectTradingView,2500).unref();});
 }catch(e){state.lastError=String(e?.message||e);console.error('[tv-direct] connect error',state.lastError);setTimeout(connectTradingView,5000).unref();}
}

function reached(side,price,target){return target!=null&&price!=null&&(side==='BUY'?price>=target:price<=target)}
function stopped(side,price,sl){return sl!=null&&price!=null&&(side==='BUY'?price<=sl:price>=sl)}
function validLevels(m){const s=m.candidateAction,lo=n(m.entryLow),hi=n(m.entryHigh),sl=n(m.stopLoss),t=[m.target1,m.target2,m.target3,m.target4].map(n);if(!['BUY','SELL'].includes(s)||lo==null||hi==null||sl==null||t.some(v=>v==null)||lo>hi)return false;return s==='BUY'?sl<lo&&t[0]>hi&&t[1]>t[0]&&t[2]>t[1]&&t[3]>t[2]:sl>hi&&t[0]<lo&&t[1]<t[0]&&t[2]<t[1]&&t[3]<t[2];}
function entryPx(side,q){return side==='BUY'?(n(q.ask)??n(q.price)):(n(q.bid)??n(q.price))}
function exitPx(side,q){return side==='BUY'?(n(q.bid)??n(q.price)):(n(q.ask)??n(q.price))}
function inRange(v,a,b){return v!=null&&a!=null&&b!=null&&v>=Math.min(a,b)&&v<=Math.max(a,b)}
function directionalPnl(side,entry,exit){return side==='BUY'?exit-entry:entry-exit}
function liveEntryViability(side,p,sl,tp1,now=Date.now()){
 const policy=volatilityPolicy(now);
 const risk=side==='BUY'?p-sl:sl-p;
 const reward=side==='BUY'?tp1-p:p-tp1;
 const rr=risk>0?reward/risk:0;
 if(!(risk>0)||!(reward>0))return{ok:false,reason:'TP1_OR_SL_ALREADY_PASSED',risk,reward,rr,policy};
 if(risk<policy.minRisk)return{ok:false,reason:'STOP_TOO_TIGHT_FOR_VOLATILITY',risk,reward,rr,policy};
 if(risk>policy.maxRisk)return{ok:false,reason:'STOP_TOO_WIDE_FOR_VOLATILITY',risk,reward,rr,policy};
 if(reward<policy.minTp1Usd)return{ok:false,reason:'TP1_TOO_CLOSE_FOR_VOLATILITY',risk,reward,rr,policy};
 if(rr<policy.minTp1R)return{ok:false,reason:'TP1_TOO_CLOSE_R',risk,reward,rr,policy};
 return{ok:true,risk,reward,rr,policy};
}
function improveStop(s,candidate){
 candidate=n(candidate);if(candidate==null)return false;
 const current=n(s.stopLoss);if(current==null)return false;
 const p=exitPx(s.side,state.quote),buffer=Math.max(.08,(s.volatilityPolicy?.atr1||1)*.08);
 if(s.side==='BUY'){
  candidate=Math.min(candidate,p-buffer);
  if(candidate<=current+.02)return false;
 }else{
  candidate=Math.max(candidate,p+buffer);
  if(candidate>=current-.02)return false;
 }
 s.stopLoss=round(candidate,3);s.managedStopLoss=s.stopLoss;s.lastStopUpdatedAt=iso(Date.now());return true;
}
function applyManagement(s,stage,now){
 const policy=volatilityPolicy(now),swing=recentSwing(s.side,now,stage>=3?2:3),entry=n(s.triggerPrice??s.entry),initialRisk=Math.max(.01,n(s.initialRiskUsd)??Math.abs(entry-n(s.originalStopLoss))),buffer=policy.swingBuffer;
 let candidate=null;
 if(stage===1){
  const nearEntry=s.side==='BUY'?entry-Math.min(.18,initialRisk*.12):entry+Math.min(.18,initialRisk*.12);
  const structure=swing==null?nearEntry:(s.side==='BUY'?swing-buffer:swing+buffer);
  candidate=s.side==='BUY'?Math.max(nearEntry,structure):Math.min(nearEntry,structure);
 }else if(stage===2){
  const locked=Math.max(.20,initialRisk*.20);
  const profitLock=s.side==='BUY'?entry+locked:entry-locked;
  const structure=swing==null?profitLock:(s.side==='BUY'?swing-buffer:swing+buffer);
  candidate=s.side==='BUY'?Math.max(profitLock,structure):Math.min(profitLock,structure);
 }else if(stage>=3){
  const floor=n(s.target1);
  const structure=swing==null?floor:(s.side==='BUY'?swing-buffer:swing+buffer);
  candidate=s.side==='BUY'?Math.max(floor,structure):Math.min(floor,structure);
 }
 const changed=improveStop(s,candidate);
 if(stage>s.managementStage){
  s.managementStage=stage;
  s.managementEventId=(s.managementEventId||0)+1;
  s.lastManagementEvent={id:s.managementEventId,stage,atMs:now,at:iso(now),newStop:s.stopLoss,changed,policy,swing:round(swing,3)};
 }
 s.volatilityPolicy=policy;
}
function close(outcome,price,now,meta={}){
 const s=state.signal;if(!s)return;
 const exit=n(price)??n(s.stopLoss)??n(s.triggerPrice),entry=n(s.triggerPrice??s.entry);
 const initialRisk=Math.max(.01,n(s.initialRiskUsd)??Math.abs(entry-n(s.originalStopLoss)));
 const pnl=directionalPnl(s.side,entry,exit),realizedR=pnl/initialRisk;
 const result=outcome==='TP4'?'WIN':realizedR>0.05?'WIN':realizedR>=-.05?'BREAKEVEN':'LOSS';
 const finalOutcome=outcome==='SL'&&s.managementStage>0?'MANAGED_STOP':outcome;
 state.lastTerminal={...s,...meta,outcome:finalOutcome,result,exitPrice:round(exit,3),realizedUsd:round(pnl,3),realizedR:round(realizedR,2),closedAt:iso(now),closedAtMs:now};
 state.trades.push({...state.lastTerminal,status:'CLOSED'});state.trades=state.trades.slice(-300);state.signal=null;
 if(result==='LOSS'){
  state.lastLossSide=s.side;
  state.cooldownUntil=now+SL_COOLDOWN_MS;
  state.sameSideBlockUntil=now+SAME_SIDE_REENTRY_MS;
 }else state.cooldownUntil=now+60000;
}
function manage(q,now){
 const s=state.signal;if(!s||!freshQuote(q,now))return;
 const p=exitPx(s.side,q);
 if(stopped(s.side,p,s.stopLoss))return close('SL',s.stopLoss,now,{stopType:s.managementStage>0?'MANAGED':'INITIAL'});
 if(s.side==='BUY')s.bestPrice=Math.max(n(s.bestPrice)??p,p);else s.bestPrice=Math.min(n(s.bestPrice)??p,p);
 const targets=[s.target1,s.target2,s.target3,s.target4];
 for(let i=0;i<4;i++){
  if(!s.targetHits[i]&&reached(s.side,p,targets[i])){
   s.targetHits[i]=true;s.targetHitAt[i]=now;
   if(i<3)applyManagement(s,i+1,now);
  }
 }
 if(s.targetHits[2])applyManagement(s,3,now);
 if(s.targetHits[3])return close('TP4',s.target4,now,{stopType:'TARGET'});
}
function maybeCreate(m,q,now){
 state.lastEntryGuard=null;
 if(state.signal||now<state.cooldownUntil||!freshQuote(q,now)||m.status!=='CANDIDATE'||Number(m.confidence)<MIN_CONFIDENCE||!validLevels(m))return;
 const side=m.candidateAction,p=entryPx(side,q),lo=n(m.entryLow),hi=n(m.entryHigh);
 if(state.lastLossSide===side&&now<state.sameSideBlockUntil){state.lastEntryGuard={atMs:now,reason:'SAME_SIDE_AFTER_SL_COOLDOWN',side,blockedUntil:iso(state.sameSideBlockUntil)};return;}
 const failedSameSetup=state.lastTerminal?.result==='LOSS'&&state.lastTerminal?.setupId&&m.setupId&&state.lastTerminal.setupId===m.setupId&&now-(n(state.lastTerminal.closedAtMs)??0)<SAME_SETUP_REENTRY_MS;
 if(failedSameSetup){state.lastEntryGuard={atMs:now,reason:'FAILED_SETUP_LOCKOUT',side,setupId:m.setupId,blockedUntil:iso((n(state.lastTerminal.closedAtMs)??now)+SAME_SETUP_REENTRY_MS)};return;}
 if(REQUIRE_1M_CONFIRM&&!m.oneMinuteConfirmed){state.lastEntryGuard={atMs:now,reason:'WAITING_1M_CONFIRMATION',side};return;}
 if(!inRange(p,lo,hi))return;
 const exit=exitPx(side,q),sl=n(m.stopLoss),tp1=n(m.target1);
 if(stopped(side,exit,sl)||reached(side,exit,tp1))return;
 const viability=liveEntryViability(side,p,sl,tp1,now);
 if(!viability.ok){
  state.lastEntryGuard={atMs:now,reason:viability.reason,side,price:round(p,3),risk:round(viability.risk,3),rewardToTp1:round(viability.reward,3),liveTp1R:round(viability.rr,2),policy:viability.policy};
  console.warn(`[entry-guard] rejected ${side} at ${round(p,3)}: ${viability.reason}; risk ${round(viability.risk,3)}; TP1 room ${round(viability.reward,3)} / ${round(viability.rr,2)}R`);
  return;
 }
 state.signal={
  signalId:`XAU-${now}-${side}`,setupId:m.setupId||null,side,candidateAction:side,action:'WAIT',status:'ACTIVE',strategy:m.strategy||null,
  confidence:Number(m.confidence)||0,signalConfidence:Number(m.confidence)||0,entry:n(m.entry),entryLow:lo,entryHigh:hi,
  originalStopLoss:sl,stopLoss:sl,managedStopLoss:sl,target1:tp1,target2:n(m.target2),target3:n(m.target3),target4:n(m.target4),
  riskReward:n(m.riskReward),initialRiskUsd:round(viability.risk,3),liveRiskUsd:round(viability.risk,3),liveTp1R:round(viability.rr,2),tp1RoomUsd:round(viability.reward,3),
  volatilityPolicy:viability.policy,prediction:m.prediction||null,contextBias:m.contextBias||null,oneMinuteConfirmed:Boolean(m.oneMinuteConfirmed),
  issuedAt:iso(now),issuedAtMs:now,targetHits:[false,false,false,false],targetHitAt:[null,null,null,null],
  managementStage:0,managementEventId:0,lastManagementEvent:null,bestPrice:p,
  source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,quoteAgeSec:round(quoteAgeMs(q,now)/1000,1),lockedTargets:true,
  reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — 1m confirm + volatility guard passed (${round(viability.rr,2)}R to TP1, risk ${round(viability.risk,2)}$, ATR1 ${viability.policy.atr1}$); managed stop active; Telegram only, AI off`
 };
 state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-300);
}
async function evaluate(){
 const q=state.quote,now=Date.now();
 if(!freshQuote(q,now))throw new Error(`TRADINGVIEW_DIRECT_NOT_FRESH age=${Number.isFinite(quoteAgeMs(q,now))?round(quoteAgeMs(q,now)/1000,1):'na'}s connected=${state.wsConnected}`);
 manage(q,now);
 const model=analyzeGoldSignal(state.samples,q.price,now);
 if(!state.signal)maybeCreate(model,q,now);
 const age=quoteAgeMs(q,now),policy=volatilityPolicy(now);
 const base={...model,source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,provider:q.provider,degraded:false,liveFeedFresh:true,quoteAgeMs:Math.round(age),quoteAgeSec:round(age/1000,1),maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000,price:q.price,bid:q.bid,ask:q.ask,updatedAt:iso(now),sampleCount:Number(model.sampleCount||state.samples.length),signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,volatilityPolicy:policy,slCooldownSec:SL_COOLDOWN_MS/1000,sameSideReentrySec:SAME_SIDE_REENTRY_MS/1000,entryGuard:state.lastEntryGuard,terminalEvent:state.lastTerminal,historySource:'TRADINGVIEW_OANDA_1M',build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL,livePriceMode:q.provider};
 if(state.signal)return{...base,...state.signal,status:'ACTIVE',action:'WAIT',candidateAction:state.signal.side,tp1:state.signal.targetHits[0],tp2:state.signal.targetHits[1],tp3:state.signal.targetHits[2],tp4:state.signal.targetHits[3],price:q.price,bid:q.bid,ask:q.ask,updatedAt:iso(now),terminalEvent:state.lastTerminal,historySource:'TRADINGVIEW_OANDA_1M',build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL,livePriceMode:q.provider,reason:state.signal.reason};
 if(state.lastEntryGuard?.atMs===now)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:`ENTRY_GUARD: ${state.lastEntryGuard.reason} — no Telegram entry sent`};
 if(now<state.cooldownUntil)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:'COOLDOWN: waiting after previous trade'};
 return{...base,action:'WAIT',reason:model.status==='CANDIDATE'?'السيناريو جاهز وينتظر دخولًا مؤكدًا بعد فلاتر التقلب/الخسارة/1m على سعر TradingView OANDA الحي':(model.reason||'بانتظار إشارة مؤكدة من محرك الموقع')};
}
let queue=Promise.resolve();function signal(){const t=queue.then(evaluate,evaluate);queue=t.catch(()=>{});return t;}
function journal(){
 const closed=state.trades.filter(x=>x.status==='CLOSED');
 const wins=closed.filter(x=>x.result==='WIN').length,losses=closed.filter(x=>x.result==='LOSS').length,breakeven=closed.filter(x=>x.result==='BREAKEVEN').length;
 const rs=closed.map(x=>n(x.realizedR)).filter(x=>x!=null);
 const netR=rs.reduce((a,b)=>a+b,0),avgR=rs.length?netR/rs.length:null;
 return{trades:state.trades,closed:closed.length,wins,losses,breakeven,protectedExits:closed.filter(x=>x.outcome==='MANAGED_STOP').length,winRate:closed.length?round(wins/closed.length*100,1):null,netR:round(netR,2),avgR:round(avgR,2),build:BUILD};
}
const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{
 if(req.method==='GET'&&u.pathname==='/api/health'){const now=Date.now(),age=quoteAgeMs(state.quote,now);return json(res,200,{ok:true,build:BUILD,noAI:true,telegramOnly:true,subscriptionRequired:false,sampleCount:state.samples.length,lastError:state.lastError,quoteProvider:state.quote?.provider||null,quoteAgeSec:Number.isFinite(age)?round(age/1000,1):null,liveFeedFresh:freshQuote(state.quote,now),wsConnected:state.wsConnected,tvSymbol:TV_SYMBOL,maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000,lastLpAgeSec:state.lastLpAt?round((now-state.lastLpAt)/1000,1):null,minConfidence:MIN_CONFIDENCE,volatilityPolicy:volatilityPolicy(now),slCooldownSec:SL_COOLDOWN_MS/1000,sameSideReentrySec:SAME_SIDE_REENTRY_MS/1000,require1mConfirm:REQUIRE_1M_CONFIRM,lastEntryGuard:state.lastEntryGuard});}
 if(req.method==='GET'&&['/api/auto-trade/signal','/api/gold','/api/gold-live'].includes(u.pathname))return json(res,200,await signal());
 if(req.method==='GET'&&u.pathname==='/api/auto-trade/trades')return json(res,200,{trades:state.trades,mode:'SIGNAL_ONLY_TELEGRAM'});
 if(req.method==='GET'&&u.pathname==='/api/performance/journal')return json(res,200,journal());
 return json(res,404,{error:'Not found'});
}catch(e){state.lastError=String(e?.message||e);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});
server.listen(PORT,'0.0.0.0',()=>{console.log(`[gold-site-signal-engine] ${BUILD} listening on ${PORT}; TradingView OANDA LP primary + 1m chart fallback; confidence score ${MIN_CONFIDENCE}; 1m confirmation ${REQUIRE_1M_CONFIRM?'required':'optional'}; volatility-adaptive risk/TP guard; TP1 structure protection; TP2 profit lock; TP3 M1 trailing; SL cooldown ${SL_COOLDOWN_MS/1000}s; same-side block ${SAME_SIDE_REENTRY_MS/1000}s; AI=off; execution=off; telegram-only`);connectTradingView();});
process.on('SIGTERM',()=>{try{state.ws?.close()}catch{}server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
process.on('SIGINT',()=>{try{state.ws?.close()}catch{}server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});