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

const secondTargetCard='<div class="goldPlanCard"><span>الهدف الثاني</span><strong id="goldTarget2">—</strong><small id="goldEta2">المدة: —</small></div>';
const extendedTargetCards=secondTargetCard+'<div class="goldPlanCard"><span>الهدف الثالث</span><strong id="goldTarget3">—</strong><small id="goldEta3">امتداد بعد الهدف الثاني</small></div><div class="goldPlanCard"><span>الهدف الرابع</span><strong id="goldTarget4">—</strong><small id="goldEta4">الامتداد الأخير للإشارة</small></div>';
source=source.replace(secondTargetCard,extendedTargetCards);

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
.targetHit{color:#52e5a5!important}.targetCurrent{color:#ffd166!important}
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
function extendGoldTargets(state,entry,target1,target2){const e=Number(entry),t1=Number(target1),t2=Number(target2),sign=state==='UP'?1:-1;if(!['UP','DOWN'].includes(state)||![e,t1,t2].every(Number.isFinite))return{target3:null,target4:null};const d1=Math.abs(t1-e),d2=Math.abs(t2-e);if(!(d1>0)||!(d2>d1))return{target3:null,target4:null};const d3=Math.max(d1*2.2,d2*1.35,d2+d1*.55),d4=Math.max(d1*3,d3*1.3,d3+d1*.7);return{target3:Number((e+sign*d3).toFixed(2)),target4:Number((e+sign*d4).toFixed(2))}}
function readGoldTradeLock(){try{const x=JSON.parse(localStorage.getItem(GOLD_TRADE_LOCK_KEY)||'null');return x&&['UP','DOWN'].includes(x.state)?x:null}catch{return null}}
function writeGoldTradeLock(x){try{localStorage.setItem(GOLD_TRADE_LOCK_KEY,JSON.stringify(x))}catch{}}
function clearGoldTradeLock(){try{localStorage.removeItem(GOLD_TRADE_LOCK_KEY)}catch{}}
function renewGoldPlanAfterAllTargets(lock,plan,price){const p=Number(price),sameDirection=plan?.state===lock?.state&&Number(plan?.confidence)>=75,allHit=[lock?.target1,lock?.target2,lock?.target3,lock?.target4].every(target=>goldTargetReached(lock?.state,p,target));if(!allHit)return lock;const sign=lock.state==='UP'?1:-1,fresh1=Number(plan?.target1),fresh2=Number(plan?.target2),freshAhead=sameDirection&&[fresh1,fresh2].every(Number.isFinite)&&(lock.state==='UP'?fresh1>p&&fresh2>fresh1:fresh1<p&&fresh2<fresh1),oldStep=Math.max(.05,Math.abs(Number(lock.target2)-Number(lock.target1))),target1=freshAhead?fresh1:p+sign*oldStep,target2=freshAhead?fresh2:p+sign*oldStep*1.6,extension=extendGoldTargets(lock.state,p,target1,target2),freshStop=Number(plan?.invalidation),freshStopValid=sameDirection&&Number.isFinite(freshStop)&&(lock.state==='UP'?freshStop<p:freshStop>p),protectedStop=Number(lock.target2);return{...lock,entry:p,target1:Number(target1.toFixed(2)),target2:Number(target2.toFixed(2)),target3:extension.target3,target4:extension.target4,invalidation:freshStopValid?freshStop:protectedStop,confidence:sameDirection?Number(plan.confidence):Number(lock.confidence),cycle:Number(lock.cycle||1)+1,createdAt:Date.now(),renewedAt:Date.now()}}
function lockGoldPlan(plan,price){const p=Number(price),active=['UP','DOWN'].includes(plan?.state);let lock=readGoldTradeLock();if(lock){if(lock.target3==null||lock.target4==null||!Number.isFinite(Number(lock.target3))||!Number.isFinite(Number(lock.target4))){lock={...lock,...extendGoldTargets(lock.state,lock.entry,lock.target1,lock.target2)};writeGoldTradeLock(lock)}const renewed=renewGoldPlanAfterAllTargets(lock,plan,p);if(renewed!==lock){lock=renewed;writeGoldTradeLock(lock)}const invalidation=Number(lock.invalidation),invalidated=Number.isFinite(invalidation)&&(lock.state==='UP'?p<=invalidation:p>=invalidation),opposite=active&&plan.state!==lock.state,expired=Date.now()-Number(lock.createdAt||0)>4*60*60_000;if(invalidated||opposite||expired){clearGoldTradeLock();lock=null}}if(!lock&&active&&Number.isFinite(p)&&plan.target1!=null&&plan.target2!=null&&plan.invalidation!=null&&Number.isFinite(Number(plan.target1))&&Number.isFinite(Number(plan.target2))&&Number.isFinite(Number(plan.invalidation))){const extension=extendGoldTargets(plan.state,p,plan.target1,plan.target2);lock={state:plan.state,entry:p,target1:Number(plan.target1),target2:Number(plan.target2),target3:extension.target3,target4:extension.target4,invalidation:Number(plan.invalidation),confidence:Number(plan.confidence||0),cycle:1,createdAt:Date.now()};writeGoldTradeLock(lock)}if(!lock)return{...plan,currentPrice:p,entry:null,target3:null,target4:null,locked:false};return{...plan,state:lock.state,confidence:Math.max(Number(plan.confidence||0),Number(lock.confidence||0)),currentPrice:p,entry:lock.entry,target1:lock.target1,target2:lock.target2,target3:lock.target3,target4:lock.target4,invalidation:lock.invalidation,locked:true,lockCreatedAt:lock.createdAt,note:Number(lock.cycle||1)>1?'تم تحقق الأهداف السابقة وإصدار أهداف جديدة بعد إعادة تأكيد الاتجاه • الجولة '+lock.cycle:'ENTRY LOCKED — بعد تحقق الأهداف الأربعة يعاد التأكيد وتصدر مجموعة أهداف جديدة تلقائيًا.'}}
function goldTargetReached(state,price,target){const p=Number(price),t=Number(target);return target!=null&&Number.isFinite(p)&&Number.isFinite(t)&&(state==='UP'?p>=t:state==='DOWN'?p<=t:false)}
function renderGoldTargetProgress(plan){const targets=[plan.target1,plan.target2,plan.target3,plan.target4],etas=[plan.eta1,plan.eta2,null,null],price=Number(plan.currentPrice),hits=targets.map(t=>goldTargetReached(plan.state,price,t)),next=hits.findIndex(x=>!x);for(let i=0;i<4;i++){const node=$('#goldEta'+(i+1));if(!node)continue;if(!plan.locked||targets[i]==null||!Number.isFinite(Number(targets[i]))){node.textContent='—';node.className='';continue}if(hits[i]){node.textContent='✓ تحقق';node.className='targetHit';continue}if(i===next){node.textContent=(etas[i]?'المدة: '+etas[i]+' • ':'')+'الهدف الحالي';node.className='targetCurrent'}else{node.textContent=i===3?'الامتداد الأخير للإشارة':'امتداد بعد الهدف '+i;node.className=''}}}
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
source=source.replace(
  "  $('#goldTarget2').textContent=active?money(plan.target2):'—';$('#goldTarget2').className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':'';",
  "  $('#goldTarget2').textContent=active?money(plan.target2):'—';$('#goldTarget2').className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':'';const target3Node=$('#goldTarget3'),target4Node=$('#goldTarget4');if(target3Node){target3Node.textContent=active&&plan.target3!=null&&Number.isFinite(Number(plan.target3))?money(plan.target3):'—';target3Node.className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':''}if(target4Node){target4Node.textContent=active&&plan.target4!=null&&Number.isFinite(Number(plan.target4))?money(plan.target4):'—';target4Node.className=plan.state==='UP'?'positive':plan.state==='DOWN'?'negative':''}"
);
source=source.replace(
  "  $('#goldEta1').textContent='المدة: '+(plan.eta1||'—');$('#goldEta2').textContent='المدة: '+(plan.eta2||'—');",
  "  $('#goldEta1').textContent='المدة: '+(plan.eta1||'—');$('#goldEta2').textContent='المدة: '+(plan.eta2||'—');renderGoldTargetProgress(plan);"
);
source=source.replace('renderGoldPlan(d.plan);','renderGoldPlan(lockGoldPlan(d.plan,d.price));drawIctLiquidityLevels(d.samples||[],d.price);');

const stockStartup="await Promise.all([analyze(),loadScan(),loadSpeculative(),loadGold()]);\n  setInterval(()=>{if($('#auto').checked)analyze()},30000);\n  setInterval(()=>{if($('#auto').checked)loadScan()},60000);\n  setInterval(()=>{if($('#auto').checked)loadSpeculative()},300000);\n  setInterval(()=>{if($('#auto').checked)loadGold()},30000);";
const goldStartup="await loadGold();\n  setInterval(loadGold,30000);";
source=source.replace(stockStartup,goldStartup);

for(const marker of ['id="goldTarget3"','id="goldTarget4"','function extendGoldTargets','renderGoldTargetProgress(plan);']){
  if(!source.includes(marker))throw new Error('Gold four-target patch failed: '+marker);
}

writeFileSync(runtimePath,source,'utf8');
await import(pathToFileURL(runtimePath.pathname).href+'?v='+Date.now());
