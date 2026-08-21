import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Stable gold-only shell.
source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • GOLD INTELLIGENCE TERMINAL</p>');
source=source.replace('<span class="goldTag">SPOT • NO OPTIONS</span>','<span class="goldTag">XAUUSD • GOLD ONLY</span>');

const scenarioCard='<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>';
const scenarioWithEntry=scenarioCard+'<div class="goldPlanCard"><span>الدخول المقفول</span><strong id="goldEntryLocked">—</strong><small id="goldEntryLockStatus">بانتظار إشارة مكتملة</small></div>';
source=source.replace(scenarioCard,scenarioWithEntry);

// Phase 1 ICT: add a lightweight native liquidity chart before the existing TradingView chart.
source=source.replace(
  '<div id="goldChart" class="goldChartWrap"></div>',
  '<section class="ictLevelsPanel"><div class="ictLevelsHead"><div><strong>ICT Liquidity Map</strong><span>PDH / PDL • Asia High / Low</span></div><span id="ictLevelsStatus">جمع البيانات</span></div><div id="ictLevelsChart" class="ictLevelsChart"><div class="ictLevelsEmpty">جارٍ بناء مستويات السيولة…</div></div></section><div id="goldChart" class="goldChartWrap"></div>'
);

const css=`
/* Stable gold-only shell */
.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}
main{max-width:1280px;padding:18px}.goldPanel{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
.goldHead{padding:18px 20px;border:1px solid #544725;border-radius:18px;background:linear-gradient(145deg,#17160f,#0c121c)}
.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}
.goldChartWrap{height:520px;border:1px solid #282d38;border-radius:18px}
#goldEntryLocked.locked{color:#52e5a5}#goldEntryLockStatus{color:#ffd166}
.ictLevelsPanel{margin:0 0 12px;border:1px solid #554923;border-radius:18px;background:linear-gradient(145deg,#15150f,#0b111b);padding:14px;overflow:hidden}
.ictLevelsHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.ictLevelsHead strong{display:block;color:#f4dfa0;font-size:14px}.ictLevelsHead span{display:block;color:#9f987c;font-size:10px;margin-top:3px}.ictLevelsHead>span{padding:6px 9px;border:1px solid #514725;border-radius:999px;color:#ffd166;margin:0;font-weight:800}
.ictLevelsChart{height:300px;border:1px solid #2b3140;border-radius:13px;background:#090e17;position:relative;overflow:hidden}.ictLevelsChart svg{display:block;width:100%;height:100%}.ictLevelsEmpty{height:100%;display:grid;place-items:center;color:#7f8ba3;font-size:12px}
.ictLabel{font:700 10px Inter,system-ui,sans-serif}.ictPrice{font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:900px){.goldMetrics{grid-template-columns:repeat(2,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}.ictLevelsChart{height:260px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

const renderAnchor='function renderGoldPlan(plan){';
if(source.includes(renderAnchor)){
  const phase1=`const GOLD_TRADE_LOCK_KEY='gold_alpha_trade_lock_v1';
