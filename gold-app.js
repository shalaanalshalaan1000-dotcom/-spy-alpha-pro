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

const PORT = Number(process.env.PORT || 3000);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 65);
const DATA_DIR = process.env.GOLD_ALPHA_DATA_DIR || '/tmp/gold-alpha';
const STORE_PATH = process.env.GOLD_ALPHA_STORE_PATH || join(DATA_DIR, 'state.json');
const CONFIRM_COUNT = 3;
const CONFIRM_WINDOW_MS = 20_000;

const state = {
  samples: [],
  quote: null,
  quoteAt: 0,
  signal: null,
  lastTerminal: null,
  blockedSetupIds: [],
  cooldownUntil: 0,
  candidateTrack: { side: 'WAIT', setupId:null, count: 0, firstSeen: 0, lastSeen: 0, lastQuoteAt:0, model: null },
  stableView: null,
  mt5: { lastSeen: 0, tradingEnabled: false, liveAccount: false, positionOpen: false, symbol: 'XAUUSD', quote:null },
  trades: []
};

function loadStore() {
  try {
    mkdirSync(DATA_DIR, {recursive:true});
    if (!existsSync(STORE_PATH)) return;
    const x = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (Array.isArray(x.trades)) state.trades = x.trades.slice(-200);
    if (Array.isArray(x.samples)) state.samples = x.samples.slice(-1800);
    if (Array.isArray(x.blockedSetupIds)) state.blockedSetupIds = x.blockedSetupIds.slice(-50);
    if (x.signal && typeof x.signal === 'object') state.signal = x.signal;
    if (x.lastTerminal && typeof x.lastTerminal === 'object') state.lastTerminal = x.lastTerminal;
    if (Number.isFinite(Number(x.cooldownUntil))) state.cooldownUntil = Number(x.cooldownUntil);
  } catch {}
  normalizeLifecycleState(state);
}
function saveStore() {
  try {
    mkdirSync(DATA_DIR, {recursive:true});
    const tmp = `${STORE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      trades:state.trades.slice(-200), samples:state.samples.slice(-1800),
      signal:state.signal, lastTerminal:state.lastTerminal,
      blockedSetupIds:state.blockedSetupIds.slice(-50), cooldownUntil:state.cooldownUntil
    }));
    renameSync(tmp, STORE_PATH);
  } catch {}
}
loadStore();

const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(data);
};
const html = (res, body) => {
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end(body);
};
const round = (v, d=2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
function timestampMs(value, fallback=Date.now()) {
  const n=Number(value);
  if(Number.isFinite(n)&&n>0) return n>1e17?Math.floor(n/1e6):n>1e14?Math.floor(n/1e3):n>1e11?n:n>1e9?n*1000:fallback;
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:fallback;
}

async function getQuote() {
  const now = Date.now();
  if(state.mt5.quote&&now-state.mt5.lastSeen<20_000){
    const q=state.mt5.quote;state.quote={...q,provider:'MT5_BROKER',degraded:now-Number(q.t)>30_000};state.quoteAt=now;return state.quote;
  }
  if (state.quote && now - state.quoteAt < 4500) return state.quote;
  const providers = [];
  if (process.env.GOLD_ALPHA_QUOTE_URL) providers.push(async()=>{
    const r=await fetch(process.env.GOLD_ALPHA_QUOTE_URL,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
    const d=await r.json().catch(()=>({})); const bid=Number(d.bid),ask=Number(d.ask);
    const price=Number(d.price??(Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:NaN));
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid configured quote');
    const t=timestampMs(d.t??d.updatedAt,now);
    return {price,bid:Number.isFinite(bid)?bid:price,ask:Number.isFinite(ask)?ask:price,t,updatedAt:d.updatedAt||new Date(t).toISOString(),provider:d.provider||'CONFIGURED',degraded:now-t>30_000};
  });
  if (process.env.MASSIVE_API_KEY) providers.push(async()=>{
    const u=new URL('https://api.massive.com/v1/last_quote/currencies/XAU/USD');u.searchParams.set('apiKey',process.env.MASSIVE_API_KEY);
    const r=await fetch(u,{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/7.0'},signal:AbortSignal.timeout(9000)});
    const d=await r.json().catch(()=>({})); const x=d.last||d.results?.last||d.results||d;
    const bid=Number(x.bid??x.b??x.bid_price), ask=Number(x.ask??x.a??x.ask_price);
    const price=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:Number(x.price);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Massive quote');
    const t=timestampMs(x.timestamp??x.t??x.sip_timestamp??x.participant_timestamp,now);
    return {price,bid:Number.isFinite(bid)?bid:price,ask:Number.isFinite(ask)?ask:price,t,updatedAt:new Date(t).toISOString(),provider:'MASSIVE',degraded:now-t>30_000};
  });
  providers.push(async()=>{
    const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/7.0'},signal:AbortSignal.timeout(9000)});
    const d=await r.json().catch(()=>({})); const price=Number(d.price);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Gold API quote');
    const t=timestampMs(d.updatedAt??d.timestamp,now);
    return {price,bid:price,ask:price,t,updatedAt:d.updatedAt||new Date(t).toISOString(),provider:'GOLD_API',degraded:now-t>30_000};
  });
  providers.push(async()=>{
    const r=await fetch('https://data-asg.goldprice.org/dbXRates/USD',{cache:'no-store',headers:{accept:'application/json','user-agent':'Mozilla/5.0 GoldAlphaPro/7.0'},signal:AbortSignal.timeout(9000)});
    const d=await r.json().catch(()=>({})); const price=Number(d.items?.[0]?.xauPrice);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid GoldPrice quote');
    const t=timestampMs(d.ts??d.timestamp,now);
    return {price,bid:price,ask:price,t,updatedAt:new Date(t).toISOString(),provider:'GOLDPRICE',degraded:now-t>30_000};
  });
  providers.push(async()=>{
    const r=await fetch('https://stooq.com/q/l/?s=xauusd&i=1',{cache:'no-store',headers:{accept:'text/csv','user-agent':'GoldAlphaPro/7.0'},signal:AbortSignal.timeout(9000)});
    const text=await r.text();const rows=text.trim().split(/\r?\n/);const cells=(rows.at(-1)||'').split(',');
    const price=Number(cells[6]);const date=String(cells[1]||''),time=String(cells[2]||'').padStart(6,'0');
    const t=timestampMs(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}Z`,now);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Stooq quote');
    return {price,bid:price,ask:price,t,updatedAt:new Date(t).toISOString(),provider:'STOOQ_REFERENCE',degraded:true};
  });
  providers.push(async()=>{
    const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d',{cache:'no-store',headers:{accept:'application/json','user-agent':'Mozilla/5.0 GoldAlphaPro/7.0'},signal:AbortSignal.timeout(9000)});
    const d=await r.json().catch(()=>({}));const result=d.chart?.result?.[0],meta=result?.meta||{},timestamps=result?.timestamp||[];
    const price=Number(meta.regularMarketPrice);const t=timestampMs(timestamps.at(-1),now);
    if(!r.ok||!Number.isFinite(price)||price<=0) throw new Error('invalid Yahoo gold reference');
    return {price,bid:price,ask:price,t,updatedAt:new Date(t).toISOString(),provider:'GOLD_FUTURES_REFERENCE',degraded:true};
  });
  let lastError;
  for (const provider of providers) {
    try { state.quote=await provider(); state.quoteAt=now; return state.quote; }
    catch(e){ lastError=e; }
  }
  if (state.quote && now-state.quoteAt<=120_000) return {...state.quote,degraded:true};
  throw lastError||new Error('no gold quote provider available');
}

