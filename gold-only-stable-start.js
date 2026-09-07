import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourcePath=new URL('./server.js',import.meta.url);
const runtimePath=new URL('./.runtime-server.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

// Gold-only UI without strict patch anchors: every replacement is optional.
source=source.replace('<title>SPY Alpha Pro V4</title>','<title>Gold Alpha Pro — XAUUSD</title>');
source=source.replace('<h1>SPY Alpha Pro V4</h1><p>XAUUSD FOCUS • LEADERS • SPX 0DTE • AUTO OPTIONS RADAR</p>','<h1>Gold Alpha Pro</h1><p>XAUUSD ONLY • GOLD INTELLIGENCE TERMINAL</p>');
source=source.replace('<span class="goldTag">SPOT • NO OPTIONS</span>','<span class="goldTag">XAUUSD • GOLD ONLY</span>');

const scenarioCard='<div class="goldPlanGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">المطلوب 75% على الأقل</small></div>';
const scenarioWithEntry=scenarioCard+'<div class="goldPlanCard"><span>الدخول المقفول</span><strong id="goldEntryLocked">—</strong><small id="goldEntryLockStatus">بانتظار إشارة مكتملة</small></div>';
source=source.replace(scenarioCard,scenarioWithEntry);

const css=`
.toolbar,.hero,.grid,.chartCard,.scanner,.specScanner,.chain,.instrumentPolicy{display:none!important}
main{max-width:1280px;padding:18px}.goldPanel{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
.goldHead{padding:18px 20px;border:1px solid #544725;border-radius:18px;background:linear-gradient(145deg,#17160f,#0c121c)}
.goldPlan{border-color:#625329;background:linear-gradient(145deg,#17170f,#0c121c);border-radius:18px;padding:16px}
.goldChartWrap{height:520px;border:1px solid #282d38;border-radius:18px}
#goldEntryLocked.locked{color:#52e5a5}#goldEntryLockStatus{color:#ffd166}.goldHit{color:#52e5a5!important}.goldStop{color:#ff718c!important}
@media(max-width:900px){.goldMetrics{grid-template-columns:repeat(2,1fr)}.goldPlanGrid{grid-template-columns:repeat(2,1fr)}.goldChartWrap{height:430px}}
`;
source=source.replace('</style></head>',css+'</style></head>');

const renderAnchor='function renderGoldPlan(plan){';
if(source.includes(renderAnchor)){
  const lockEngine=`const GOLD_TRADE_LOCK_KEY='gold_alpha_trade_lock_v3',GOLD_TRADE_LOCK_LEGACY_KEY='gold_alpha_trade_lock_v2',GOLD_TRADE_COOLDOWN_KEY='gold_alpha_trade_cooldown_v3',GOLD_TRADE_COMPLETED_KEY='gold_alpha_trade_completed_v3',GOLD_TRADE_STOPPED_KEY='gold_alpha_trade_stopped_v1';
const GOLD_REENTRY_COOLDOWN_MS=10*60_000,GOLD_COMPLETED_RETENTION_MS=4*60*60_000,GOLD_FRESH_LEVEL_SHIFT=3.0,GOLD_STOP_RETENTION_MS=10*60_000;
function readJsonStorage(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}}
function readGoldTradeLock(){let x=readJsonStorage(GOLD_TRADE_LOCK_KEY);if(!x){const old=readJsonStorage(GOLD_TRADE_LOCK_LEGACY_KEY);if(old&&['UP','DOWN'].includes(old.state)){x={...old,tp1Hit:Boolean(old.tp1Hit),tp2Hit:Boolean(old.tp2Hit)};try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x));localStorage.removeItem(GOLD_TRADE_LOCK_LEGACY_KEY)}catch{}}}return x&&['UP','DOWN'].includes(x.state)?x:null}
function writeGoldTradeLock(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function clearGoldTradeLock(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY);localStorage.removeItem(GOLD_TRADE_LOCK_LEGACY_KEY)}catch{}}
function readGoldCooldown(){try{return Number(localStorage.getItem(GOLD_TRADE_COOLDOWN_KEY)||0)}catch{return 0}}
function setGoldCooldown(ms=GOLD_REENTRY_COOLDOWN_MS){try{localStorage.setItem(GOLD_TRADE_COOLDOWN_KEY,String(Date.now()+ms))}catch{}}
function setGoldCompleted(lock){try{localStorage.setItem(GOLD_TRADE_COMPLETED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,tp1Hit:true,tp2Hit:true,completedAt:Date.now()}))}catch{}}
function readGoldCompleted(){const x=readJsonStorage(GOLD_TRADE_COMPLETED_KEY);return x&&Date.now()-Number(x.completedAt||0)<GOLD_COMPLETED_RETENTION_MS?x:null}
function setGoldStopped(lock,price){try{localStorage.setItem(GOLD_TRADE_STOPPED_KEY,JSON.stringify({state:lock.state,entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,stopPrice:Number(price),tp1Hit:Boolean(lock.tp1Hit),tp2Hit:Boolean(lock.tp2Hit),stoppedAt:Date.now()}))}catch{}}
function readGoldStopped(){const x=readJsonStorage(GOLD_TRADE_STOPPED_KEY);if(!x)return null;if(Date.now()-Number(x.stoppedAt||0)>GOLD_STOP_RETENTION_MS){try{localStorage.removeItem(GOLD_TRADE_STOPPED_KEY)}catch{}return null}return x}
function clearGoldStopped(){try{localStorage.removeItem(GOLD_TRADE_STOPPED_KEY)}catch{}}
function reachedGoldLevel(state,p,level){const n=Number(level);return Number.isFinite(p)&&Number.isFinite(n)&&(state==='UP'?p>=n:p<=n)}
function goldLevelShifted(a,b){const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)>=GOLD_FRESH_LEVEL_SHIFT}
function isFreshAfterCompleted(plan,completed){if(!completed)return true;if(plan?.state!==completed.state)return true;return goldLevelShifted(plan?.target1,completed.target1)||goldLevelShifted(plan?.target2,completed.target2)||goldLevelShifted(plan?.invalidation,completed.invalidation)}
function stoppedGoldPlan(plan,stopped){return{...plan,state:'WAIT',entry:null,target1:null,target2:null,invalidation:null,locked:false,stopped:true,cooling:true,tp1Hit:false,tp2Hit:false,stoppedTrade:stopped,note:'⛔ وقف الخسارة تحقق — انتهى السيناريو. تم إلغاء الدخول والأهداف القديمة ويجري انتظار بنية جديدة.'}}
function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();if(lock){const invalidation=Number(lock.invalidation),invalidated=Number.isFinite(invalidation)&&(lock.state==='UP'?p<=invalidation:p>=invalidation),opposite=active&&plan.state!==lock.state,expired=Date.now()-Number(lock.createdAt||0)>4*60*60_000;lock.tp1Hit=Boolean(lock.tp1Hit)||reachedGoldLevel(lock.state,p,lock.target1);lock.tp2Hit=Boolean(lock.tp2Hit)||reachedGoldLevel(lock.state,p,lock.target2);if(lock.tp2Hit){clearGoldStopped();setGoldCompleted(lock);clearGoldTradeLock();setGoldCooldown();return{...plan,entry:null,locked:false,consumed:true,cooling:true,tradeCompleted:true,tp1Hit:false,tp2Hit:false,completedTrade:lock,note:'✓ اكتملت الصفقة السابقة — بانتظار سيناريو جديد.'}}if(invalidated){setGoldStopped(lock,p);clearGoldTradeLock();setGoldCooldown();return stoppedGoldPlan(plan,readGoldStopped())}if(opposite||expired){clearGoldTradeLock();lock=null}else writeGoldTradeLock(lock)}
const stopped=readGoldStopped(),completed=readGoldCompleted(),cooling=Date.now()<readGoldCooldown(),fresh=isFreshAfterCompleted(plan,completed);if(stopped&&cooling)return stoppedGoldPlan(plan,stopped);if(stopped&&!cooling)clearGoldStopped();if(!lock&&!cooling&&fresh&&active&&Number.isFinite(p)&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),createdAt:Date.now(),tp1Hit:false,tp2Hit:false};writeGoldTradeLock(lock)}
if(!lock){const consumed=Boolean(completed&&!fresh&&active);return{...plan,entry:null,locked:false,cooling,consumed,tradeCompleted:false,tp1Hit:false,tp2Hit:false,completedTrade:completed,note:consumed?'السيناريو السابق مستهلك — لا إعادة دخول من نفس المستويات. بانتظار بنية جديدة.':cooling?'الصفقة السابقة انتهت — إعادة تقييم السوق خلال فترة الحماية.':plan.note}}
return{...plan,state:lock.state,confidence:Math.max(Number(plan.confidence||0),Number(lock.confidence||0)),entry:lock.entry,target1:lock.target1,target2:lock.target2,invalidation:lock.invalidation,locked:true,lockCreatedAt:lock.createdAt,tp1Hit:Boolean(lock.tp1Hit),tp2Hit:Boolean(lock.tp2Hit),note:'ENTRY LOCKED — سيناريو واحد فقط. بعد اكتمال الأهداف يُستهلك ولا يُعاد دخوله.'}}
function renderGoldHitState(plan){const t1=$('#goldTarget1'),t2=$('#goldTarget2'),note=$('#goldPlanNote'),status=$('#goldPlanStatus'),scenario=$('#goldScenario'),invalid=$('#goldInvalidation');if(t1){t1.classList.toggle('goldHit',!!plan.tp1Hit);if(plan.tp1Hit&&!t1.textContent.includes('✓'))t1.textContent='✓ '+t1.textContent}if(t2){t2.classList.toggle('goldHit',!!plan.tp2Hit);if(plan.tp2Hit&&!t2.textContent.includes('✓'))t2.textContent='✓ '+t2.textContent}if(plan.stopped){if(status){status.textContent='STOP LOSS HIT';status.className='goldPlanStatus goldStop'}if(scenario){scenario.textContent='انتهى';scenario.className='goldStop'}if(t1){t1.textContent='—';t1.classList.remove('goldHit')}if(t2){t2.textContent='—';t2.classList.remove('goldHit')}if(invalid){invalid.textContent='—';invalid.className=''}if(note)note.textContent=plan.note;return}if(note&&(plan.tradeCompleted||plan.consumed||plan.cooling))note.textContent=plan.note}
`;
  source=source.replace(renderAnchor,lockEngine+renderAnchor);
}

source=source.replace(
  "function renderGoldPlan(plan){\n  const labels=",
  "function renderGoldPlan(plan){\n  const entryNode=$('#goldEntryLocked'),entryStatus=$('#goldEntryLockStatus');if(entryNode){entryNode.textContent=plan.locked?money(plan.entry):'—';entryNode.className=plan.locked?'locked':''}if(entryStatus)entryStatus.textContent=plan.stopped?'⛔ STOP LOSS HIT • بانتظار سيناريو جديد':plan.consumed?'CONSUMED • ممنوع إعادة الدخول':plan.cooling?'حماية بعد الإغلاق • إعادة تقييم…':plan.locked?'LOCKED • صفقة واحدة فقط':'بانتظار إشارة مكتملة';\n  const labels="
);
source=source.replace('renderGoldPlan(d.plan);','{const goldLockedPlan=lockGoldPlan(d.plan,d.price);renderGoldPlan(goldLockedPlan);renderGoldHitState(goldLockedPlan);}');

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

const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
