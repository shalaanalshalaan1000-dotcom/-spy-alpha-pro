import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBrokerTargetReport,
  confirmBrokerOpen,
  normalizeLifecycleState,
  processSignalLifecycle,
  setupFingerprint,
  signalResponse
} from './gold-trade-lifecycle.js';
import { analyzeGoldSignal } from './gold-signal-model.js';
import { aiReviewerConfig, executableEntryPrice, reviewGoldCandidate } from './gold-ai-reviewer.js';

const PORT = Number(process.env.PORT || 3000);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 65);
const DATA_DIR = process.env.GOLD_ALPHA_DATA_DIR || '/tmp/gold-alpha';
const STORE_PATH = process.env.GOLD_ALPHA_STORE_PATH || join(DATA_DIR, 'state.json');
const AI_REVIEWER = aiReviewerConfig();
const PREAPPROVAL_TTL_MS = 45_000;

const state = {
  samples: [], quote: null, quoteAt: 0, signal: null, lastTerminal: null,
  blockedSetupIds: [], aiRejectedSetupIds: [], lastAiReview: null, cooldownUntil: 0,
  candidateTrack: { side:'WAIT', setupId:null, count:0, firstSeen:0, lastSeen:0, lastQuoteAt:0, model:null },
  stableView: null,
  mt5: { lastSeen:0, tradingEnabled:false, liveAccount:false, positionOpen:false, symbol:'XAUUSD', quote:null },
  trades: []
};

function saveStore(){
  try{
    mkdirSync(DATA_DIR,{recursive:true});
    const tmp=`${STORE_PATH}.tmp`;
    writeFileSync(tmp,JSON.stringify({
      trades:state.trades.slice(-200),samples:state.samples.slice(-1800),signal:state.signal,lastTerminal:state.lastTerminal,
      blockedSetupIds:state.blockedSetupIds.slice(-50),aiRejectedSetupIds:state.aiRejectedSetupIds.slice(-50),
      lastAiReview:state.lastAiReview,cooldownUntil:state.cooldownUntil
    }));
    renameSync(tmp,STORE_PATH);
  }catch{}
}
function loadStore(){
  try{
    mkdirSync(DATA_DIR,{recursive:true});
    if(!existsSync(STORE_PATH)) return;
    const x=JSON.parse(readFileSync(STORE_PATH,'utf8'));
    if(Array.isArray(x.trades)) state.trades=x.trades.slice(-200);
    if(Array.isArray(x.samples)) state.samples=x.samples.slice(-1800);
    if(Array.isArray(x.blockedSetupIds)) state.blockedSetupIds=x.blockedSetupIds.slice(-50);
    if(Array.isArray(x.aiRejectedSetupIds)) state.aiRejectedSetupIds=x.aiRejectedSetupIds.slice(-50);
    if(x.lastAiReview&&typeof x.lastAiReview==='object') state.lastAiReview=x.lastAiReview;
    if(x.signal&&typeof x.signal==='object') state.signal=x.signal;
    if(x.lastTerminal&&typeof x.lastTerminal==='object') state.lastTerminal=x.lastTerminal;
    if(Number.isFinite(Number(x.cooldownUntil))) state.cooldownUntil=Number(x.cooldownUntil);
  }catch{}
  normalizeLifecycleState(state);
  if(state.signal&&state.signal.aiReview?.decision!=='ALLOW'){
    state.lastTerminal={...state.signal,outcome:'AI_GATE_MIGRATION_CANCELLED',result:'CANCELLED',closedAtMs:Date.now(),closedAt:new Date().toISOString()};
    state.signal=null;
  }
}
loadStore();

const json=(res,status,body)=>{const data=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(data);};
const round=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
function timestampMs(value,fallback=Date.now()){
  const n=Number(value);
  if(Number.isFinite(n)&&n>0) return n>1e17?Math.floor(n/1e6):n>1e14?Math.floor(n/1e3):n>1e11?n:n>1e9?n*1000:fallback;
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:fallback;
}

