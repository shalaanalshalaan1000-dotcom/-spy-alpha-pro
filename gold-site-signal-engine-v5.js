import http from 'node:http';
import { analyzeGoldSignal } from './gold-signal-model.js';

const PORT=Number(process.env.PORT||3002);
const MIN_CONFIDENCE=Number(process.env.MIN_CONFIDENCE||65);
const BUILD='site-signal-noai-v11-tradingview-public-live';
const TV_SYMBOL=String(process.env.TV_PUBLIC_SYMBOL||'OANDA:XAUUSD').trim();
const MAX_QUOTE_AGE_MS=20_000;
const state={samples:[],signal:null,lastTerminal:null,trades:[],cooldownUntil:0,quote:null,lastError:null,ws:null,wsConnected:false,lastTvAt:0};

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const iso=v=>new Date(v).toISOString();
const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','x-gold-alpha-engine':BUILD});res.end(JSON.stringify(body));}
function quoteAgeMs(q,now=Date.now()){const t=n(q?.t);return t==null?Infinity:Math.max(0,now-t);}
function freshQuote(q,now=Date.now()){return Boolean(q)&&!q.degraded&&quoteAgeMs(q,now)<=MAX_QUOTE_AGE_MS&&n(q.price)>0;}
function normalize(){const cutoff=Date.now()-3*60*60_000;state.samples=state.samples.filter(x=>n(x.t)!=null&&n(x.p)!=null&&x.t>=cutoff).sort((a,b)=>a.t-b.t);const out=[];for(const x of state.samples){const last=out.at(-1);if(last&&last.t===x.t)Object.assign(last,x);else out.push(x)}state.samples=out.slice(-2400);}
function add(t,p,bid=p,ask=p){t=n(t);p=n(p);if(t==null||p==null||p<=0)return;state.samples.push({t,p,price:p,bid:n(bid)??p,ask:n(ask)??p});}
function recordLive(price,t=Date.now()){price=n(price);if(price==null||price<=0)return;const last=state.samples.at(-1);if(!last||t-last.t>=2500)add(t,price,price,price);else Object.assign(last,{p:price,price,bid:price,ask:price,t});normalize();}

const frame=obj=>{const s=JSON.stringify(obj);return `~m~${s.length}~m~${s}`};
const send=(m,p)=>{if(state.ws?.readyState===1)state.ws.send(frame({m,p}));};
const rid=(prefix)=>`${prefix}_${Math.random().toString(36).slice(2,12)}`;
function parseFrames(raw){const text=String(raw??'');const out=[];let i=0;while(i<text.length){if(!text.startsWith('~m~',i)){i+=1;continue}const j=text.indexOf('~m~',i+3);if(j<0)break;const len=Number(text.slice(i+3,j));if(!Number.isFinite(len))break;const start=j+3,end=start+len;out.push(text.slice(start,end));i=end;}return out;}
function ingestHistory(msg){const payload=msg?.p?.[1];if(!payload||typeof payload!=='object')return;for(const series of Object.values(payload)){const rows=Array.isArray(series?.s)?series.s:[];for(const row of rows){const v=row?.v;if(!Array.isArray(v)||v.length<5)continue;const t=n(v[0]);const close=n(v[4]);if(t==null||close==null||close<=0)continue;add(t*1000,close,close,close);}}normalize();}
function ingestQuote(msg){const d=msg?.p?.[1];const v=d?.v;if(!v||typeof v!=='object')return;const price=n(v.lp??v.last_price??v.close);if(price==null||price<=0)return;const now=Date.now();const t=n(v.lp_time);const stamp=t!=null?(t>1e12?t:t*1000):now;state.quote={price,bid:price,ask:price,t:Math.abs(now-stamp)>MAX_QUOTE_AGE_MS?now:stamp,provider:'TRADINGVIEW_PUBLIC',degraded:false,symbol:d?.n||TV_SYMBOL};state.lastTvAt=now;state.lastError=null;recordLive(price,now);}
function connectTradingView(){
 try{
  const WS=globalThis.WebSocket;if(typeof WS!=='function')throw new Error('WEBSOCKET_UNAVAILABLE');
  const qs=rid('qs'),cs=rid('cs');
  const ws=new WS('wss://data.tradingview.com/socket.io/websocket?from=chart/');state.ws=ws;
  ws.onopen=()=>{state.wsConnected=true;send('set_auth_token',['unauthorized_user_token']);send('quote_create_session',[qs]);send('quote_set_fields',[qs,'lp','lp_time','ch','chp','current_session','description','exchange','original_name','pro_name','short_name','type','update_mode']);send('quote_add_symbols',[qs,TV_SYMBOL]);send('chart_create_session',[cs,'']);send('switch_timezone',[cs,'Etc/UTC']);send('resolve_symbol',[cs,'symbol_1',`={"symbol":"${TV_SYMBOL}","adjustment":"splits","session":"regular"}`]);send('create_series',[cs,'s1','s1','symbol_1','1',180]);console.log(`[tv-public] connected ${TV_SYMBOL}`);};
  ws.onmessage=e=>{for(const part of parseFrames(e.data)){if(part.startsWith('~h~')){try{ws.send(frame(part))}catch{}continue}let msg;try{msg=JSON.parse(part)}catch{continue}if(msg.m==='qsd')ingestQuote(msg);if(msg.m==='timescale_update')ingestHistory(msg);if(msg.m==='protocol_error'||msg.m==='critical_error')state.lastError=`TV_${msg.m}`;}};
  ws.onerror=()=>{state.lastError='TV_WEBSOCKET_ERROR'};
  ws.onclose=()=>{state.wsConnected=false;state.ws=null;setTimeout(connectTradingView,2500).unref?.();};
 }catch(e){state.lastError=String(e?.message||e);setTimeout(connectTradingView,5000).unref?.();}
}

