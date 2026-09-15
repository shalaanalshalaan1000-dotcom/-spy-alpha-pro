import http from 'node:http';
import { analyzeGoldSignal } from './gold-signal-model.js';

const PORT=Number(process.env.PORT||3002);
const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||65);
const BUILD='site-signal-noai-v5-stooq-live';
const MAX_QUOTE_AGE_MS=60_000;
const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,quote:null,quoteAt:0,lastError:null};

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const iso=v=>new Date(v).toISOString();
const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-engine':BUILD});res.end(JSON.stringify(body));}
async function getText(url,timeout=6000){const r=await fetch(url,{cache:'no-store',headers:{accept:'text/csv,text/plain,*/*','user-agent':'GoldAlphaSiteEngine/5.0'},signal:AbortSignal.timeout(timeout)});const t=await r.text();if(!r.ok)throw new Error(`HTTP_${r.status}`);return t;}
async function getJson(url,timeout=6000){const r=await fetch(url,{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaSiteEngine/5.0'},signal:AbortSignal.timeout(timeout)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(d?.error||d?.detail||`HTTP_${r.status}`));return d;}

async function stooqQuote(){
 const now=Date.now();
 const text=await getText(`https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv&_=${now}`,6000);
 const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error('STOOQ_EMPTY');
 const headers=lines[0].split(',').map(x=>x.trim().toLowerCase());
 const vals=lines[1].split(',').map(x=>x.trim());
 const row=Object.fromEntries(headers.map((h,i)=>[h,vals[i]]));
 const price=n(row.close??row.last);if(price==null||price<=0)throw new Error('STOOQ_BAD_PRICE');
 if(String(row.close||'').toUpperCase()==='N/D')throw new Error('STOOQ_ND');
 return{price,bid:price,ask:price,t:now,provider:'STOOQ_XAUUSD',degraded:false,sourceTime:[row.date,row.time].filter(Boolean).join(' ')};
}
async function xausQuote(){const now=Date.now(),d=await getJson(`https://xaus.com/api/v1/spot?fresh=${now}`,5000);const price=n(d.spot_usd_oz??d?.xau?.price);if(price==null||price<=0)throw new Error('XAUS_BAD_PRICE');return{price,bid:price,ask:price,t:now,provider:'XAUS',degraded:d.stale===true};}
async function goldApiQuote(){const now=Date.now(),d=await getJson('https://api.gold-api.com/price/XAU',5000);const price=n(d.price);if(price==null||price<=0)throw new Error('GOLD_API_BAD_PRICE');return{price,bid:price,ask:price,t:now,provider:'GOLD_API',degraded:false};}
async function fetchQuote(){
 const now=Date.now();if(state.quote&&now-state.quoteAt<1200)return state.quote;
 let err;for(const fn of [stooqQuote,xausQuote,goldApiQuote]){try{const q=await fn();state.quote=q;state.quoteAt=now;state.lastError=null;return q}catch(e){err=e;}}
 state.lastError=String(err?.message||err||'NO_LIVE_QUOTE');throw err||new Error('NO_LIVE_QUOTE');
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
const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/api/health'){const age=quoteAgeMs(state.quote);return json(res,200,{ok:true,build:BUILD,noAI:true,telegramOnly:true,sampleCount:state.samples.length,lastError:state.lastError,quoteProvider:state.quote?.provider||null,quoteAgeSec:Number.isFinite(age)?round(age/1000,1):null,liveFeedFresh:freshQuote(state.quote),maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000});}if(req.method==='GET'&&['/api/auto-trade/signal','/api/gold','/api/gold-live'].includes(u.pathname))return json(res,200,await signal());if(req.method==='GET'&&u.pathname==='/api/auto-trade/trades')return json(res,200,{trades:state.trades,mode:'SIGNAL_ONLY_TELEGRAM'});if(req.method==='GET'&&u.pathname==='/api/performance/journal'){const closed=state.trades.filter(x=>x.status==='CLOSED'),wins=closed.filter(x=>x.outcome==='TP4').length,losses=closed.filter(x=>x.outcome==='SL').length;return json(res,200,{trades:state.trades,closed:closed.length,wins,losses,winRate:closed.length?round(wins/closed.length*100,1):null});}return json(res,404,{error:'Not found'});}catch(e){state.lastError=String(e?.message||e);console.error('[gold-site-signal-engine-v5]',state.lastError);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`[gold-site-signal-engine] ${BUILD} listening on ${PORT}; Stooq primary; failover on; AI=off; execution=off; telegram-only`));