function readGoldTradeLock(){try{const x=JSON.parse(localStorage.getItem(GOLD_TRADE_LOCK_KEY)||'null');return x&&['UP','DOWN'].includes(x.state)?x:null}catch{return null}}
function writeGoldTradeLock(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function clearGoldTradeLock(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY)}catch{}}
function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();if(lock){const invalidation=Number(lock.invalidation),invalidated=Number.isFinite(invalidation)&&(lock.state==='UP'?p<=invalidation:p>=invalidation),opposite=active&&plan.state!==lock.state,expired=Date.now()-Number(lock.createdAt||0)>4*60*60_000;if(invalidated||opposite||expired){clearGoldTradeLock();lock=null}}if(!lock&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now()};writeGoldTradeLock(lock)}if(!lock)return{...plan,entry:null,locked:false};return{...plan,state:lock.state,confidence:Math.max(Number(plan.confidence||0),Number(lock.confidence||0)),entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,locked:true,lockCreatedAt:lock.createdAt,note:'ENTRY LOCKED — رقم الدخول والأهداف ووقف الإلغاء ثابتة حتى إلغاء السيناريو أو ظهور اتجاه جديد.'}}
function ictNyKey(ts){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ts)),v=Object.fromEntries(p.map(x=>[x.type,x.value]));return v.year+'-'+v.month+'-'+v.day}
function ictNyHour(ts){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hour12:false}).formatToParts(new Date(ts)),v=Object.fromEntries(p.map(x=>[x.type,x.value]));return Number(v.hour)%24}
function ictLiquidityFromSamples(samples,now){const clean=(samples||[]).map(x=>({t:Number(x.t),price:Number(x.price)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.price)&&x.t<=now&&x.t>=now-72*60*60_000);const today=ictNyKey(now),days=[...new Set(clean.map(x=>ictNyKey(x.t)))],prev=days.filter(x=>x<today).sort().at(-1),pr=prev?clean.filter(x=>ictNyKey(x.t)===prev):[],todayRows=clean.filter(x=>ictNyKey(x.t)===today),asia=todayRows.filter(x=>{const h=ictNyHour(x.t);return h>=20||h<1});const hi=a=>a.length?Math.max(...a.map(x=>x.price)):null,lo=a=>a.length?Math.min(...a.map(x=>x.price)):null;return{clean,pdh:hi(pr),pdl:lo(pr),asiaHigh:hi(asia),asiaLow:lo(asia)}}
function drawIctLiquidityLevels(samples,price){const host=document.querySelector('#ictLevelsChart'),status=document.querySelector('#ictLevelsStatus');if(!host)return;const now=Date.now(),x=ictLiquidityFromSamples(samples,now),rows=x.clean.slice(-900),levels=[['PDH',x.pdh,'#ff718c'],['PDL',x.pdl,'#52e5a5'],['ASIA H',x.asiaHigh,'#e9c46a'],['ASIA L',x.asiaLow,'#e9c46a']].filter(v=>Number.isFinite(v[1]));if(rows.length<8||!levels.length){if(status)status.textContent='جمع البيانات';host.innerHTML='<div class="ictLevelsEmpty">نحتاج تاريخ سعر كافٍ لحساب PDH / PDL و Asia range.</div>';return}const values=rows.map(r=>r.price).concat(levels.map(v=>v[1])).concat(Number.isFinite(Number(price))?[Number(price)]:[]),min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.12,.35),ymin=min-pad,ymax=max+pad,w=1000,h=300,left=18,right=125,top=15,bottom=22,px=i=>left+i*(w-left-right)/Math.max(1,rows.length-1),py=v=>top+(ymax-v)*(h-top-bottom)/(ymax-ymin);let d='';rows.forEach((r,i)=>{d+=(i?'L':'M')+px(i).toFixed(1)+' '+py(r.price).toFixed(1)+' '});let svg='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ictg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8bc66" stop-opacity=".18"/><stop offset="1" stop-color="#d8bc66" stop-opacity="0"/></linearGradient></defs><path d="'+d+' L '+px(rows.length-1).toFixed(1)+' '+(h-bottom)+' L '+left+' '+(h-bottom)+' Z" fill="url(#ictg)"/><path d="'+d+'" fill="none" stroke="#e7cf7c" stroke-width="1.6" vector-effect="non-scaling-stroke"/>';for(const [name,v,c]of levels){const y=py(v).toFixed(1);svg+='<line x1="'+left+'" y1="'+y+'" x2="'+(w-right+8)+'" y2="'+y+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/><text x="'+(w-right+14)+'" y="'+(Number(y)-2)+'" fill="'+c+'" class="ictLabel">'+name+'</text><text x="'+(w-right+14)+'" y="'+(Number(y)+11)+'" fill="#cbd5e1" class="ictPrice">'+Number(v).toFixed(2)+'</text>'}if(Number.isFinite(Number(price))){const y=py(Number(price)).toFixed(1);svg+='<circle cx="'+px(rows.length-1).toFixed(1)+'" cy="'+y+'" r="4" fill="#ffffff"/><text x="'+(w-right+14)+'" y="'+(Number(y)+4)+'" fill="#ffffff" class="ictPrice">NOW '+Number(price).toFixed(2)+'</text>'}svg+='</svg>';host.innerHTML=svg;if(status)status.textContent='ICT LEVELS • LIVE'}
`;
  source=source.replace(renderAnchor,phase1+renderAnchor);
}

source=source.replace(
  "function renderGoldPlan(plan){\n  const labels=",
  "function renderGoldPlan(plan){\n  const entryNode=$('#goldEntryLocked'),entryStatus=$('#goldEntryLockStatus');if(entryNode){entryNode.textContent=plan.locked?money(plan.entry):'—';entryNode.className=plan.locked?'locked':''}if(entryStatus)entryStatus.textContent=plan.locked?'LOCKED • لا يتغير مع التحديث':'بانتظار إشارة مكتملة';\n  const labels="
);
source=source.replace('renderGoldPlan(d.plan);','renderGoldPlan(lockGoldPlan(d.plan,d.price));drawIctLiquidityLevels(d.samples||[],d.price);');

const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
