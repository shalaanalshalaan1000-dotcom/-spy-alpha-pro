import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// ---- Gold-only UI shell ---------------------------------------------------
source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • AUTO TRADING • GOLD INTELLIGENCE TERMINAL</p>');
source=source.replace('<span class="goldTag">SPOT • NO OPTIONS</span>','<span class="goldTag">XAUUSD • GOLD ONLY</span>');

const css=`
.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}
main{max-width:1280px;padding:18px}.goldPanel{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
.goldHead{padding:18px 20px;border:1px solid #544725;border-radius:18px;background:linear-gradient(145deg,#17160f,#0c121c)}
.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}
.goldChartWrap{height:520px;border:1px solid #282d38;border-radius:18px}
.autoGold{margin:0 0 14px;padding:16px;border:1px solid #2e6654;border-radius:18px;background:linear-gradient(145deg,#0f1d19,#0c121c)}
.autoGoldHead{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}.autoGoldHead h2{margin:0;color:#72dfb5}.autoGoldBadge{padding:6px 9px;border:1px solid #397963;border-radius:999px;color:#72dfb5;background:#10271f;font-size:11px;font-weight:900}.autoGoldGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.autoGoldCard{padding:11px;border:1px solid #29473f;border-radius:11px;background:#0d1421}.autoGoldCard span,.autoGoldCard small{display:block;color:#8fa9a0;font-size:11px}.autoGoldCard strong{display:block;margin:6px 0;font-size:18px;direction:ltr;text-align:right}.autoGoldNote{margin:10px 0 0;color:#8fa9a0;font-size:11px;line-height:1.7}
#goldEntryLocked.locked{color:#52e5a5}#goldEntryLockStatus{color:#ffd166}
@media(max-width:900px){.goldMetrics,.goldPlanGrid,.autoGoldGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

// ---- Auto-trading server engine: one file, no chained patches ------------
const serverAnchor='const server=http.createServer(async(req,res)=>{';
if(source.includes(serverAnchor)){
  const engine=`const XAU_AUTO_MIN_CONF=68,XAU_AUTO_TTL_MS=90_000,XAU_AUTO_MAX_LIFE_MS=4*60*60_000;