function record(quote) {
  const now = Number(quote.t)||Date.now();
  const p = Number(quote.price);
  if (!Number.isFinite(p) || p <= 0) return;
  const last = state.samples.at(-1);
  const row={t:now,p,price:p,bid:Number(quote.bid)||p,ask:Number(quote.ask)||p};
  if (!last || now-last.t >= 4000) state.samples.push(row);
  else Object.assign(last,row);
  const cutoff=Date.now()-2*60*60_000;
  state.samples = state.samples.filter(x=>x.t >= cutoff).slice(-1800);
}

function bars1m() {
  const m = new Map();
  for (const s of state.samples) {
    const k = Math.floor(s.t / 60000) * 60000;
    const b = m.get(k);
    if (!b) m.set(k,{t:k,open:s.p,high:s.p,low:s.p,close:s.p});
    else {
      b.high=Math.max(b.high,s.p); b.low=Math.min(b.low,s.p); b.close=s.p;
    }
  }
  return [...m.values()].sort((a,b)=>a.t-b.t);
}

function analyze(price) {
  const now = Date.now();
  const allBars = bars1m();
  const closed = allBars.filter(b=>b.t+60000<=now);
  const completeness = Math.min(100, Math.round((Math.min(closed.length,5)/5)*100));
  const recent = closed.slice(-8);
  const base = {
    status: closed.length < 5 ? 'COLLECTING' : 'WAIT',
    action:'WAIT', candidateAction:'WAIT', side:null,
    strategy:'READING', confidence:0, readingCompleteness:completeness,
    barCount:closed.length, sampleCount:state.samples.length, price:round(price),
    entry:null,entryLow:null,entryHigh:null,stopLoss:null,
    target1:null,target2:null,target3:null,target4:null,riskReward:null,
    reason: closed.length < 5 ? `جمع بيانات M1: ${closed.length}/5` : 'القراءة مكتملة — لا توجد إشارة مؤهلة الآن',
    updatedAt:new Date(now).toISOString()
  };
  if (closed.length < 5) return base;

  const ranges = recent.map(b=>b.high-b.low).filter(x=>x>0);
  const atr = ranges.length ? ranges.reduce((a,b)=>a+b,0)/ranges.length : Math.max(.5, price*.00015);
  const closes = recent.slice(-5).map(b=>b.close);
  const slope = closes.at(-1)-closes[0];
  const prev3 = recent.slice(-4,-1);
  const hi3 = Math.max(...prev3.map(b=>b.high));
  const lo3 = Math.min(...prev3.map(b=>b.low));
  let side=null, strategy=null, confidence=0, stop=null, entryBase=null, structureAt=null;

  const trendUp = slope > atr*.75 && closes.at(-1) > hi3;
  const trendDown = slope < -atr*.75 && closes.at(-1) < lo3;
  if (trendUp) {
    side='BUY'; strategy='TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(slope)/Math.max(atr,.01)*5));
    stop = Math.min(...recent.slice(-3).map(b=>b.low)) - .25;
    entryBase = hi3;
    structureAt = recent.at(-1).t;
  } else if (trendDown) {
    side='SELL'; strategy='TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(slope)/Math.max(atr,.01)*5));
    stop = Math.max(...recent.slice(-3).map(b=>b.high)) + .25;
    entryBase = lo3;
    structureAt = recent.at(-1).t;
  }

  if (!side && recent.length >= 6) {
    for (let i=Math.max(4,recent.length-4); i<recent.length-1; i++) {
      const prior = recent.slice(Math.max(0,i-4),i);
      const c = recent[i], after = recent.slice(i+1);
      const ph = Math.max(...prior.map(b=>b.high)), pl=Math.min(...prior.map(b=>b.low));
      const bullSweep = c.low < pl && c.close > pl;
      const bearSweep = c.high > ph && c.close < ph;
      const bullMss = bullSweep && after.some(b=>b.close > Math.max(...prior.slice(-2).map(x=>x.high)));
      const bearMss = bearSweep && after.some(b=>b.close < Math.min(...prior.slice(-2).map(x=>x.low)));
      if (bullMss) { side='BUY'; strategy='ICT_REVERSAL'; confidence=72; stop=c.low-.25; entryBase=Math.max(...prior.slice(-2).map(x=>x.high)); structureAt=c.t; }
      if (bearMss) { side='SELL'; strategy='ICT_REVERSAL'; confidence=72; stop=c.high+.25; entryBase=Math.min(...prior.slice(-2).map(x=>x.low)); structureAt=c.t; }
    }
  }

  if (!side) {
    const impulse = Math.min(60, Math.round(Math.abs(slope)/Math.max(atr,.01)*20));
    return {...base, status:'WAIT', confidence:impulse, reason:'القراءة 100% — الثقة الحالية لا تكفي لدخول جديد'};
  }

  confidence = Math.min(90, confidence);
  const chaseDistance = Math.abs(price-entryBase);
  const maxChase = Math.max(1.25, atr*.75);
  if (chaseDistance > maxChase) {
    return {...base,status:'WAIT',candidateAction:'WAIT',confidence,strategy,
      reason:'NO CHASE: تحرك السعر بعيدًا عن مستوى الدخول؛ ننتظر إعادة اختبار أو إشارة جديدة'};
  }
  const risk = Math.abs(entryBase-stop);
  if (risk < .6 || risk > 6) {
    return {...base,status:'WAIT',candidateAction:side,confidence,strategy,
      reason:risk<.6?'إشارة موجودة لكن وقف الخسارة قريب جدًا':'إشارة موجودة لكن وقف الخسارة واسع أكثر من 6$'};
  }
  const dir = side==='BUY' ? 1 : -1;
  const half = Math.min(.8, Math.max(.20, atr*.18));
  const d1=Math.max(1.8,risk*1.4), d2=Math.max(3,risk*2), d3=Math.max(4,risk*2.5), d4=Math.max(5,risk*3);
  const setupId=[side,strategy,structureAt,round(entryBase),round(stop)].join('|');
  return {
    ...base,status:'CANDIDATE',candidateAction:side,side,strategy,confidence,
    setupId,structureAt,
    entry:round(entryBase),entryLow:round(entryBase-half),entryHigh:round(entryBase+half),stopLoss:round(stop),
    target1:round(entryBase+dir*d1),target2:round(entryBase+dir*d2),target3:round(entryBase+dir*d3),target4:round(entryBase+dir*d4),
    riskReward:round(d4/risk,2),
    reason:strategy==='ICT_REVERSAL'?'ICT reversal مكتمل':'استمرار ترند مؤكد'
  };
}

