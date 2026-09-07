import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = Number(process.env.PORT || 3000);
const MIN_CONFIDENCE = 65;
const SIGNAL_TTL_MS = 90_000;
const SIGNAL_MAX_LIFE_MS = 4 * 60 * 60_000;
const STORE_PATH = '/tmp/gold-alpha-trades.json';
const CONFIRM_COUNT = 3;
const CONFIRM_WINDOW_MS = 20_000;

const state = {
  samples: [],
  quote: null,
  quoteAt: 0,
  signal: null,
  cooldownUntil: 0,
  candidateTrack: { side: 'WAIT', count: 0, firstSeen: 0, lastSeen: 0, model: null },
  stableView: null,
  mt5: { lastSeen: 0, tradingEnabled: false, liveAccount: false, positionOpen: false, symbol: 'XAUUSD' },
  trades: []
};

function loadStore() {
  try {
    if (!existsSync(STORE_PATH)) return;
    const x = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (Array.isArray(x.trades)) state.trades = x.trades.slice(-200);
  } catch {}
}
function saveStore() {
  try { writeFileSync(STORE_PATH, JSON.stringify({trades: state.trades.slice(-200)})); } catch {}
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

async function getQuote() {
  const now = Date.now();
  if (state.quote && now - state.quoteAt < 4500) return state.quote;
  try {
    const r = await fetch('https://api.gold-api.com/price/XAU', {
      cache:'no-store',
      headers:{accept:'application/json','user-agent':'GoldAlphaPro/6.1'},
      signal: AbortSignal.timeout(12000)
    });
    const d = await r.json().catch(()=>({}));
    const price = Number(d.price);
    if (!r.ok || !Number.isFinite(price) || price <= 0) throw new Error('invalid gold quote');
    state.quote = {price, updatedAt:d.updatedAt || new Date().toISOString(), provider:'GOLD_API', degraded:false};
    state.quoteAt = now;
    return state.quote;
  } catch (e) {
    if (state.quote) return {...state.quote, degraded:true};
    throw e;
  }
}

function record(price) {
  const now = Date.now();
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return;
  const last = state.samples.at(-1);
  if (!last || now-last.t >= 4000) state.samples.push({t:now,p});
  else last.p = p;
  state.samples = state.samples.filter(x=>x.t >= now-2*60*60_000).slice(-1800);
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
  let side=null, strategy=null, confidence=0, stop=null;

  const trendUp = slope > atr*.75 && closes.at(-1) > hi3;
  const trendDown = slope < -atr*.75 && closes.at(-1) < lo3;
  if (trendUp) {
    side='BUY'; strategy='TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(slope)/Math.max(atr,.01)*5));
    stop = Math.min(...recent.slice(-3).map(b=>b.low)) - .25;
  } else if (trendDown) {
    side='SELL'; strategy='TREND_CONTINUATION';
    confidence = 65 + Math.min(15, Math.round(Math.abs(slope)/Math.max(atr,.01)*5));
    stop = Math.max(...recent.slice(-3).map(b=>b.high)) + .25;
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
      if (bullMss) { side='BUY'; strategy='ICT_REVERSAL'; confidence=72; stop=c.low-.25; }
      if (bearMss) { side='SELL'; strategy='ICT_REVERSAL'; confidence=72; stop=c.high+.25; }
    }
  }

  if (!side) {
    const impulse = Math.min(60, Math.round(Math.abs(slope)/Math.max(atr,.01)*20));
    return {...base, status:'WAIT', confidence:impulse, reason:'القراءة 100% — الثقة الحالية لا تكفي لدخول جديد'};
  }

  confidence = Math.min(90, confidence);
  const risk = Math.abs(price-stop);
  if (risk < .6 || risk > 6) {
    return {...base,status:'WAIT',candidateAction:side,confidence,strategy,
      reason:risk<.6?'إشارة موجودة لكن وقف الخسارة قريب جدًا':'إشارة موجودة لكن وقف الخسارة واسع أكثر من 6$'};
  }
  const dir = side==='BUY' ? 1 : -1;
  const half = Math.min(.8, Math.max(.20, atr*.18));
  const d1=Math.max(1.8,risk*1.4), d2=Math.max(3,risk*2), d3=Math.max(4,risk*2.5), d4=Math.max(5,risk*3);
  return {
    ...base,status:'CANDIDATE',candidateAction:side,side,strategy,confidence,
    entry:round(price),entryLow:round(price-half),entryHigh:round(price+half),stopLoss:round(stop),
    target1:round(price+dir*d1),target2:round(price+dir*d2),target3:round(price+dir*d3),target4:round(price+dir*d4),
    riskReward:round(d4/risk,2),
    reason:strategy==='ICT_REVERSAL'?'ICT reversal مكتمل':'استمرار ترند مؤكد'
  };
}