const xauAuto={samples:[],signal:null,cooldownUntil:0,lastQuote:null,lastQuoteAt:0};
const xauR=(v,d=2)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null;
async function xauQuote(){const now=Date.now();if(xauAuto.lastQuote&&now-xauAuto.lastQuoteAt<4500)return xauAuto.lastQuote;try{const r=await fetch('https://api.gold-api.com/price/XAU',{cache:'no-store',headers:{accept:'application/json','user-agent':'GoldAlphaPro/5.0'},signal:AbortSignal.timeout(12000)}),j=await r.json().catch(()=>({})),p=Number(j.price);if(!r.ok||!Number.isFinite(p)||p<=0)throw new Error('bad gold quote');const q={price:p,updatedAt:j.updatedAt||new Date().toISOString(),provider:'GOLD_API'};xauAuto.lastQuote=q;xauAuto.lastQuoteAt=now;return q}catch(e){if(xauAuto.lastQuote)return{...xauAuto.lastQuote,degraded:true};throw e}}
function xauRecord(q){const now=Date.now(),p=Number(q.price);if(!Number.isFinite(p)||p<=0)throw new Error('invalid XAU price');const last=xauAuto.samples.at(-1);if(!last||now-last.t>=4000)xauAuto.samples.push({t:now,price:p});else last.price=p;xauAuto.samples=xauAuto.samples.filter(x=>x.t>=now-2*60*60_000).slice(-1800);return{now,price:p}}
function xauBars(){const m=new Map();for(const s of xauAuto.samples){const k=Math.floor(s.t/60000)*60000,b=m.get(k);if(!b)m.set(k,{t:k,open:s.price,high:s.price,low:s.price,close:s.price});else{b.high=Math.max(b.high,s.price);b.low=Math.min(b.low,s.price);b.close=s.price}}return[...m.values()].sort((a,b)=>a.t-b.t)}
function xauModel(price,now){const bars=xauBars().filter(b=>b.t+60000<=now),base={action:'WAIT',candidateAction:'WAIT',status:bars.length<5?'COLLECTING':'WAIT',strategy:'XAU_REVERSAL_OR_TREND',confidence:0,price:xauR(price),entry:null,entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,target3:null,target4:null,riskReward:null,sampleCount:xauAuto.samples.length,barCount:bars.length,updatedAt:new Date(now).toISOString()};if(bars.length<5)return{...base,reason:'جمع شموع M1: '+bars.length+' / 5'};const recent=bars.slice(-8),ranges=recent.map(b=>b.high-b.low).filter(x=>x>0),atr=ranges.length?ranges.reduce((a,b)=>a+b,0)/ranges.length:Math.max(.5,price*.00015);let side=null,strategy=null,confidence=0,structureStop=null;
const last=recent.at(-1),prev=recent.slice(0,-1),prev3=prev.slice(-3),hi3=Math.max(...prev3.map(b=>b.high)),lo3=Math.min(...prev3.map(b=>b.low));
const closes=recent.slice(-5).map(b=>b.close),slope=closes.at(-1)-closes[0],upMomentum=slope>atr*.9&&closes.at(-1)>hi3,downMomentum=slope<-atr*.9&&closes.at(-1)<lo3;
if(upMomentum&&!downMomentum){side='BUY';strategy='TREND_CONTINUATION';confidence=68+Math.min(12,Math.round(Math.abs(slope)/Math.max(atr,.01)*4));structureStop=Math.min(...recent.slice(-3).map(b=>b.low))-.25}
if(downMomentum&&!upMomentum){side='SELL';strategy='TREND_CONTINUATION';confidence=68+Math.min(12,Math.round(Math.abs(slope)/Math.max(atr,.01)*4));structureStop=Math.max(...recent.slice(-3).map(b=>b.high))+.25}
if(!side&&recent.length>=6){for(let i=Math.max(4,recent.length-4);i<recent.length-1;i++){const prior=recent.slice(Math.max(0,i-4),i),c=recent[i],after=recent.slice(i+1),ph=Math.max(...prior.map(b=>b.high)),pl=Math.min(...prior.map(b=>b.low)),bull=c.low<pl&&c.close>pl&&after.some(b=>b.close>Math.max(...prior.slice(-2).map(x=>x.high))),bear=c.high>ph&&c.close<ph&&after.some(b=>b.close<Math.min(...prior.slice(-2).map(x=>x.low)));if(bull){side='BUY';strategy='ICT_REVERSAL';confidence=74;structureStop=c.low-.25}if(bear){side='SELL';strategy='ICT_REVERSAL';confidence=74;structureStop=c.high+.25}}}
if(!side)return{...base,status:'WAIT',reason:'يقرأ السوق: لا يوجد استمرار ترند أو ICT reversal مكتمل'};confidence=Math.min(90,confidence);const dir=side==='BUY'?1:-1,risk=Math.abs(price-structureStop);if(risk<.6||risk>6)return{...base,status:'WAIT',confidence,reason:risk<.6?'وقف قريب جدًا':'وقف أوسع من 6$'};const half=Math.min(.8,Math.max(.20,atr*.18)),r1=Math.max(1.8,risk*1.4),r2=Math.max(3,risk*2),r3=Math.max(4,risk*2.5),r4=Math.max(5,risk*3);return{...base,status:'CANDIDATE',strategy,confidence,candidateAction:side,entry:xauR(price),entryLow:xauR(price-half),entryHigh:xauR(price+half),stopLoss:xauR(structureStop),target1:xauR(price+dir*r1),target2:xauR(price+dir*r2),target3:xauR(price+dir*r3),target4:xauR(price+dir*r4),riskReward:xauR(r4/risk,2),reason:strategy==='ICT_REVERSAL'?'ICT reversal مكتمل':'استمرار ترند مؤكد على M1'}}
function xauHit(side,p,t){return side==='BUY'?p>=t:p<=t}
async function getXauAutoSignal(execute=true){const q=await xauQuote(),s=xauRecord(q),m=xauModel(s.price,s.now);let a=xauAuto.signal;if(a){const stopped=a.side==='BUY'?s.price<=a.stopLoss:s.price>=a.stopLoss,done=xauHit(a.side,s.price,a.target4),expired=s.now-a.issuedAtMs>XAU_AUTO_MAX_LIFE_MS;if(stopped||done||expired){xauAuto.signal=null;xauAuto.cooldownUntil=s.now+90_000;a=null}}
if(!a&&execute&&s.now>=xauAuto.cooldownUntil&&['BUY','SELL'].includes(m.candidateAction)&&m.confidence>=XAU_AUTO_MIN_CONF){a={signalId:'XAU-'+s.now+'-'+m.candidateAction,side:m.candidateAction,confidence:m.confidence,strategy:m.strategy,entry:m.entry,entryLow:m.entryLow,entryHigh:m.entryHigh,stopLoss:m.stopLoss,target1:m.target1,target2:m.target2,target3:m.target3,target4:m.target4,riskReward:m.riskReward,issuedAtMs:s.now,issuedAt:new Date(s.now).toISOString(),expiresAtMs:s.now+XAU_AUTO_TTL_MS,expiresAt:new Date(s.now+XAU_AUTO_TTL_MS).toISOString()};xauAuto.signal=a}
if(a){const open=s.now<=a.expiresAtMs,inRange=s.price>=a.entryLow&&s.price<=a.entryHigh;return{...a,status:open?'ACTIVE':'MANAGING',action:execute&&open&&inRange?a.side:'WAIT',candidateAction:a.side,price:xauR(s.price),provider:q.provider,updatedAt:new Date(s.now).toISOString(),reason:open?(inRange?'جاهز للتنفيذ على MT5':'انتظار عودة السعر لنطاق الدخول'):'إدارة الإشارة القائمة'}}return{...m,executionMode:'XAUUSD_ONLY',provider:q.provider,updatedAt:new Date(s.now).toISOString(),reason:s.now<xauAuto.cooldownUntil?'مهلة قصيرة بعد اكتمال الإشارة':m.reason}}
`;
  source=source.replace(serverAnchor,engine+serverAnchor);
}

const routeAnchor="if(req.method==='GET'&&url.pathname==='/api/config')return sendJSON(res,200,{watchlist:WATCHLIST,minConfidence:Number(process.env.MIN_CONFIDENCE||70),user:session?.email||null,...currentMode()});";
if(source.includes(routeAnchor)){
  const route="if(req.method==='GET'&&url.pathname==='/api/auto-trade/signal'){try{return sendJSON(res,200,await getXauAutoSignal(url.searchParams.get('observe')!=='1'))}catch(error){return sendJSON(res,503,{error:'XAU auto-trade unavailable',detail:String(error?.message||error)})}}\n    ";
  source=source.replace(routeAnchor,route+routeAnchor);
}
const auth="if(authEnabled()&&!session)return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');";
if(source.includes(auth))source=source.replace(auth,"if(authEnabled()&&!session&&url.pathname!=='/api/auto-trade/signal')return url.pathname.startsWith('/api/')?sendJSON(res,401,{error:'Authentication required'}):redirect(res,'/login');");

// ---- Locked visual plan ----------------------------------------------------
const scenarioCard='<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>';
source=source.replace(scenarioCard,scenarioCard+'<div class="goldPlanCard"><span>الدخول المقفول</span><strong id="goldEntryLocked">—</strong><small id="goldEntryLockStatus">بانتظار إشارة مكتملة</small></div>');
const renderAnchor='function renderGoldPlan(plan){';
if(source.includes(renderAnchor)){
  const lock=`const GOLD_TRADE_LOCK_KEY='gold_alpha_trade_lock_v2',GOLD_TRADE_COOLDOWN_KEY='gold_alpha_trade_cooldown_v2';