function updateStableCandidate(model, quoteAt) {
  const now = Date.now();
  const side = ['BUY','SELL'].includes(model.candidateAction) ? model.candidateAction : 'WAIT';
  const setupId = side === 'WAIT' ? null : setupFingerprint(model);
  const t = state.candidateTrack;

  if (side === 'WAIT') {
    if (t.side !== 'WAIT' && t.lastSeen && now - t.lastSeen > CONFIRM_WINDOW_MS) {
      state.candidateTrack = { side:'WAIT', setupId:null, count:0, firstSeen:0, lastSeen:0, lastQuoteAt:0, model:null };
      if (!state.signal) state.stableView = null;
    }
    return;
  }

  if (t.side !== side || t.setupId !== setupId || now - t.lastSeen > CONFIRM_WINDOW_MS) {
    state.candidateTrack = { side, setupId, count:1, firstSeen:now, lastSeen:now, lastQuoteAt:Number(quoteAt)||now, model };
    return;
  }

  if (Number(quoteAt) && Number(quoteAt) === Number(t.lastQuoteAt)) return;
  t.count += 1;
  t.lastSeen = now;
  t.lastQuoteAt = Number(quoteAt)||now;
  t.model = model;

  if (t.count >= CONFIRM_COUNT) {
    state.stableView = {
      ...model,
      status:'CONFIRMED',
      action:'WAIT',
      candidateAction:side,
      confirmedAt:new Date(now).toISOString(),
      reason:`${side} مؤكد بعد ${CONFIRM_COUNT} قراءات متتالية`
    };
  }
}

