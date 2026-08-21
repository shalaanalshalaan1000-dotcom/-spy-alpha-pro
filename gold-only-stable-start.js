import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Gold-only UI without strict patch anchors: every replacement is optional.
source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • GOLD INTELLIGENCE TERMINAL</p>');
source=source.replace('<span class="goldTag">SPOT • NO OPTIONS</span>','<span class="goldTag">XAUUSD • GOLD ONLY</span>');

// Add a visible locked-entry card when the original plan card is present.
const scenarioCard='<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>';
const scenarioWithEntry=scenarioCard+'<div class="goldPlanCard"><span>الدخول المقفول</span><strong id="goldEntryLocked">—</strong><small id="goldEntryLockStatus">بانتظار إشارة مكتملة</small></div>';
source=source.replace(scenarioCard,scenarioWithEntry);

const css=`
/* Stable gold-only shell */
.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}
main{max-width:1280px;padding:18px}.goldPanel{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
.goldHead{padding:18px 20px;border:1px solid #544725;border-radius:18px;background:linear-gradient(145deg,#17160f,#0c121c)}
.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}
.goldChartWrap{height:520px;border:1px solid #282d38;border-radius:18px}
#goldEntryLocked.locked{color:#52e5a5}#goldEntryLockStatus{color:#ffd166}
@media(max-width:900px){.goldMetrics{grid-template-columns:repeat(2,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

// Lock the first actionable gold plan in browser storage. Once locked, Entry/TP/SL
// do not move on every 30-second refresh. The lock is released only when the
// invalidation is hit, an opposite actionable signal appears, or after 4 hours.
const renderAnchor='function renderGoldPlan(plan){';
if(source.includes(renderAnchor)){
  const lockEngine=`const GOLD_TRADE_LOCK_KEY='gold_alpha_trade_lock_v1';
function readGoldTradeLock(){try{const x=JSON.parse(localStorage.getItem(GOLD_TRADE_LOCK_KEY)||'null');return x&&['UP','DOWN'].includes(x.state)?x:null}catch{return null}}
function writeGoldTradeLock(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function clearGoldTradeLock(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY)}catch{}}
function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();if(lock){const invalidation=Number(lock.invalidation),invalidated=Number.isFinite(invalidation)&&(lock.state==='UP'?p<=invalidation:p>=invalidation),opposite=active&&plan.state!==lock.state,expired=Date.now()-Number(lock.createdAt||0)>4*60*60_000;if(invalidated||opposite||expired){clearGoldTradeLock();lock=null}}
if(!lock&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now()};writeGoldTradeLock(lock)}
if(!lock)return{...plan,entry:null,locked:false};return{...plan,state:lock.state,confidence:Math.max(Number(plan.confidence||0),Number(lock.confidence||0)),entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,locked:true,lockCreatedAt:lock.createdAt,note:'ENTRY LOCKED — رقم الدخول والأهداف ووقف الإلغاء ثابتة حتى إلغاء السيناريو أو ظهور اتجاه جديد.'}}
`;
  source=source.replace(renderAnchor,lockEngine+renderAnchor);
}

source=source.replace(
  "function renderGoldPlan(plan){\n  const labels=",
  "function renderGoldPlan(plan){\n  const entryNode=$('#goldEntryLocked'),entryStatus=$('#goldEntryLockStatus');if(entryNode){entryNode.textContent=plan.locked?money(plan.entry):'—';entryNode.className=plan.locked?'locked':''}if(entryStatus)entryStatus.textContent=plan.locked?'LOCKED • لا يتغير مع التحديث':'بانتظار إشارة مكتملة';\n  const labels="
);
source=source.replace('renderGoldPlan(d.plan);','renderGoldPlan(lockGoldPlan(d.plan,d.price));');

// Stop stock/options polling in the browser when the known startup block is present.
const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
