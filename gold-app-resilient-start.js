// Gold Alpha Pro resilient launcher.
// Preserves the original Gold Alpha Pro UI/runtime, adds quote fallbacks,
// fixes stale signal confirmation, and adds an automatic daily trade ledger.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const nativeFetch = globalThis.fetch.bind(globalThis);

async function fallbackGoldQuote() {
  const massiveKey = process.env.MASSIVE_API_KEY;
  if (massiveKey) {
    try {
      const u = new URL('https://api.massive.com/v1/last_quote/currencies/XAU/USD');
      u.searchParams.set('apiKey', massiveKey);
      const r = await nativeFetch(u, {
        headers: {accept:'application/json','user-agent':'GoldAlphaPro/9.2'},
        signal: AbortSignal.timeout(7000)
      });
      const d = await r.json().catch(()=>({}));
      const q = d.last || d.results?.last || d.results || {};
      const bid = Number(q.bid ?? q.b), ask = Number(q.ask ?? q.a);
      const price = Number.isFinite(bid) && Number.isFinite(ask) ? (bid+ask)/2 : (Number.isFinite(bid) ? bid : ask);
      if (r.ok && Number.isFinite(price) && price > 0) return {price, updatedAt:new Date().toISOString(), provider:'MASSIVE'};
    } catch {}
  }

  try {
    const r = await nativeFetch('https://data-asg.goldprice.org/dbXRates/USD', {
      cache:'no-store',
      headers:{accept:'application/json, text/plain, */*','user-agent':'Mozilla/5.0 GoldAlphaPro/9.2',origin:'https://goldprice.org',referer:'https://goldprice.org/'},
      signal:AbortSignal.timeout(7000)
    });
    const d = await r.json().catch(()=>({}));
    const x = Array.isArray(d.items) ? d.items[0] : null;
    const price = Number(x?.xauPrice);
    if (r.ok && Number.isFinite(price) && price > 0) return {price, updatedAt:new Date().toISOString(), provider:'GOLDPRICE_ORG'};
  } catch {}
  return null;
}

globalThis.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (!url.includes('api.gold-api.com/price/XAU')) return nativeFetch(input, init);
  try {
    const r = await nativeFetch(input, init);
    if (r.ok) return r;
  } catch {}
  const q = await fallbackGoldQuote();
  if (!q) return new Response(JSON.stringify({error:'all gold quote providers unavailable'}), {status:503, headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify(q), {status:200, headers:{'content-type':'application/json'}});
};

let source = readFileSync(new URL('./gold-app.js', import.meta.url), 'utf8');

// Do not refresh lastSeen while the model is WAIT. Otherwise a stale BUY/SELL can stay locked forever.
source = source.replace(
  /function updateStableCandidate\(model\) \{[\s\S]*?\n\}\n\nfunction clearStableViewIfInvalid/,
`function updateStableCandidate(model) {
  const now = Date.now();
  const side = ['BUY','SELL'].includes(model.candidateAction) ? model.candidateAction : 'WAIT';
  const t = state.candidateTrack;

  if (side === 'WAIT') {
    if (t.side !== 'WAIT' && t.lastSeen && now - t.lastSeen > CONFIRM_WINDOW_MS) {
      state.candidateTrack = { side:'WAIT', count:0, firstSeen:0, lastSeen:0, model:null };
      if (!state.signal) state.stableView = null;
    }
    return;
  }

  if (t.side !== side || !t.lastSeen || now - t.lastSeen > CONFIRM_WINDOW_MS) {
    state.candidateTrack = { side, count:1, firstSeen:now, lastSeen:now, model };
    return;
  }

  t.count += 1;
  t.lastSeen = now;
  t.model = model;
  if (t.count >= CONFIRM_COUNT) {
    state.stableView = {
      ...model,
      status:'CONFIRMED', action:'WAIT', candidateAction:side,
      confirmedAt:new Date(now).toISOString(),
      reason:\`${'${side}'} مؤكد بعد ${'${CONFIRM_COUNT}'} قراءات متتالية — الثقة ثابتة حتى انتهاء السيناريو\`
    };
  }
}

function clearStableViewIfInvalid`
);