async function signal(execute) {
  const q = await getQuote();
  record(q);
  const now = Date.now();
  const rawModel = analyze(q.price);
  updateStableCandidate(rawModel,q.t);
  let model=state.stableView||rawModel;
  if(model.setupId&&state.blockedSetupIds.includes(setupFingerprint(model))){state.stableView=null;model=rawModel;}
  const eligible=state.candidateTrack.count>=CONFIRM_COUNT?model:{...model,candidateAction:'WAIT'};
  const safeExecute=execute&&!q.degraded&&now-(Number(q.t)||now)<=30_000;
  const result=processSignalLifecycle(state,{model:eligible,quote:{...q,t:Number(q.t)||now},observations:state.samples,now,execute:safeExecute,minConfidence:MIN_CONFIDENCE});
  if(result.terminal){
    upsertTrade({...result.terminal,status:'CLOSED'});
    state.stableView=null;
    state.candidateTrack={side:'WAIT',setupId:null,count:0,firstSeen:0,lastSeen:now,lastQuoteAt:0,model:null};
  }else if(state.signal){
    upsertTrade({...state.signal,status:state.signal.brokerConfirmed?'OPEN':'SIGNAL'});
  }
  saveStore();
  const shown=state.signal?model:(state.stableView||rawModel);
  const response=signalResponse(state,shown,q,now,safeExecute);
  Object.assign(response,{
    readingCompleteness:rawModel.readingCompleteness,barCount:rawModel.barCount,
    sampleCount:rawModel.sampleCount,signalConfidence:state.signal?.confidence??shown.confidence,
    confirmationCount:state.candidateTrack.count,confirmationRequired:CONFIRM_COUNT
  });
  if(!state.signal&&['BUY','SELL'].includes(rawModel.candidateAction)&&state.candidateTrack.count<CONFIRM_COUNT)
    response.reason=`انتظار تثبيت ${rawModel.candidateAction}: ${state.candidateTrack.count}/${CONFIRM_COUNT}`;
  if(!state.signal&&response.blockedAfterStop) response.reason='SETUP BLOCKED: أُلغيت هذه البنية سابقًا؛ ننتظر بنية سوق جديدة';
  else if(!state.signal&&now<state.cooldownUntil) response.reason='COOLDOWN: انتظار انتهاء فترة الحماية قبل إشارة جديدة';
  if(q.degraded) response.reason='STALE QUOTE: أوقف التنفيذ لأن بيانات السعر متأخرة أو احتياطية';
  return response;
}