function goldLockRead(){try{const x=JSON.parse(localStorage.getItem(GOLD_TRADE_LOCK_KEY)||'null');return x&&['UP','DOWN'].includes(x.state)?x:null}catch{return null}}
function goldLockWrite(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function goldLockClear(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY)}catch{}}
function goldLockPlan(plan,p){p=Number(p);let l=goldLockRead(),active=['UP','DOWN'].includes(plan?.state);if(l){const inv=Number(l.invalidation),done=Number(l.target2),bad=Number.isFinite(inv)&&(l.state==='UP'?p<=inv:p>=inv),hit=Number.isFinite(done)&&(l.state==='UP'?p>=done:p<=done),opp=active&&plan.state!==l.state;if(hit||bad||opp||Date.now()-l.createdAt>4*60*60_000){goldLockClear();localStorage.setItem(GOLD_TRADE_COOLDOWN_KEY,String(Date.now()+90_000));l=null}}const cooling=Date.now()<Number(localStorage.getItem(GOLD_TRADE_COOLDOWN_KEY)||0);if(!l&&!cooling&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){l={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now()};goldLockWrite(l)}if(!l)return{...plan,locked:false,cooling};return{...plan,state:l.state,entry:l.entry,target1:l.target1,target2:l.target2,invalidation:l.invalidation,confidence:Math.max(Number(plan.confidence||0),l.confidence),locked:true}}
`;
  source=source.replace(renderAnchor,lock+renderAnchor);
}
source=source.replace("function renderGoldPlan(plan){\n  const labels=","function renderGoldPlan(plan){\n  const en=$('#goldEntryLocked'),es=$('#goldEntryLockStatus');if(en){en.textContent=plan.locked?money(plan.entry):'—';en.className=plan.locked?'locked':''}if(es)es.textContent=plan.cooling?'إعادة تقييم السوق…':plan.locked?'LOCKED • ثابت':'بانتظار إشارة مكتملة';\n  const labels=");
source=source.replace('renderGoldPlan(d.plan);','renderGoldPlan(goldLockPlan(d.plan,d.price));');

// ---- Auto-trading panel ----------------------------------------------------
const panel=`<article class="autoGold"><div class="autoGoldHead"><div><h2>XAUUSD — التداول الآلي</h2><small>MT5 • GOLD ONLY • BTC OFF</small></div><span id="xauAutoBadge" class="autoGoldBadge">MT5 READY</span></div><section class="autoGoldGrid"><div class="autoGoldCard"><span>الحالة</span><strong id="xauAutoAction">انتظار</strong><small id="xauAutoConfidence">جاري القراءة</small></div><div class="autoGoldCard"><span>نطاق الدخول</span><strong id="xauAutoRange">—</strong><small id="xauAutoStatus">—</small></div><div class="autoGoldCard"><span>وقف الخسارة</span><strong id="xauAutoSL">—</strong><small id="xauAutoStrategy">—</small></div><div class="autoGoldCard"><span>الهدف 1</span><strong id="xauAutoT1">—</strong><small id="xauAutoRR">—</small></div><div class="autoGoldCard"><span>الهدف 2</span><strong id="xauAutoT2">—</strong></div><div class="autoGoldCard"><span>الهدف 3</span><strong id="xauAutoT3">—</strong></div><div class="autoGoldCard"><span>الهدف 4</span><strong id="xauAutoT4">—</strong></div><div class="autoGoldCard"><span>MT5</span><strong id="xauAutoMt5">جاهز</strong><small id="xauAutoUpdated">—</small></div></section><p id="xauAutoNote" class="autoGoldNote">يتم تحديث الإشارة كل 5 ثوانٍ.</p></article>`;
if(source.includes('<article class="goldPanel">'))source=source.replace('<article class="goldPanel">',panel+'<article class="goldPanel">');

const startup='(async()=>{';
if(source.includes(startup)){
  const client=`let xauAutoLoading=false;const xauMoney=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