function reached(side,price,target){return target!=null&&price!=null&&(side==='BUY'?price>=target:price<=target)}
function stopped(side,price,sl){return sl!=null&&price!=null&&(side==='BUY'?price<=sl:price>=sl)}
function validLevels(m){const s=m.candidateAction,lo=n(m.entryLow),hi=n(m.entryHigh),sl=n(m.stopLoss),t=[m.target1,m.target2,m.target3,m.target4].map(n);if(!['BUY','SELL'].includes(s)||lo==null||hi==null||sl==null||t.some(v=>v==null)||lo>hi)return false;return s==='BUY'?sl<lo&&t[0]>hi&&t[1]>t[0]&&t[2]>t[1]&&t[3]>t[2]:sl>hi&&t[0]<lo&&t[1]<t[0]&&t[2]<t[1]&&t[3]<t[2];}
function entryPx(side,q){return side==='BUY'?(n(q.ask)??n(q.price)):(n(q.bid)??n(q.price));}
function exitPx(side,q){return side==='BUY'?(n(q.bid)??n(q.price)):(n(q.ask)??n(q.price));}
function inRange(v,a,b){return v!=null&&a!=null&&b!=null&&v>=Math.min(a,b)&&v<=Math.max(a,b)}
function close(outcome,price,now){const s=state.signal;if(!s)return;state.lastTerminal={...s,outcome,result:outcome,exitPrice:price,closedAt:iso(now),closedAtMs:now};state.trades.push({...state.lastTerminal,status:'CLOSED'});state.trades=state.trades.slice(-200);state.signal=null;state.cooldownUntil=now+(outcome==='SL'?120000:60000);}
function manage(q,now){const s=state.signal;if(!s||!freshQuote(q,now))return;const p=exitPx(s.side,q);if(stopped(s.side,p,s.stopLoss))return close('SL',s.stopLoss,now);const targets=[s.target1,s.target2,s.target3,s.target4];for(let i=0;i<4;i++)if(!s.targetHits[i]&&reached(s.side,p,targets[i])){s.targetHits[i]=true;s.targetHitAt[i]=now;}if(s.targetHits[3])return close('TP4',s.target4,now);}
function maybeCreate(m,q,now){if(state.signal||now<state.cooldownUntil||!freshQuote(q,now)||m.status!=='CANDIDATE'||Number(m.confidence)<MIN_CONFIDENCE||!validLevels(m))return;const side=m.candidateAction,p=entryPx(side,q),lo=n(m.entryLow),hi=n(m.entryHigh);if(!inRange(p,lo,hi))return;const exit=exitPx(side,q);if(stopped(side,exit,n(m.stopLoss))||reached(side,exit,n(m.target1)))return;state.signal={signalId:`XAU-${now}-${side}`,side,candidateAction:side,action:'WAIT',status:'ACTIVE',strategy:m.strategy||null,confidence:Number(m.confidence)||0,signalConfidence:Number(m.confidence)||0,entry:n(m.entry),entryLow:lo,entryHigh:hi,stopLoss:n(m.stopLoss),target1:n(m.target1),target2:n(m.target2),target3:n(m.target3),target4:n(m.target4),riskReward:n(m.riskReward),prediction:m.prediction||null,contextBias:m.contextBias||null,oneMinuteConfirmed:Boolean(m.oneMinuteConfirmed),issuedAt:iso(now),issuedAtMs:now,targetHits:[false,false,false,false],targetHitAt:[null,null,null,null],source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,entered:true,triggered:true,triggerPrice:p,priceProvider:q.provider,quoteAgeSec:round(quoteAgeMs(q,now)/1000,1),reason:`CONFIRMED BY SITE ENGINE ON FRESH ${q.provider} PRICE — Telegram only, AI off`};state.trades.push({...state.signal,status:'SIGNAL'});state.trades=state.trades.slice(-200);}
async function evaluate(){const q=state.quote;const now=Date.now();if(!freshQuote(q,now))throw new Error(`TRADINGVIEW_PUBLIC_NOT_FRESH age=${Number.isFinite(quoteAgeMs(q,now))?round(quoteAgeMs(q,now)/1000,1):'na'}s connected=${state.wsConnected}`);manage(q,now);const model=analyzeGoldSignal(state.samples,q.price,now);if(!state.signal)maybeCreate(model,q,now);const age=quoteAgeMs(q,now);const base={...model,source:'GOLD_ALPHA_SITE',executionMode:'SIGNAL_ONLY_TELEGRAM',executable:false,provider:q.provider,degraded:false,liveFeedFresh:true,quoteAgeMs:Math.round(age),quoteAgeSec:round(age/1000,1),maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000,price:q.price,bid:q.bid,ask:q.ask,updatedAt:iso(now),sampleCount:Number(model.sampleCount||state.samples.length),signalConfidence:Number(state.signal?.confidence??model.confidence??0),minConfidence:MIN_CONFIDENCE,terminalEvent:state.lastTerminal,historySource:'TRADINGVIEW_PUBLIC_1M',build:BUILD,noAI:true,subscriptionRequired:false,tvSymbol:TV_SYMBOL};if(state.signal)return{...state.signal,...base,status:'ACTIVE',action:'WAIT',candidateAction:state.signal.side,tp1:state.signal.targetHits[0],tp2:state.signal.targetHits[1],tp3:state.signal.targetHits[2],tp4:state.signal.targetHits[3],reason:state.signal.reason};if(now<state.cooldownUntil)return{...base,status:'WAIT',action:'WAIT',candidateAction:'WAIT',reason:'COOLDOWN: waiting after previous trade'};return{...base,action:'WAIT',reason:model.status==='CANDIDATE'?'السيناريو جاهز وينتظر لمس نطاق الدخول على سعر TradingView الحي':(model.reason||'بانتظار إشارة مؤكدة من محرك الموقع')};}
let queue=Promise.resolve();function signal(){const t=queue.then(evaluate,evaluate);queue=t.catch(()=>{});return t;}
const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{
 if(req.method==='GET'&&u.pathname==='/api/health'){const now=Date.now(),age=quoteAgeMs(state.quote,now);return json(res,200,{ok:true,build:BUILD,noAI:true,telegramOnly:true,subscriptionRequired:false,sampleCount:state.samples.length,lastError:state.lastError,quoteProvider:state.quote?.provider||null,quoteAgeSec:Number.isFinite(age)?round(age/1000,1):null,liveFeedFresh:freshQuote(state.quote,now),wsConnected:state.wsConnected,tvSymbol:TV_SYMBOL,maxQuoteAgeSec:MAX_QUOTE_AGE_MS/1000});}
 if(req.method==='GET'&&['/api/auto-trade/signal','/api/gold','/api/gold-live'].includes(u.pathname))return json(res,200,await signal());
 if(req.method==='GET'&&u.pathname==='/api/auto-trade/trades')return json(res,200,{trades:state.trades,mode:'SIGNAL_ONLY_TELEGRAM'});
 if(req.method==='GET'&&u.pathname==='/api/performance/journal'){const closed=state.trades.filter(x=>x.status==='CLOSED'),wins=closed.filter(x=>x.outcome==='TP4').length,losses=closed.filter(x=>x.outcome==='SL').length;return json(res,200,{trades:state.trades,closed:closed.length,wins,losses,winRate:closed.length?round(wins/closed.length*100,1):null});}
 return json(res,404,{error:'Not found'});
}catch(e){state.lastError=String(e?.message||e);return json(res,503,{error:'Signal engine unavailable',detail:state.lastError,build:BUILD,noAI:true});}});
server.listen(PORT,'0.0.0.0',()=>{console.log(`[gold-site-signal-engine] ${BUILD} listening on ${PORT}; direct TradingView public live feed ${TV_SYMBOL}; no subscription; AI=off; execution=off; telegram-only`);connectTradingView();});
