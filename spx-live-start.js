import http from 'node:http';

const PORT=Number(process.env.PORT||3003);
const TICKER='I:SPX';
let cache=null;
let cacheAt=0;

const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(body));};
const html=(res,body)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body);};
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const isoFromTimestamp=v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)return null;const ms=n>1e16?n/1e6:n>1e13?n/1e3:n;return new Date(ms).toISOString();};

async function readSpx(){
  const now=Date.now();
  if(cache&&now-cacheAt<4000)return cache;
  const key=process.env.MASSIVE_API_KEY;
  if(!key)throw new Error('MASSIVE_API_KEY is not configured');
  const u=new URL('https://api.massive.com/v3/snapshot/indices');
  u.searchParams.set('ticker',TICKER);
  u.searchParams.set('apiKey',key);
  const r=await fetch(u,{headers:{accept:'application/json','user-agent':'GoldAlphaPro-SPX/1.0'},signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||('Massive HTTP '+r.status));
  const x=Array.isArray(d.results)?d.results[0]:d.results;
  const value=num(x?.value);
  if(value==null)throw new Error('SPX value unavailable for the current Massive plan');
  const s=x?.session||{};
  const updatedAt=isoFromTimestamp(x?.last_updated)||new Date().toISOString();
  const ageSeconds=Math.max(0,Math.round((now-Date.parse(updatedAt))/1000));
  const marketStatus=String(x?.market_status||'unknown').toLowerCase();
  const timeframe=String(x?.timeframe||'unknown').toUpperCase();
  const stale=marketStatus==='open'&&ageSeconds>90;
  const change=num(s.change),changePercent=num(s.change_percent);
  const direction=changePercent==null?'WAIT':changePercent>0.05?'UP':changePercent<-.05?'DOWN':'NEUTRAL';
  cache={ok:true,symbol:'SPX',provider:'MASSIVE',value,change,changePercent,open:num(s.open),high:num(s.high),low:num(s.low),previousClose:num(s.previous_close??s.close),marketStatus,timeframe,updatedAt,ageSeconds,stale,direction,readOnly:true};
  cacheAt=now;
  return cache;
}

const PAGE=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPX — القراءة اللحظية</title><style>:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#080b12;color:#eef2ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#172036,#080b12 46%);min-height:100vh}header,main{max-width:1100px;margin:auto;padding:18px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #26324a}h1{margin:0;color:#91b7ff;font-size:24px}a{color:#f0d58b;text-decoration:none}.note{color:#91a0b8;font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.card,.panel{background:#0e1524;border:1px solid #2b3a56;border-radius:15px;padding:14px}.card span{display:block;color:#91a0b8;font-size:11px}.card strong{display:block;margin-top:7px;font-size:20px;direction:ltr}.up{color:#52e5a5}.down{color:#ff718c}.warn{color:#ffd166}.tableWrap{overflow:auto}.table{width:100%;min-width:760px;border-collapse:collapse}.table th,.table td{padding:11px;border-bottom:1px solid #273550;text-align:center;white-space:nowrap}.table th{color:#91a0b8;font-size:12px}.status{margin-top:12px;font-size:12px;color:#91a0b8}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}} </style></head><body><header><div><h1>SPX — القراءة اللحظية</h1><div class="note">I:SPX فقط • قراءة مستقلة • دون تنفيذ آلي</div></div><a href="/">العودة للذهب</a></header><main><section class="grid"><div class="card"><span>قيمة SPX</span><strong id="price">—</strong></div><div class="card"><span>التغير اليومي</span><strong id="change">—</strong></div><div class="card"><span>اتجاه القراءة</span><strong id="direction">WAIT</strong></div><div class="card"><span>حالة السوق</span><strong id="market">—</strong></div></section><section class="panel"><div class="tableWrap"><table class="table"><thead><tr><th>الافتتاح</th><th>الأعلى</th><th>الأدنى</th><th>الإغلاق السابق</th><th>حداثة البيانات</th><th>نوع البيانات</th></tr></thead><tbody><tr><td id="open">—</td><td id="high">—</td><td id="low">—</td><td id="prev">—</td><td id="fresh">—</td><td id="timeframe">—</td></tr></tbody></table></div><div id="status" class="status">جاري تحميل SPX…</div></section></main><script>const q=s=>document.querySelector(s),fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';async function refresh(){try{const r=await fetch('/api/spx-live',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'تعذر جلب SPX');q('#price').textContent=fmt(d.value);q('#change').textContent=(d.changePercent>=0?'+':'')+fmt(d.changePercent)+'%';q('#change').className=d.changePercent>0?'up':d.changePercent<0?'down':'warn';q('#direction').textContent=d.direction==='UP'?'صاعد':d.direction==='DOWN'?'هابط':d.direction==='NEUTRAL'?'متوازن':'WAIT';q('#direction').className=d.direction==='UP'?'up':d.direction==='DOWN'?'down':'warn';q('#market').textContent=d.marketStatus==='open'?'مفتوح':d.marketStatus==='closed'?'مغلق':d.marketStatus;q('#open').textContent=fmt(d.open);q('#high').textContent=fmt(d.high);q('#low').textContent=fmt(d.low);q('#prev').textContent=fmt(d.previousClose);q('#fresh').textContent=d.ageSeconds+' ث';q('#timeframe').textContent=d.timeframe;q('#status').textContent=(d.stale?'⚠ البيانات متأخرة أثناء السوق':'✓ البيانات سليمة')+' • Massive • تحديث كل 5 ثوانٍ';}catch(e){q('#status').textContent='تعذر تحديث SPX: '+e.message}}refresh();setInterval(refresh,5000);</script></body></html>`;

const server=http.createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/spx')return html(res,PAGE);if(req.method==='GET'&&u.pathname==='/api/spx-live')return json(res,200,await readSpx());if(req.method==='GET'&&u.pathname==='/api/spx-health')return json(res,200,{ok:true,service:'spx-live',isolated:true});return json(res,404,{error:'Not found'});}catch(e){return json(res,503,{ok:false,symbol:'SPX',error:String(e?.message||e),readOnly:true});}});
server.listen(PORT,'127.0.0.1',()=>console.log('Isolated SPX reader listening on '+PORT));
