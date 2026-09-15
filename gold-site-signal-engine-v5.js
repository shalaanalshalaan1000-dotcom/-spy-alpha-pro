import http from 'node:http';
import { analyzeGoldSignal } from './gold-signal-model.js';

const PORT=Number(process.env.PORT||3002);
const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||65);
const BUILD='site-signal-noai-v7-yahoo-goldprice';
const MAX_QUOTE_AGE_MS=90_000;
const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,quote:null,quoteAt:0,lastError:null};

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const iso=v=>new Date(v).toISOString();
const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-engine':BUILD});res.end(JSON.stringify(body));}
async function getJson(url,timeout=6000){const r=await fetch(url,{cache:'no-store',headers:{accept:'application/json','user-agent':'Mozilla/5.0 GoldAlpha/7.0'},signal:AbortSignal.timeout(timeout)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(d?.error||d?.detail||`HTTP_${r.status}`));return d;}

async function yahooQuote(){
 const now=Date.now();
 const d=await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?interval=1m&range=1d&_=${now}`,6000);
 const r=d?.chart?.result?.[0];if(!r)throw new Error('YAHOO_NO_RESULT');
 const stamps=Array.isArray(r.timestamp)?r.timestamp:[],closes=r?.indicators?.quote?.[0]?.close||[];
 let price=null,t=null;for(let i=closes.length-1;i>=0;i--){const p=n(closes[i]),s=n(stamps[i]);if(p!=null&&p>0&&s!=null){price=p;t=s*1000;break;}}
 if(price==null){price=n(r?.meta?.regularMarketPrice);t=n(r?.meta?.regularMarketTime)*1000;}
 if(price==null||price<=0||!Number.isFinite(t))throw new Error('YAHOO_BAD_PRICE');
 const age=Math.max(0,now-t);if(age>MAX_QUOTE_AGE_MS)throw new Error(`YAHOO_STALE_${Math.round(age/1000)}s`);
 return{price,bid:price,ask:price,t,provider:'YAHOO_XAUUSD',degraded:false};
}
async function goldPriceDevQuote(){
 const now=Date.now();
 const d=await getJson('https://goldprice.dev/v1/prices?symbol=XAU-USD-SPOT',6000);
 const row=Array.isArray(d?.symbols)?d.symbols[0]:(d?.data||d);
 const price=n(row?.price),bid=n(row?.bid)??price,ask=n(row?.ask)??price,t=Date.parse(row?.computed_at||row?.updated_at||'');
 if(price==null||price<=0)throw new Error('GOLDPRICE_BAD_PRICE');
 const stamp=Number.isFinite(t)?t:now,age=Math.max(0,now-stamp);if(row?.is_stale===true||age>MAX_QUOTE_AGE_MS)throw new Error(`GOLDPRICE_STALE_${Math.round(age/1000)}s`);
 return{price,bid,ask,t:stamp,provider:'GOLDPRICE_DEV',degraded:false};
}
async function fetchQuote(){
 const now=Date.now(),ttl=state.quote?.provider==='GOLDPRICE_DEV'?35_000:10_000;
 if(state.quote&&now-state.quoteAt<ttl&&now-state.quote.t<=MAX_QUOTE_AGE_MS)return state.quote;
 const errors=[];for(const [name,fn] of [['YAHOO',yahooQuote],['GOLDPRICE',goldPriceDevQuote]]){try{const q=await fn();state.quote=q;state.quoteAt=now;state.lastError=null;return q}catch(e){errors.push(`${name}:${String(e?.message||e)}`);}}
 state.lastError=errors.join(' | ');throw new Error(state.lastError||'NO_LIVE_QUOTE');
}
function quoteAgeMs(q,now=Date.now()){const t=n(q?.t);return t==null?Infinity:Math.max(0,now-t);}
function freshQuote(q,now=Date.now()){return Boolean(q)&&!q.degraded&&quoteAgeMs(q,now)<=MAX_QUOTE_AGE_MS&&n(q.price)>0;}
function normalize(){const cutoff=Date.now()-2*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-1800);}
function recordLive(q){const now=Date.now(),last=state.samples.at(-1);if(!last||now-last.t>=3000)state.samples.push({t:now,p:q.price,price:q.price,bid:q.bid,ask:q.ask});else Object.assign(last,{p:q.price,price:q.price,bid:q.bid,ask:q.ask});normalize();}
function reached(side,price,target){return target!=null&&price!=null&&(side==='BUY'?price>=target:price<=target)}
function stopped(side,price,sl){return sl!=null&&price!=null&&(side==='BUY'?price<=sl:price>=sl)}
function validLevels(m){const s=m.candidateAction,lo=n(m.entryLow),hi=n(m.entryHigh),sl=n(m.stopLoss),t=[m.target1,m.target2,m.target3,m.target4].map(n);if(!['BUY','SELL'].includes(s)||lo==null||hi==null||sl==null||t.some(v=>v==null)||lo>hi)return false;return s==='BUY'?sl<lo&&t[0]>hi&&t[1]>t[0]&&t[2]>t[1]&&t[3]>t[2]:sl>hi&&t[0]<lo&&t[1]<t[0]&&t[2]<t[1]&&t[3]<t[2];}
function entryPx(side,q){return side==='BUY'?(n(q.ask)??n(q.price)):(n(q.bid)??n(q.price));}
function exitPx(side,q){return side==='BUY'?(n(q.bid)??n(q.price)):(n(q.ask)??n(q.price));}
function inRange(v,a,b){return v!=null&&a!=null&&b!=null&&v>=Math.min(a,b)&&v<=Math.max(a,b)}
function close(outcome,price,now){const s=state.signal;if(!s)return;state.lastTerminal={...s,outcome,result:outcome,exitPrice:price,closedAt:iso(now),closedAtMs:now};state.trades.push({...state.lastTerminal,status:'CLOSED'});state.trades=state.trades.slice(-200);state.signal=null;state.cooldownUntil=now+(outcome==='SL'?120000:60000);}
function manage(q,now){const s=state.signal;if(!s||!freshQuote(q,now))return;const p=exitPx(s.side,q);if(stopped(s.side,p,s.stopLoss))return close('SL',s.stopLoss,now);const targets=[s.target1,s.target2,s.target3,s.target4];for(let i=0;i<4;i++)if(!s.targetHits[i]&&reached(s.side,p,targets[i])){s.targetHits[i]=true;s.targetHitAt[i]=now;}if(s.targetHits[3])return close('TP4',s.target4,now);}
function maybeCreate(m,q,now){if(state.signal||now<state.cooldownUntil||!freshQuote(q,now)||m.status!=='CANDIDATE'||Number(m.confidence)<MIN_CONFIDENCE||!validLevels(m))return;const side=m.candidateAction,p=entryPx(side,q),lo=n(m.entryLow),hi=n(m.entryHigh);if(!inRange(p,lo,hi))return;const exit=exitPx(side,q);if(stopped(side,exit,n(m.stopLoss))||reached(side,exit,n(m.target1)))return;state.signal={signalId:`XAU-${now}-${side}`,side,candidateAction:side,action:'WAIT',status:'ACTIVE',strategy:m.strategy||null,confidence:Number(m.confidence)||0,signalConfidence:Number(m.confidence)||0,entry:n(m.entry),entryLow:lo,entryHigh:hi,stopLoss:n(m.stopLoss),target1:n(m.target1),target2:n(m.target2),target3:n(m.target3),target4:n(m.target4),riskReward:n(m.riskReward),prediction:m.prediction||null,contextBias:m.contextBias||null,oneMinuteConfirmed:Boolean(m.oneMinuteConfirmed),issuedAt:iso(now),issuedAtMs:now,targetHits:[false,false,false,false],targetHitAt:[null,null,null,null],source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,quoteAgeSec:round(quoteAgeMs(q,now)/1000,1),reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — Telegram only, AI off`};state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-200);}
async function evaluate(){const q=await fetchQuote();recordLive(q);const now=Date.now();manage(q,now);const model=analyzeGoldSignal(state.samples,q.price,now);if(!state.signal)maybeCreate(model,q,now);const age=quoteAgeMs(q,now),liveFresh=freshQuote(q,now);const base={...model,source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,provider:q.provider,degraded:!liveFresh,liveFeedFresh:liveFresh,quoteAgeMs:Math.round(age),quoteAgeSec:round(age/1000,1),maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000,price:q.price,bid:q.bid,ask:q.ask,updatedAt:iso(now),sampleCount:Number(model.sampleCount||state.samples.length),signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,terminalEvent:state.lastTerminal,historySource:'LIVE_STREAM',build:BUILD,noAI:true};if(state.signal)return{...state.signal,...base,status:'ACTIVE',action:'WAIT',candidateAction:state.signal.side,tp1:state.signal.targetHits[0],tp2:state.signal.targetHits[1],tp3:state.signal.targetHits[2],tp4:state.signal.targetHits[3],reason:state.signal.reason};if(!liveFresh)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:`LIVE PRICE STALE: ${q.provider||'feed'} age ${round(age/1000,1)}s`};if(now<state.cooldownUntil)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:'COOLDOWN: waiting after previous trade'};return{...base,action:'WAIT',reason:model.status==='CANDIDATE'?'السيناريو جاهز وينتظر لمس نطاق الدخول على السعر الحي':(model.reason||'بانتظار إشارة مؤكدة من محرك الموقع')};}
let queue=Promise.resolve();function signal(){const t=queue.then(evaluate,evaluate);queue=t.catch(()=>{});return t;}
const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/api/health'){const age=quoteAgeMs(state.quote);return json(res,200,{ok:true,build:BUILD,noAI:true,telegramOnly:true,sampleCount:state.samples.length,lastError:state.lastError,quoteProvider:state.quote?.provider||null,quoteAgeSec:Number.isFinite(age)?round(age/1000,1):null,liveFeedFresh:freshQuote(state.quote),maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000});}if(req.method==='GET'&&['/api/auto-trade/signal','/api/gold','/api/gold-live'].includes(u.pathname))return json(res,200,await signal());if(req.method==='GET'&&u.pathname==='/api/auto-trade/trades')return json(res,200,{trades:state.trades,mode:'SIGNAL_ONLY_TELEGRAM'});if(req.method==='GET'&&u.pathname==='/api/performance/journal'){const closed=state.trades.filter(x=>x.status==='CLOSED'),wins=closed.filter(x=>x.outcome==='TP4').length,losses=closed.filter(x=>x.outcome==='SL').length;return json(res,200,{trades:state.trades,closed:closed.length,wins,losses,winRate:closed.length?round(wins/closed.length*100,1):null});}return json(res,404,{error:'Not found'});}catch(e){state.lastError=String(e?.message||e);console.error('[gold-site-signal-engine-v7]',state.lastError);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`[gold-site-signal-engine] ${BUILD} listening on ${PORT}; Yahoo XAUUSD primary; goldprice.dev failover; AI=off; execution=off; telegram-only`));