// Track TP progress and close each signal as WIN / LOSS / EXPIRED in the ledger.
source = source.replace(
`  if (s) {
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
  }`,
`  if (s) {
    const stopped = s.side==='BUY' ? q.price<=s.stopLoss : q.price>=s.stopLoss;
    const tp1Hit = hit(s.side,q.price,s.target1);
    const tp2Hit = hit(s.side,q.price,s.target2);
    const tp3Hit = hit(s.side,q.price,s.target3);
    const tp4Hit = hit(s.side,q.price,s.target4);
    const done = tp4Hit;
    const expired = now-s.issuedAtMs > SIGNAL_MAX_LIFE_MS;
    upsertTrade({
      signalId:s.signalId, side:s.side, strategy:s.strategy, confidence:s.confidence,
      entry:s.entry, entryLow:s.entryLow, entryHigh:s.entryHigh, stopLoss:s.stopLoss,
      target1:s.target1,target2:s.target2,target3:s.target3,target4:s.target4,
      tp1Hit,tp2Hit,tp3Hit,tp4Hit,
      status:(stopped||done||expired)?'CLOSED':'SIGNAL',
      result:stopped?'LOSS':done?'WIN':expired?'EXPIRED':(tp1Hit?'IN_PROFIT':'ACTIVE'),
      closeReason:stopped?'STOP_LOSS':done?'TP4':expired?'EXPIRED':null,
      closedAt:(stopped||done||expired)?new Date(now).toISOString():null,
      lastPrice:round(q.price)
    });
    if (stopped || done || expired) {
      s.result = stopped ? 'STOPPED' : done ? 'TP4' : 'EXPIRED';
      state.signal = null;
      state.cooldownUntil = 0;
      state.stableView = null;
      state.candidateTrack = { side:'WAIT', count:0, firstSeen:0, lastSeen:0, model:null };
      s = null;
    }
  }`
);

// Register the trade immediately when a confirmed executable signal is created, before MT5 execution.
source = source.replace(
`    state.signal=s;
  }

  if (s) {`,
`    state.signal=s;
    upsertTrade({
      signalId:s.signalId, type:'SIGNAL', status:'SIGNAL', result:'ACTIVE',
      side:s.side, strategy:s.strategy, confidence:s.confidence,
      entry:s.entry, entryLow:s.entryLow, entryHigh:s.entryHigh, stopLoss:s.stopLoss,
      target1:s.target1,target2:s.target2,target3:s.target3,target4:s.target4,
      issuedAt:s.issuedAt, openedAt:s.issuedAt,
      tp1Hit:false,tp2Hit:false,tp3Hit:false,tp4Hit:false
    });
  }

  if (s) {`
);

// Daily ledger UI: today's signals, wins, losses, open signals, and live trade rows.
source = source.replace('</style></head>', `
.dailyLedger{border-color:#4f4324;background:linear-gradient(145deg,#17160f,#0d1420)}
.dailyStats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}.dailyStat{padding:10px;border:1px solid #38445a;border-radius:11px;background:#0b1220}.dailyStat span{display:block;font-size:10px;color:#8ea0c0}.dailyStat strong{display:block;margin-top:4px;font-size:18px}.ledgerTable{width:100%;border-collapse:collapse;min-width:760px}.ledgerTable th,.ledgerTable td{padding:8px;border-bottom:1px solid #273550;font-size:11px;white-space:nowrap;text-align:right}.ledgerTable th{color:#8ea0c0}.resultWin{color:#52e5a5;font-weight:800}.resultLoss{color:#ff718c;font-weight:800}.resultOpen{color:#ffd166;font-weight:800}@media(max-width:800px){.dailyStats{grid-template-columns:repeat(2,1fr)}}
</style></head>`);

