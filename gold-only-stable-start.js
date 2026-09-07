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
#goldEntryLocked.locked{color:#52e5a5}#goldEntryLockStatus{color:#ffd166}.goldHit{color:#52e5a5!important}
@media(max-width:900px){.goldMetrics{grid-template-columns:repeat(2,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

// Persistent target-hit tracking. Legacy v1 locks are migrated so an already
// completed trade is released immediately after this deploy.
const renderAnchor='function renderGoldPlan(plan){';
if(source.includes(renderAnchor)){
  const lockEngine=`const GOLD_TRADE_LOCK_KEY='gold_alpha_trade_lock_v2',GOLD_TRADE_LOCK_LEGACY_KEY='gold_alpha_trade_lock_v1',GOLD_TRADE_COOLDOWN_KEY='gold_alpha_trade_cooldown_v2',GOLD_TRADE_COMPLETED_KEY='gold_alpha_trade_completed_v2';
function readJsonStorage(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}}
function readGoldTradeLock(){let x=readJsonStorage(GOLD_TRADE_LOCK_KEY);if(!x){const old=readJsonStorage(GOLD_TRADE_LOCK_LEGACY_KEY);if(old&&['UP','DOWN'].includes(old.state)){x={...old,tp1Hit:false,tp2Hit:false};try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x));localStorage.removeItem(GOLD_TRADE_LOCK_LEGACY_KEY)}catch{}}}return x&&['UP','DOWN'].includes(x.state)?x:null}
function writeGoldTradeLock(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function clearGoldTradeLock(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY);localStorage.removeItem(GOLD_TRADE_LOCK_LEGACY_KEY)}catch{}}
function readGoldCooldown(){try{return Number(localStorage.getItem(GOLD_TRADE_COOLDOWN_KEY)||0)}catch{return 0}}
function setGoldCooldown(ms=180000){try{localStorage.setItem(GOLD_TRADE_COOLDOWN_KEY,String(Date.now()+ms))}catch{}}
function setGoldCompleted(lock){try{localStorage.setItem(GOLD_TRADE_COMPLETED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,tp1Hit:true,tp2Hit:true,completedAt:Date.now()}))}catch{}}
function readGoldCompleted(){const x=readJsonStorage(GOLD_TRADE_COMPLETED_KEY);return x&&Date.now()-Number(x.completedAt||0)<180000?x:null}
function reachedGoldLevel(state,p,level){const n=Number(level);return Number.isFinite(p)&&Number.isFinite(n)&&(state==='UP'?p>=n:p<=n)}
function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();if(lock){const invalidation=Number(lock.invalidation),invalidated=Number.isFinite(invalidation)&&(lock.state==='UP'?p<=invalidation:p>=invalidation),opposite=active&&plan.state!==lock.state,expired=Date.now()-Number(lock.createdAt||0)>4*60*60_000;lock.tp1Hit=Boolean(lock.tp1Hit)||reachedGoldLevel(lock.state,p,lock.target1);lock.tp2Hit=Boolean(lock.tp2Hit)||reachedGoldLevel(lock.state,p,lock.target2);if(lock.tp2Hit){setGoldCompleted(lock);clearGoldTradeLock();setGoldCooldown();return{...plan,entry:null,locked:false,tradeCompleted:true,tp1Hit:true,tp2Hit:true,completedTrade:lock,note:'✓ اكتملت الصفقة — جميع الأهداف المحفوظة تحققت ويبحث النظام عن إشارة جديدة.'}}if(invalidated||opposite||expired){clearGoldTradeLock();lock=null}else writeGoldTradeLock(lock)}
const completed=readGoldCompleted(),cooling=Date.now()<readGoldCooldown();if(!lock&&!cooling&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now(),tp1Hit:false,tp2Hit:false};writeGoldTradeLock(lock)}
if(!lock)return{...plan,entry:null,locked:false,cooling,tradeCompleted:Boolean(completed),tp1Hit:Boolean(completed?.tp1Hit),tp2Hit:Boolean(completed?.tp2Hit),completedTrade:completed,note:completed?'✓ اكتملت الصفقة السابقة — الأهداف تحققت، وإعادة تقييم السوق جارية.':plan.note};return{...plan,state:lock.state,confidence:Math.max(Number(plan.confidence||0),Number(lock.confidence||0)),entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,locked:true,lockCreatedAt:lock.createdAt,tp1Hit:Boolean(lock.tp1Hit),tp2Hit:Boolean(lock.tp2Hit),note:'ENTRY LOCKED — يتم تثبيت تحقق الأهداف حتى لو ارتد السعر.'}}
function renderGoldHitState(plan){const t1=$('#goldTarget1'),t2=$('#goldTarget2'),note=$('#goldPlanNote');if(t1){t1.classList.toggle('goldHit',!!plan.tp1Hit);if(plan.tp1Hit&&!t1.textContent.includes('✓'))t1.textContent='✓ '+t1.textContent}if(t2){t2.classList.toggle('goldHit',!!plan.tp2Hit);if(plan.tp2Hit&&!t2.textContent.includes('✓'))t2.textContent='✓ '+t2.textContent}if(note&&plan.tradeCompleted)note.textContent='✓ اكتملت الصفقة — جميع الأهداف تحققت. تم فك ENTRY LOCKED ويبحث النظام عن إشارة جديدة.'}
`;
  source=source.replace(renderAnchor,lockEngine+renderAnchor);
}

source=source.replace(
  "function renderGoldPlan(plan){\n  const labels=",
  "function renderGoldPlan(plan){\n  const entryNode=$('#goldEntryLocked'),entryStatus=$('#goldEntryLockStatus');if(entryNode){entryNode.textContent=plan.locked?money(plan.entry):'—';entryNode.className=plan.locked?'locked':''}if(entryStatus)entryStatus.textContent=plan.tradeCompleted?'✓ اكتملت الصفقة — جميع الأهداف تحققت':plan.cooling?'إعادة تقييم السوق…':plan.locked?'LOCKED • لا يتغير مع التحديث':'بانتظار إشارة مكتملة';\n  const labels="
);
source=source.replace('renderGoldPlan(d.plan);','{const goldLockedPlan=lockGoldPlan(d.plan,d.price);renderGoldPlan(goldLockedPlan);renderGoldHitState(goldLockedPlan);}');

// Browser-side quote guard: keep the last valid XAU response and reuse it if
// gold-api temporarily returns an invalid body/price. This avoids replacing a
// known-good market price with bad provider data and survives page refreshes.
const startupAnchor='(async()=>{';
if(source.includes(startupAnchor)){
  const quoteGuard=`const GOLD_LAST_VALID_QUOTE_KEY='gold_alpha_last_valid_quote_v1';
const goldNativeFetch=window.fetch.bind(window);
function goldReadCachedQuote(){try{const x=JSON.parse(localStorage.getItem(GOLD_LAST_VALID_QUOTE_KEY)||'null');return x&&Number.isFinite(Number(x.price))&&Number(x.price)>0?x:null}catch{return null}}
function goldSaveCachedQuote(x){try{if(x&&Number.isFinite(Number(x.price))&&Number(x.price)>0)localStorage.setItem(GOLD_LAST_VALID_QUOTE_KEY,JSON.stringify(x))}catch{}}
window.fetch=async function(input,init){const url=typeof input==='string'?input:String(input?.url||input);const response=await goldNativeFetch(input,init);if(!url.includes('api.gold-api.com/price/XAU'))return response;try{const data=await response.clone().json(),price=Number(data?.price);if(response.ok&&Number.isFinite(price)&&price>0){goldSaveCachedQuote(data);return response}const cached=goldReadCachedQuote();if(cached)return new Response(JSON.stringify({...cached,cachedFallback:true}),{status:200,headers:{'content-type':'application/json'}})}catch{const cached=goldReadCachedQuote();if(cached)return new Response(JSON.stringify({...cached,cachedFallback:true}),{status:200,headers:{'content-type':'application/json'}})}return response};
`;
  source=source.replace(startupAnchor,quoteGuard+'\n'+startupAnchor);
}

// Stop stock/options polling in the browser when the known startup block is present.
const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