function upsertTrade(ev) {
  const identities=[ev.signalId,ev.positionId,ev.ticket].filter(v=>v!=null&&String(v)!=='').map(String);
  const key=identities[0]||'';
  let t=identities.length?state.trades.find(x=>[x.signalId,x.positionId,x.ticket].filter(v=>v!=null).map(String).some(v=>identities.includes(v))):null;
  if (!t) {
    t = { id:key || `event-${Date.now()}`, createdAt:new Date().toISOString() };
    state.trades.push(t);
  }
  Object.assign(t, ev, {updatedAt:new Date().toISOString()});
  state.trades = state.trades.slice(-200);
  saveStore();
  return t;
}

function handleReport(body) {
  const type = String(body.type||'').toUpperCase();
  state.mt5.lastSeen=Date.now();
  state.mt5.symbol=body.symbol||state.mt5.symbol;
  if (type==='HEARTBEAT') {
    state.mt5.tradingEnabled=!!body.tradingEnabled;
    state.mt5.liveAccount=!!body.liveAccount;
    state.mt5.positionOpen=!!body.positionOpen;
    const bid=Number(body.bid),ask=Number(body.ask),tickAt=timestampMs(body.tickAt,Date.now());
    if(Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid){
      state.mt5.quote={price:(bid+ask)/2,bid,ask,t:tickAt,updatedAt:new Date(tickAt).toISOString()};
      state.quote={...state.mt5.quote,provider:'MT5_BROKER',degraded:Date.now()-tickAt>30_000};state.quoteAt=Date.now();
    }
    return {ok:true};
  }
  if (['OPEN','UPDATE','CLOSE'].includes(type)) {
    const now=Date.now();
    const ev={...body,type};
    if(type==='OPEN'){
      const active=confirmBrokerOpen(state,body,now);
      if(active) Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,status:'OPEN'});
      else ev.status='OPEN_UNMATCHED';
    }
    if(type==='UPDATE'){
      const active=applyBrokerTargetReport(state,body);
      if(active) Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,targetHits:active.targetHits,status:'OPEN'});
    }
    if(type==='CLOSE'){
      const active=state.signal;
      const reportPosition=String(body.positionId??body.ticket??'');
      const samePosition=!active?.brokerPositionId||!reportPosition||String(active.brokerPositionId)===reportPosition;
      if(active&&samePosition){
        const reason=String(body.closeReason||body.reason||'CLOSED').toUpperCase();
        const outcome=reason.includes('SL')||reason.includes('STOP')?'SL':reason.includes('TP4')?'TP4':'BROKER_CLOSED';
        state.lastTerminal={...active,...body,outcome,result:outcome,closedAtMs:now,closedAt:body.closedAt||new Date(now).toISOString(),exitPrice:Number(body.exitPrice??body.closePrice)||null};
        if(outcome==='SL'&&active.setupId) state.blockedSetupIds=[...new Set([...state.blockedSetupIds,active.setupId])].slice(-50);
        state.cooldownUntil=now+(outcome==='SL'?180_000:90_000);
        state.signal=null;
        Object.assign(ev,{signalId:active.signalId,setupId:active.setupId,outcome});
      }
      ev.status='CLOSED';
    }
    const t=upsertTrade(ev);
    state.mt5.positionOpen=type!=='CLOSE';
    saveStore();
    return {ok:true,trade:t};
  }
  return {ok:false,error:'Unsupported report type'};
}