source = source.replace('<div class="chart">', `<section class="panel dailyLedger"><h2>سجل صفقات اليوم — يتحدث تلقائيًا</h2><div class="dailyStats"><div class="dailyStat"><span>إشارات الدخول اليوم</span><strong id="dayTotal">0</strong></div><div class="dailyStat"><span>الرابحة</span><strong id="dayWins" class="green">0</strong></div><div class="dailyStat"><span>الخاسرة</span><strong id="dayLosses" class="red">0</strong></div><div class="dailyStat"><span>مفتوحة / قيد المتابعة</span><strong id="dayOpen" class="warn">0</strong></div></div><div class="tableWrap"><table class="ledgerTable"><thead><tr><th>الوقت</th><th>النوع</th><th>الثقة</th><th>الدخول</th><th>SL</th><th>TP1</th><th>TP2</th><th>TP3</th><th>TP4</th><th>النتيجة</th></tr></thead><tbody id="dailyTradeRows"><tr><td colspan="10" class="empty">لا توجد إشارة دخول اليوم حتى الآن</td></tr></tbody></table></div><p class="muted">تُسجّل الصفقة بمجرد صدور إشارة دخول مؤكدة، ثم تتحدث النتيجة تلقائيًا إلى رابحة أو خاسرة حسب الأهداف ووقف الخسارة.</p></section><div class="chart">`);

source = source.replace(
`$('#autoNote').textContent=(s.status||'WAIT')+' • '+(s.strategy||'READING')+' • '+(s.reason||'');`,
`$('#autoNote').textContent=(s.status||'WAIT')+' • '+(s.strategy||'READING')+' • '+(s.reason||'');renderDailyLedger(st.trades||[]);`
);

source = source.replace('refresh();setInterval(refresh,5000);', `
function renderDailyLedger(list){
  const fmtDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  const today=fmtDay(new Date());
  const getTime=t=>t.openedAt||t.issuedAt||t.createdAt||t.updatedAt;
  const rows=(Array.isArray(list)?list:[]).filter(t=>{const x=getTime(t);return x&&fmtDay(new Date(x))===today&&t.signalId;});
  const wins=rows.filter(t=>String(t.result||'').toUpperCase()==='WIN'||Number(t.profit)>0).length;
  const losses=rows.filter(t=>String(t.result||'').toUpperCase()==='LOSS'||Number(t.profit)<0||String(t.closeReason||'').toUpperCase()==='STOP_LOSS').length;
  const open=rows.filter(t=>!['WIN','LOSS','EXPIRED'].includes(String(t.result||'').toUpperCase())&&String(t.status||'').toUpperCase()!=='CLOSED').length;
  const a=document.querySelector('#dayTotal'),b=document.querySelector('#dayWins'),c=document.querySelector('#dayLosses'),d=document.querySelector('#dayOpen'),body=document.querySelector('#dailyTradeRows');
  if(a)a.textContent=rows.length;if(b)b.textContent=wins;if(c)c.textContent=losses;if(d)d.textContent=open;if(!body)return;
  if(!rows.length){body.innerHTML='<tr><td colspan="10" class="empty">لا توجد إشارة دخول اليوم حتى الآن</td></tr>';return}
  body.innerHTML=rows.slice().reverse().map(t=>{const r=String(t.result||'ACTIVE').toUpperCase(),cls=r==='WIN'?'resultWin':r==='LOSS'?'resultLoss':'resultOpen',label=r==='WIN'?'رابحة':r==='LOSS'?'خاسرة':r==='EXPIRED'?'منتهية':'قيد المتابعة',tm=new Date(getTime(t)).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'});return '<tr><td>'+tm+'</td><td>'+(t.side||'—')+'</td><td>'+(Number.isFinite(Number(t.confidence))?Number(t.confidence).toFixed(0)+'%':'—')+'</td><td>'+money(t.entry)+'</td><td>'+money(t.stopLoss||t.sl)+'</td><td>'+(t.tp1Hit?'✓ ':'')+money(t.target1||t.tp1)+'</td><td>'+(t.tp2Hit?'✓ ':'')+money(t.target2||t.tp2)+'</td><td>'+(t.tp3Hit?'✓ ':'')+money(t.target3||t.tp3)+'</td><td>'+(t.tp4Hit?'✓ ':'')+money(t.target4||t.tp4)+'</td><td class="'+cls+'">'+label+'</td></tr>'}).join('');
}
refresh();setInterval(refresh,5000);`);

const patchedPath = '/tmp/gold-app-daily-ledger.mjs';
writeFileSync(patchedPath, source, 'utf8');
await import(pathToFileURL(patchedPath).href + '?v=' + Date.now());