async function getQuote(force=false){
  const now=Date.now();
  if(state.mt5.quote&&now-state.mt5.lastSeen<20_000){
    const q=state.mt5.quote; state.quote={...q,provider:'MT5_BROKER',degraded:now-Number(q.t)>30_000}; state.quoteAt=now; return state.quote;
  }
  if(!force&&state.quote&&now-state.quoteAt<4500) return state.quote;
  const providers=[];
  if(process.env.GOLD_ALPHA_QUOTE_URL) providers.push(async()=>{
    const r=await fetch(process.env.GOLD_ALPHA_QUOTE_URL,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
    const d=await r.json().catch(()=>({})); const bid=Number(d.bid),ask=Number(d.ask);
    const price=Number(d.price??(Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:NaN));
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid configured quote');
    const t=timestampMs(d.t??d.updatedAt,now);
    return {price,bid:Number.isFinite(bid)?bid:price,ask:Number.isFinite(ask)?ask:price,t,updatedAt:d.updatedAt||new Date(t).toISOString(),provider:d.provider||'CONFIGURED',degraded:now-t>30_000};
  });
  if(process.env.MASSIVE_API_KEY) providers.push(async()=>{
    const u=new URL('https://api.massive.com/v1/last_quote/currencies/XAU/USD');u.searchParams.set('apiKey',process.env.MASSIVE_API_KEY);
    const r=await fetch(u,{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/8.0'},signal:AbortSignal.timeout(6000)});
    const d=await r.json().catch(()=>({})); const x=d.last||d.results?.last||d.results||d;
    const bid=Number(x.bid??x.b??x.bid_price),ask=Number(x.ask??x.a??x.ask_price);
    const price=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:Number(x.price);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Massive quote');
    const t=timestampMs(x.timestamp??x.t??x.sip_timestamp??x.participant_timestamp,now);
    return {price,bid:Number.isFinite(bid)?bid:price,ask:Number.isFinite(ask)?ask:price,t,updatedAt:new Date(t).toISOString(),provider:'MASSIVE',degraded:now-t>30_000};
  });
  providers.push(async()=>{
    const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/8.0'},signal:AbortSignal.timeout(6000)});
    const d=await r.json().catch(()=>({})); const price=Number(d.price);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Gold API quote');
    const t=timestampMs(d.updatedAt??d.timestamp,now);
    return {price,bid:price,ask:price,t,updatedAt:d.updatedAt||new Date(t).toISOString(),provider:'GOLD_API',degraded:now-t>30_000};
  });
  let lastError;
  for(const provider of providers){try{state.quote=await provider();state.quoteAt=now;return state.quote;}catch(e){lastError=e;}}
  if(state.quote&&now-state.quoteAt<=120_000) return {...state.quote,degraded:true};
  throw lastError||new Error('no gold quote provider available');
}

function record(q){
  const t=Number(q.t)||Date.now(),p=Number(q.price); if(!Number.isFinite(p)||p<=0) return;
  const row={t,p,price:p,bid:Number(q.bid)||p,ask:Number(q.ask)||p},last=state.samples.at(-1);
  if(!last||t-last.t>=4000) state.samples.push(row); else Object.assign(last,row);
  const cutoff=Date.now()-2*60*60_000; state.samples=state.samples.filter(x=>x.t>=cutoff).slice(-1800);
}
const analyze=price=>analyzeGoldSignal(state.samples,price,Date.now());
const quoteIsFresh=(q,now)=>!q.degraded&&Number.isFinite(Number(q.t))&&Number(q.t)<=now+5000&&now-Number(q.t)<=30_000;
const insideEntry=(model,q)=>{
  const p=executableEntryPrice(model.candidateAction||model.side,q),lo=Number(model.entryLow),hi=Number(model.entryHigh);
  return Number.isFinite(p)&&Number.isFinite(lo)&&Number.isFinite(hi)&&p>=Math.min(lo,hi)&&p<=Math.max(lo,hi);
};
const entryNotMissed=(model,q)=>{
  const side=model.candidateAction||model.side,p=executableEntryPrice(side,q),lo=Number(model.entryLow),hi=Number(model.entryHigh);
  if(!Number.isFinite(p)||!Number.isFinite(lo)||!Number.isFinite(hi)) return false;
  return side==='BUY'?p<=hi:side==='SELL'?p>=lo:false;
};
const validApproval=(review,setupId,now)=>review?.allowed===true&&review?.decision==='ALLOW'&&review?.status==='APPROVED'&&String(review?.setupId||'')===String(setupId||'')&&Number(review?.expiresAtMs)>=now;
const idleReview=(status='IDLE',reason='بانتظار فرصة مكتملة للمراجعة',setupId=null)=>({required:true,configured:AI_REVIEWER.configured,allowed:false,decision:null,status,code:status,setupId,model:AI_REVIEWER.model,reason,riskFlags:[]});
function rememberRejection(review){state.lastAiReview=review;if(review?.setupId) state.aiRejectedSetupIds=[...new Set([...state.aiRejectedSetupIds,String(review.setupId)])].slice(-50);saveStore();}
function clearSignalPayload(r){Object.assign(r,{status:'WAIT',action:'WAIT',candidateAction:'WAIT',side:null,entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null});return r;}
function resetCandidate(){state.candidateTrack={side:'WAIT',setupId:null,count:0,firstSeen:0,lastSeen:Date.now(),lastQuoteAt:0,model:null};state.stableView=null;}
function updateStableCandidate(model,quoteAt){
  const now=Date.now(),side=['BUY','SELL'].includes(model.candidateAction)?model.candidateAction:'WAIT';
  if(side==='WAIT'){if(!state.signal) resetCandidate();return;}
  const setupId=setupFingerprint(model),t=state.candidateTrack;
  if(t.side!==side||t.setupId!==setupId){state.candidateTrack={side,setupId,count:1,firstSeen:now,lastSeen:now,lastQuoteAt:Number(quoteAt)||now,model};}
  else {t.count=1;t.lastSeen=now;t.lastQuoteAt=Number(quoteAt)||now;t.model=model;}
  state.stableView={...model,status:'CONFIRMED',action:'WAIT',candidateAction:side,confirmedAt:new Date(now).toISOString(),reason:`${side} مؤهل — AI يراجع قبل لمس النطاق`};
}

async function maybePreapprove(model,q,now){
  const setupId=['BUY','SELL'].includes(model.candidateAction)?setupFingerprint(model):null;
  if(!setupId||Number(model.confidence)<MIN_CONFIDENCE||!quoteIsFresh(q,now)||now<state.cooldownUntil||state.blockedSetupIds.includes(setupId)||state.aiRejectedSetupIds.includes(setupId)||!entryNotMissed(model,q)) return null;
  if(validApproval(state.lastAiReview,setupId,now)) return state.lastAiReview;
  const review=await reviewGoldCandidate({model,quote:q,now,minConfidence:MIN_CONFIDENCE,phase:'PRE_TOUCH',apiKey:process.env.OPENAI_API_KEY,modelId:AI_REVIEWER.model,timeoutMs:AI_REVIEWER.timeoutMs});
  state.lastAiReview={...review,configured:AI_REVIEWER.configured};
  if(!review.allowed) rememberRejection(state.lastAiReview); else saveStore();
  return state.lastAiReview;
}

async function evaluateSignal(execute){
  let q=await getQuote();record(q);let now=Date.now();
  const raw=analyze(q.price);updateStableCandidate(raw,q.t);let model=state.stableView||raw;
  if(model.setupId&&state.blockedSetupIds.includes(setupFingerprint(model))){resetCandidate();model=raw;}
  const eligible=state.candidateTrack.count>=1?model:{...model,candidateAction:'WAIT'};
  const setupId=['BUY','SELL'].includes(eligible.candidateAction)?setupFingerprint(eligible):null;
  let fresh=quoteIsFresh(q,now),currentReview=setupId?idleReview('PRE_REVIEW','AI يراجع السيناريو قبل لمس النطاق',setupId):idleReview();
  let approval=null;

  if(!state.signal&&setupId){
    const pre=await maybePreapprove(eligible,q,now);
    if(pre) currentReview={...pre,configured:AI_REVIEWER.configured};
    if(validApproval(pre,setupId,Date.now())&&insideEntry(eligible,q)){
      try{
        const verified=await getQuote(true);record(verified);const at=Date.now();
        if(quoteIsFresh(verified,at)&&insideEntry(eligible,verified)){
          q=verified;now=at;fresh=true;approval=pre;
        }else{
          const denied={...pre,allowed:false,decision:'DENY',status:'DENIED',code:'PRICE_MOVED_DURING_EXECUTION',reason:'تحرك السعر خارج نطاق الدخول قبل التنفيذ؛ أُلغيت الفرصة',expiresAtMs:at,reviewedAtMs:at,reviewedAt:new Date(at).toISOString()};
          rememberRejection(denied);currentReview=denied;
        }
      }catch{
        const at=Date.now(),denied={...pre,allowed:false,decision:'DENY',status:'DENIED',code:'QUOTE_VERIFY_FAILED',reason:'تعذر التحقق من السعر لحظة التنفيذ؛ أُلغيت الفرصة',expiresAtMs:at,reviewedAtMs:at,reviewedAt:new Date(at).toISOString()};
        rememberRejection(denied);currentReview=denied;
      }
    }
  } else if(state.signal?.aiReview) currentReview={...state.signal.aiReview,configured:AI_REVIEWER.configured};

  const result=processSignalLifecycle(state,{model:eligible,quote:{...q,t:Number(q.t)||now},observations:state.samples,now,execute:execute&&fresh,publish:fresh,approval,minConfidence:MIN_CONFIDENCE});
  if(result.terminal){upsertTrade({...result.terminal,status:'CLOSED'});resetCandidate();}
  else if(state.signal) upsertTrade({...state.signal,status:state.signal.brokerConfirmed?'OPEN':'SIGNAL'});
  saveStore();

  const shown=state.signal?model:(state.stableView||raw),response=signalResponse(state,shown,q,now,fresh);
  Object.assign(response,{readingCompleteness:raw.readingCompleteness,barCount:raw.barCount,sampleCount:raw.sampleCount,signalConfidence:state.signal?.confidence??shown.confidence,confirmationCount:state.candidateTrack.count,confirmationRequired:1,aiReview:state.signal?.aiReview?{...state.signal.aiReview,configured:AI_REVIEWER.configured}:currentReview,preApprovalTtlMs:PREAPPROVAL_TTL_MS});
  if(!state.signal&&response.blockedAfterStop){clearSignalPayload(response);response.reason=result.rejection==='PREENTRY_INVALIDATED'?'أُلغي السيناريو قبل الدخول لأن الوقف لُمِس — ننتظر بنية جديدة':'NO LATE ENTRY: تجاوز السعر نطاق الدخول أو لمس الهدف؛ أُلغيت الإشارة القديمة';}
  else if(!state.signal&&now<state.cooldownUntil) response.reason='COOLDOWN: انتظار انتهاء فترة الحماية قبل إشارة جديدة';
  else if(!state.signal&&setupId&&validApproval(currentReview,setupId,now)&&!insideEntry(eligible,q)) response.reason='AI PRE-APPROVED — انتظار أول لمس حي لنطاق الدخول';
  else if(!state.signal&&setupId&&['DENIED','ERROR'].includes(currentReview.status)){clearSignalPayload(response);response.reason=`لم تُعتمد الإشارة من AI: ${currentReview.reason}`;}
  if(q.degraded){response.action='WAIT';if(!state.signal) clearSignalPayload(response);response.reason='STALE QUOTE: أوقف إصدار الإشارة لأن بيانات السعر متأخرة أو احتياطية';}
  return response;
}

let signalQueue=Promise.resolve();
function signal(execute){const task=signalQueue.then(()=>evaluateSignal(execute),()=>evaluateSignal(execute));signalQueue=task.catch(()=>{});return task;}
function scheduleMt5Scan(){queueMicrotask(()=>signal(false).catch(()=>{}));}

function upsertTrade(ev){
  const ids=[ev.signalId,ev.positionId,ev.ticket].filter(v=>v!=null&&String(v)!=='').map(String);
  let t=ids.length?state.trades.find(x=>[x.signalId,x.positionId,x.ticket].filter(v=>v!=null).map(String).some(v=>ids.includes(v))):null;
  if(!t){t={id:ids[0]||`event-${Date.now()}`,createdAt:new Date().toISOString()};state.trades.push(t);}
  Object.assign(t,ev,{updatedAt:new Date().toISOString()});state.trades=state.trades.slice(-200);saveStore();return t;
}
function handleReport(body){
  const type=String(body.type||'').toUpperCase();state.mt5.lastSeen=Date.now();state.mt5.symbol=body.symbol||state.mt5.symbol;
  if(type==='HEARTBEAT'){
    state.mt5.tradingEnabled=!!body.tradingEnabled;state.mt5.liveAccount=!!body.liveAccount;state.mt5.positionOpen=!!body.positionOpen;
    const bid=Number(body.bid),ask=Number(body.ask),tickAt=timestampMs(body.tickAt,Date.now());
    if(Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid){state.mt5.quote={price:(bid+ask)/2,bid,ask,t:tickAt,updatedAt:new Date(tickAt).toISOString()};state.quote={...state.mt5.quote,provider:'MT5_BROKER',degraded:Date.now()-tickAt>30_000};state.quoteAt=Date.now();}
    scheduleMt5Scan();return {ok:true};
  }
  if(['OPEN','UPDATE','CLOSE'].includes(type)){
    const now=Date.now(),ev={...body,type};
    if(type==='OPEN'){const active=confirmBrokerOpen(state,body,now);if(active)Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,status:'OPEN'});else ev.status='OPEN_UNMATCHED';}
    if(type==='UPDATE'){const active=applyBrokerTargetReport(state,body);if(active)Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,targetHits:active.targetHits,status:'OPEN'});}
    if(type==='CLOSE'){
      const active=state.signal,reportPosition=String(body.positionId??body.ticket??''),same=!active?.brokerPositionId||!reportPosition||String(active.brokerPositionId)===reportPosition;
      if(active&&same){const reason=String(body.closeReason||body.reason||'CLOSED').toUpperCase(),outcome=reason.includes('SL')||reason.includes('STOP')?'SL':reason.includes('TP4')?'TP4':'BROKER_CLOSED';state.lastTerminal={...active,...body,outcome,result:outcome,closedAtMs:now,closedAt:body.closedAt||new Date(now).toISOString(),exitPrice:Number(body.exitPrice??body.closePrice)||null};if(outcome==='SL'&&active.setupId)state.blockedSetupIds=[...new Set([...state.blockedSetupIds,active.setupId])].slice(-50);state.cooldownUntil=now+(outcome==='SL'?180_000:90_000);state.signal=null;Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,outcome});}
      ev.status='CLOSED';
    }
    const t=upsertTrade(ev);state.mt5.positionOpen=type!=='CLOSE';saveStore();return {ok:true,trade:t};
  }
  return {ok:false,error:'Unsupported report type'};
}