async function loadXauAuto(){if(xauAutoLoading)return;xauAutoLoading=true;try{const r=await fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.detail||d.error||'signal unavailable');const side=['BUY','SELL'].includes(d.candidateAction)?d.candidateAction:'WAIT',active=['BUY','SELL'].includes(side),status=String(d.status||'WAIT').toUpperCase(),q=s=>document.querySelector(s);if(!q('#xauAutoAction'))return;q('#xauAutoAction').textContent=side==='BUY'?'شراء':side==='SELL'?'بيع':status==='COLLECTING'?'جاري القراءة':'انتظار';q('#xauAutoAction').className=side==='BUY'?'positive':side==='SELL'?'negative':'WATCH';q('#xauAutoConfidence').textContent='الثقة '+Number(d.confidence||0)+'% • '+Number(d.barCount||0)+' شموع M1';q('#xauAutoRange').textContent=active?xauMoney(d.entryLow)+' — '+xauMoney(d.entryHigh):'—';q('#xauAutoStatus').textContent=status;q('#xauAutoSL').textContent=active?xauMoney(d.stopLoss):'—';q('#xauAutoStrategy').textContent=d.strategy||'—';q('#xauAutoT1').textContent=active?xauMoney(d.target1):'—';q('#xauAutoT2').textContent=active?xauMoney(d.target2):'—';q('#xauAutoT3').textContent=active?xauMoney(d.target3):'—';q('#xauAutoT4').textContent=active?xauMoney(d.target4):'—';q('#xauAutoRR').textContent=d.riskReward?'R:R 1:'+Number(d.riskReward).toFixed(2):'—';q('#xauAutoMt5').textContent=status==='ACTIVE'?'إشارة جاهزة':status==='MANAGING'?'إدارة':'جاهز';q('#xauAutoBadge').textContent=status==='ACTIVE'?'XAU ACTIVE':'MT5 READY';q('#xauAutoUpdated').textContent=d.updatedAt?new Date(d.updatedAt).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh'}):'—';q('#xauAutoNote').textContent=d.reason||'يقرأ الذهب';}catch(e){const q=s=>document.querySelector(s);if(q('#xauAutoBadge'))q('#xauAutoBadge').textContent='غير متاح';if(q('#xauAutoNote'))q('#xauAutoNote').textContent=e.message}finally{xauAutoLoading=false}}
setTimeout(loadXauAuto,1000);setInterval(loadXauAuto,5000);
const GOLD_LAST_VALID_QUOTE_KEY='gold_alpha_last_valid_quote_v2',goldNativeFetch=window.fetch.bind(window);function goldCached(){try{const x=JSON.parse(localStorage.getItem(GOLD_LAST_VALID_QUOTE_KEY)||'null');return x&&Number(x.price)>0?x:null}catch{return null}}window.fetch=async function(input,init){const u=typeof input==='string'?input:String(input?.url||input),r=await goldNativeFetch(input,init);if(!u.includes('api.gold-api.com/price/XAU'))return r;try{const j=await r.clone().json();if(r.ok&&Number(j.price)>0){localStorage.setItem(GOLD_LAST_VALID_QUOTE_KEY,JSON.stringify(j));return r}const c=goldCached();if(c)return new Response(JSON.stringify(c),{status:200,headers:{'content-type':'application/json'}})}catch{const c=goldCached();if(c)return new Response(JSON.stringify(c),{status:200,headers:{'content-type':'application/json'}})}return r};
`;
  source=source.replace(startup,client+'\n'+startup);
}

const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
source=source.replace(stockStartup,"await loadGold();\n  setInterval(loadGold,30000);");

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