function updateStableCandidate(model) {
  const now = Date.now();
  const side = ['BUY','SELL'].includes(model.candidateAction) ? model.candidateAction : 'WAIT';
  const t = state.candidateTrack;

  if (side === 'WAIT') {
    if (t.lastSeen && now - t.lastSeen > CONFIRM_WINDOW_MS) {
      state.candidateTrack = { side:'WAIT', count:0, firstSeen:0, lastSeen:now, model:null };
    } else {
      t.lastSeen = now;
    }
    return;
  }

  if (t.side !== side || now - t.lastSeen > CONFIRM_WINDOW_MS) {
    state.candidateTrack = { side, count:1, firstSeen:now, lastSeen:now, model };
    return;
  }

  t.count += 1;
  t.lastSeen = now;
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

function clearStableViewIfInvalid(price) {
  const s = state.stableView;
  if (!s || !['BUY','SELL'].includes(s.candidateAction)) return;
  const stopped = s.candidateAction==='BUY' ? price<=s.stopLoss : price>=s.stopLoss;
  if (stopped) state.stableView = null;
}

function hit(side,p,t){ return side==='BUY' ? p>=t : p<=t; }

async function signal(execute) {
  const q = await getQuote();
  record(q.price);
  const now = Date.now();
  const rawModel = analyze(q.price);
  updateStableCandidate(rawModel);
  clearStableViewIfInvalid(q.price);

  const model = state.stableView || rawModel;
  let s = state.signal;

  if (s) {
    const stopped = s.side==='BUY' ? q.price<=s.stopLoss : q.price>=s.stopLoss;
    const done = hit(s.side,q.price,s.target4);
    const expired = now-s.issuedAtMs > SIGNAL_MAX_LIFE_MS;
    if (stopped || done || expired) {
      s.result = stopped ? 'STOPPED' : done ? 'TP4' : 'EXPIRED';
      state.signal = null;
      state.cooldownUntil = 0;
      state.stableView = null;
      state.candidateTrack = { side:'WAIT', count:0, firstSeen:0, lastSeen:now, model:null };
      s = null;
    }
  }

  if (!s && execute &&
      ['BUY','SELL'].includes(model.candidateAction) && model.confidence>=MIN_CONFIDENCE &&
      model.entryLow && model.entryHigh && state.candidateTrack.count>=CONFIRM_COUNT) {
    s = {
      signalId:`XAU-${now}-${model.candidateAction}`, side:model.candidateAction,
      strategy:model.strategy, confidence:model.confidence, entry:model.entry,
      entryLow:model.entryLow,entryHigh:model.entryHigh,stopLoss:model.stopLoss,
      target1:model.target1,target2:model.target2,target3:model.target3,target4:model.target4,
      riskReward:model.riskReward,issuedAtMs:now,issuedAt:new Date(now).toISOString(),
      expiresAtMs:now+SIGNAL_TTL_MS,expiresAt:new Date(now+SIGNAL_TTL_MS).toISOString()
    };
    state.signal=s;
  }

  if (s) {
    const active = now<=s.expiresAtMs;
    const inRange = q.price>=s.entryLow && q.price<=s.entryHigh;
    return {
      ...s, status:active?'ACTIVE':'MANAGING',
      action:execute&&active&&inRange?s.side:'WAIT',
      candidateAction:s.side, price:round(q.price),
      readingCompleteness:rawModel.readingCompleteness,
      signalConfidence:s.confidence,
      confidence:s.confidence,
      provider:q.provider,degraded:q.degraded,
      updatedAt:new Date(now).toISOString(),
      confirmationCount:state.candidateTrack.count,
      reason:active ? (inRange?'جاهز للتنفيذ على MT5':'الإشارة ثابتة لكن السعر خارج نطاق الدخول') : 'إدارة الإشارة القائمة'
    };
  }

  const shown = state.stableView || rawModel;
  return {
    ...shown,
    action:'WAIT',
    signalConfidence:shown.confidence,
    provider:q.provider,degraded:q.degraded,
    executionMode:'XAUUSD_ONLY',
    confirmationCount:state.candidateTrack.count,
    confirmationRequired:CONFIRM_COUNT,
    reason: state.stableView ? shown.reason : (['BUY','SELL'].includes(rawModel.candidateAction)
      ? `انتظار تثبيت ${rawModel.candidateAction}: ${state.candidateTrack.count}/${CONFIRM_COUNT}`
      : rawModel.reason)
  };
}

function upsertTrade(ev) {
  const key = String(ev.positionId || ev.ticket || ev.signalId || '');
  let t = key ? state.trades.find(x=>String(x.positionId||x.ticket||x.signalId||'')===key) : null;
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
    return {ok:true};
  }
  if (['OPEN','UPDATE','CLOSE'].includes(type)) {
    const ev={...body,type};
    if (type==='OPEN') ev.status='OPEN';
    if (type==='CLOSE') ev.status='CLOSED';
    const t=upsertTrade(ev);
    state.mt5.positionOpen=type!=='CLOSE';
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
    if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{ok:true,service:'gold-alpha-pro',btc:false,signalStabilization:true});
    if(req.method==='GET'&&url.pathname==='/api/gold'){
      const q=await getQuote(); record(q.price); return json(res,200,{...q,analysis:analyze(q.price)});
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){
      return json(res,200,await signal(url.searchParams.get('observe')!=='1'));
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/trades') return json(res,200,{trades:state.trades});
    if(req.method==='GET'&&url.pathname==='/api/auto-trade/status'){
      const connected=Date.now()-state.mt5.lastSeen<20_000;
      return json(res,200,{mt5:{...state.mt5,connected},trades:state.trades,stabilization:{track:state.candidateTrack,stable:state.stableView}});
    }
    if(req.method==='POST'&&url.pathname==='/api/auto-trade/report'){
      const raw=await readBody(req); let body={}; try{body=JSON.parse(raw||'{}')}catch{return json(res,400,{ok:false,error:'Invalid JSON'})}
      const out=handleReport(body); return json(res,out.ok?200:400,out);
    }
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);return json(res,503,{error:'Service unavailable',detail:String(e?.message||e)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Gold Alpha Pro listening on ${PORT} with stabilized signals`));