const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gold Alpha Pro</title><style>:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#080b12;color:#eef2ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#111a2d,#080b12 42%);min-height:100vh}header{padding:18px max(14px,4vw);border-bottom:1px solid #26324a;background:#0c111ddd;position:sticky;top:0;z-index:2}h1{margin:0;font-size:25px;color:#f4dfa0}header p{margin:5px 0 0;color:#9da9c3;font-size:12px}main{max-width:1200px;margin:auto;padding:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:12px}.card,.panel{background:#0e1524;border:1px solid #273550;border-radius:15px;padding:13px}.card span,.muted{color:#8ea0c0;font-size:11px}.card strong{display:block;margin-top:6px;font-size:20px;direction:ltr}.gold{color:#f5d773}.green{color:#52e5a5}.red{color:#ff718c}.warn{color:#ffd166}.panel{margin-bottom:12px}.panel h2{margin:0 0 12px;font-size:16px}.auto{border-color:#2e6654;background:linear-gradient(145deg,#0f1d19,#0c121c)}.auto h2{color:#72dfb5}.reading{display:grid;grid-template-columns:1fr 1fr;gap:9px}.meter{height:9px;background:#1b263a;border-radius:999px;overflow:hidden;margin-top:8px}.meter>i{display:block;height:100%;background:#52e5a5;width:0}.meter.conf>i{background:#ffd166}.targets{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.target{padding:10px;border:1px solid #334155;border-radius:10px;background:#0b1220}.target span{font-size:10px;color:#8ea0c0}.target strong{display:block;margin-top:5px;direction:ltr}.chart{height:420px;border-radius:14px;overflow:hidden;border:1px solid #273550;margin-bottom:12px}.chart iframe{width:100%;height:100%;border:0}.tableWrap{overflow:auto}.trades{width:100%;border-collapse:collapse;min-width:850px}.trades th,.trades td{padding:9px;border-bottom:1px solid #273550;text-align:right;font-size:12px;white-space:nowrap}.trades th{color:#8ea0c0}.empty{text-align:center!important;color:#8ea0c0}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.reading{grid-template-columns:1fr}.targets{grid-template-columns:repeat(2,1fr)}.chart{height:360px}}</style></head><body><header><h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • AUTO TRADING • BTC OFF</p></header><main><section class="grid"><div class="card"><span>سعر الذهب</span><strong id="price" class="gold">—</strong></div><div class="card"><span>الاتجاه القصير</span><strong id="direction">—</strong></div><div class="card"><span>اكتمال القراءة</span><strong id="completion" class="green">0%</strong></div><div class="card"><span>ثقة الإشارة الحالية</span><strong id="confidence" class="warn">0%</strong></div></section><section class="panel reading"><div><div class="muted">اكتمال القراءة</div><div class="meter"><i id="completionBar"></i></div><p id="readingNote" class="muted">جاري جمع البيانات…</p></div><div><div class="muted">تثبيت الإشارة</div><div class="meter conf"><i id="confidenceBar"></i></div><p id="signalNote" class="muted">لا توجد إشارة حاليًا</p></div></section><section class="panel auto"><h2>XAUUSD — التداول الآلي</h2><section class="grid"><div class="card"><span>MT5</span><strong id="mt5">غير متصل</strong></div><div class="card"><span>الحالة</span><strong id="action">WAIT</strong></div><div class="card"><span>نطاق الدخول</span><strong id="range">—</strong></div><div class="card"><span>وقف الخسارة</span><strong id="sl">—</strong></div></section><div class="targets"><div class="target"><span>TP1</span><strong id="tp1">—</strong></div><div class="target"><span>TP2</span><strong id="tp2">—</strong></div><div class="target"><span>TP3</span><strong id="tp3">—</strong></div><div class="target"><span>TP4</span><strong id="tp4">—</strong></div></div><p id="autoNote" class="muted">يتم تحديث حالة المحرك كل 5 ثوانٍ.</p></section><div class="chart"><iframe src="https://s.tradingview.com/widgetembed/?symbol=OANDA%3AXAUUSD&interval=5&theme=dark&style=1&timezone=Asia%2FRiyadh&hideideas=1"></iframe></div></main><script>const $=s=>document.querySelector(s), money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';let completionHigh=0;async function refresh(){try{const [sr,tr]=await Promise.all([fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),fetch('/api/auto-trade/status',{cache:'no-store'})]);const s=await sr.json(),st=await tr.json();completionHigh=Math.max(completionHigh,Number(s.readingCompleteness||0));const complete=Math.min(100,completionHigh),conf=Math.max(0,Math.min(100,Number(s.signalConfidence??s.confidence??0)));$('#price').textContent=money(s.price);$('#completion').textContent=complete+'%';$('#completionBar').style.width=complete+'%';$('#confidence').textContent=conf+'%';$('#confidenceBar').style.width=conf+'%';$('#direction').textContent=s.candidateAction==='BUY'?'صاعد':s.candidateAction==='SELL'?'هابط':'متوازن';$('#readingNote').textContent=complete>=100?'القراءة مكتملة 100% — تستمر مراقبة السوق':'جمع بيانات M1: '+Number(s.barCount||0)+'/5';$('#signalNote').textContent=s.reason||'—';const act=s.action||'WAIT';$('#action').textContent=act;$('#action').className=act==='BUY'?'green':act==='SELL'?'red':'warn';$('#range').textContent=s.entryLow?money(s.entryLow)+' — '+money(s.entryHigh):'—';$('#sl').textContent=money(s.stopLoss);$('#tp1').textContent=money(s.target1);$('#tp2').textContent=money(s.target2);$('#tp3').textContent=money(s.target3);$('#tp4').textContent=money(s.target4);const connected=!!st.mt5?.connected;$('#mt5').textContent=connected?(st.mt5.tradingEnabled?'متصل • التداول مفعل':'متصل • مراقبة'):'غير متصل';$('#mt5').className=connected?'green':'red';$('#autoNote').textContent=(s.status||'WAIT')+' • '+(s.strategy||'READING')+' • '+(s.reason||'');}catch(e){$('#autoNote').textContent='تعذر تحديث المحرك: '+e.message}}refresh();setInterval(refresh,5000);</script></body></html>`;