async function readBody(req){return await new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000){reject(new Error('body too large'));req.destroy();}});req.on('end',()=>resolve(s));req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'});return res.end();}
  try{
    if(req.method==='GET'&&url.pathname==='/') return json(res,200,{service:'Gold Alpha Pro',mode:'XAUUSD_ONLY',aiGate:'PRE_TOUCH',btc:false});
    if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{ok:true,service:'gold-alpha-pro',btc:false,lifecycle:'ai-preapproved-touch-v5',quoteProvider:state.quote?.provider||null,quoteAgeMs:state.quote?.t?Math.max(0,Date.now()-Number(state.quote.t)):null,aiReviewer:{required:true,configured:AI_REVIEWER.configured,model:AI_REVIEWER.model,lastDecision:state.lastAiReview?.decision||null,lastStatus:state.lastAiReview?.status||'IDLE',phase:state.lastAiReview?.phase||null}});
    if(req.method==='GET'&&url.pathname==='/api/gold'){const q=await getQuote();record(q);return json(res,200,{...q,analysis:analyze(q.price)});}
    if(req.method==='GET'&&url.pathname==='/api/gold-live'){const q=await getQuote();record(q);const recent=state.samples.filter(x=>x.t>=Date.now()-60*60_000);return json(res,200,{...q,observedLow:recent.length?Math.min(...recent.map(x=>x.p)):q.price,observedHigh:recent.length?Math.max(...recent.map(x=>x.p)):q.price,sampleCount:recent.length});}
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal') return json(res,200,await signal(url.searchParams.get('observe')!=='1'));
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/trades') return json(res,200,{trades:state.trades});
    if(req.method==='GET'&&url.pathname==='/api/performance/journal'){const closed=state.trades.filter(x=>x.status==='CLOSED'),wins=closed.filter(x=>x.outcome==='TP4'||Number(x.profit)>0).length;return json(res,200,{summary:{total:state.trades.length,closed:closed.length,wins,losses:closed.length-wins,winRate:closed.length?round(wins/closed.length*100,1):0},activeSignal:state.signal,lastTerminal:state.lastTerminal,trades:state.trades.slice().reverse()});}
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/status'){const connected=Date.now()-state.mt5.lastSeen<20_000;return json(res,200,{mt5:{...state.mt5,connected},activeSignal:state.signal,lastTerminal:state.lastTerminal,trades:state.trades,stabilization:{track:state.candidateTrack,stable:state.stableView},aiReviewer:{...AI_REVIEWER,lastReview:state.lastAiReview,rejectedSetupIds:state.aiRejectedSetupIds},blockedSetupIds:state.blockedSetupIds});}
    if(req.method==='POST'&&url.pathname==='/api/auto-trade/report'){const raw=await readBody(req);let body={};try{body=JSON.parse(raw||'{}')}catch{return json(res,400,{ok:false,error:'Invalid JSON'});}const out=handleReport(body);return json(res,out.ok?200:400,out);}
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);return json(res,503,{error:'Service unavailable',detail:String(e?.message||e)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Gold Alpha Pro listening on ${PORT} with AI pre-touch approval`));