async function readBody(req) {
  return await new Promise((resolve,reject)=>{
    let s=''; req.on('data',c=>{s+=c; if(s.length>100000){reject(new Error('body too large'));req.destroy();}});
    req.on('end',()=>resolve(s)); req.on('error',reject);
  });
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'});return res.end();}
  try{
    if(req.method==='GET'&&url.pathname==='/') return html(res,PAGE);
    if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{ok:true,service:'gold-alpha-pro',btc:false,lifecycle:'unified-v2',quoteProvider:state.quote?.provider||null,quoteAgeMs:state.quoteAt?Date.now()-state.quoteAt:null});
    if(req.method==='GET'&&url.pathname==='/api/gold'){
      const q=await getQuote(); record(q); return json(res,200,{...q,analysis:analyze(q.price)});
    }
    if(req.method==='GET'&&url.pathname==='/api/gold-live'){
      const q=await getQuote(); record(q); const recent=state.samples.filter(x=>x.t>=Date.now()-60*60_000);
      return json(res,200,{...q,observedLow:recent.length?Math.min(...recent.map(x=>x.p)):q.price,observedHigh:recent.length?Math.max(...recent.map(x=>x.p)):q.price,sampleCount:recent.length});
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){
      return json(res,200,await signal(url.searchParams.get('observe')!=='1'));
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/trades') return json(res,200,{trades:state.trades});
    if(req.method==='GET'&&url.pathname==='/api/performance/journal'){
      const closed=state.trades.filter(x=>x.status==='CLOSED');
      const wins=closed.filter(x=>x.outcome==='TP4'||Number(x.profit)>0).length;
      return json(res,200,{summary:{total:state.trades.length,closed:closed.length,wins,losses:closed.length-wins,winRate:closed.length?round(wins/closed.length*100,1):0},activeSignal:state.signal,lastTerminal:state.lastTerminal,trades:state.trades.slice().reverse()});
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/status'){
      const connected=Date.now()-state.mt5.lastSeen<20_000;
      return json(res,200,{mt5:{...state.mt5,connected},activeSignal:state.signal,lastTerminal:state.lastTerminal,trades:state.trades,stabilization:{track:state.candidateTrack,stable:state.stableView},blockedSetupIds:state.blockedSetupIds});
    }
    if(req.method==='POST'&&url.pathname==='/api/auto-trade/report'){
      const raw=await readBody(req); let body={}; try{body=JSON.parse(raw||'{}')}catch{return json(res,400,{ok:false,error:'Invalid JSON'})}
      const out=handleReport(body); return json(res,out.ok?200:400,out);
    }
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);return json(res,503,{error:'Service unavailable',detail:String(e?.message||e)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Gold Alpha Pro listening on ${PORT} with stabilized signals`));
