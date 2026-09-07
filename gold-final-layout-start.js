import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchFinalGoldLayout(source){
  const css=`
.goldPlanGrid.finalGoldGrid{grid-template-columns:repeat(4,1fr)}
.goldPlanCard.actualEntry{border-color:#2f6a57}.goldPlanCard.actualEntry strong{color:#52e5a5}
.goldPlanCard.extendedLocked{opacity:.58}.goldPlanCard.extendedOpen{border-color:#5e806f;opacity:1}
@media(max-width:760px){.goldPlanGrid.finalGoldGrid{grid-template-columns:repeat(2,1fr)}}
`;
  if(!source.includes('.finalGoldGrid')&&source.includes('</style></head>'))source=source.replace('</style></head>',css+'</style></head>');

  const panel=`<section class="goldPlan" id="goldPlanFinal"><div class="goldPlanHead"><h3>توقع الذهب — نموذج 5 دقائق</h3><span id="goldPlanStatus" class="goldPlanStatus muted">جمع البيانات</span></div><div class="goldPlanGrid finalGoldGrid"><div class="goldPlanCard"><span>السيناريو / الثقة</span><strong id="goldScenario">انتظار</strong><small id="goldConfidence">جاري القراءة</small></div><div class="goldPlanCard"><span>نطاق الدخول</span><strong id="goldEntry">—</strong><small id="goldEntryRangeState">بين الحد الأدنى والحد الأعلى</small></div><div class="goldPlanCard actualEntry"><span>الدخول المفعّل</span><strong id="goldActualEntry">—</strong><small id="goldActualEntryState">يظهر بعد لمس نطاق الدخول</small></div><div class="goldPlanCard"><span>الهدف الأول</span><strong id="goldTarget1">—</strong><small id="goldEta1">المدة: —</small></div><div class="goldPlanCard"><span>الهدف الثاني</span><strong id="goldTarget2">—</strong><small id="goldEta2">المدة: —</small></div><div class="goldPlanCard extendedLocked" id="goldTarget3Card"><span>الهدف الثالث</span><strong id="goldTarget3">🔒</strong><small id="goldEta3">يتفعل بعد تحقق 1 و2</small></div><div class="goldPlanCard extendedLocked" id="goldTarget4Card"><span>الهدف الرابع</span><strong id="goldTarget4">🔒</strong><small id="goldEta4">يتفعل بعد تحقق 1 و2</small></div><div class="goldPlanCard"><span>وقف الخسارة</span><strong id="goldInvalidation">—</strong><small id="goldModelWindow">وقف السيناريو</small></div></div><p id="goldPlanNote" class="goldPlanNote">يتم تفعيل الدخول عند لمس النطاق، ثم تُتابع الأهداف بالتسلسل.</p></section>`;

  const planRe=/<section class="goldPlan"[^>]*>[\s\S]*?<\/section>/;
  if(planRe.test(source))source=source.replace(planRe,panel);

  const client=`
function syncFinalGoldLayout(){
  const q=s=>document.querySelector(s);if(!q('#goldPlanFinal'))return;
  let lock=null;try{lock=typeof readGoldTradeLock==='function'?readGoldTradeLock():null}catch{}
  if(!lock){q('#goldEntry').textContent='—';q('#goldActualEntry').textContent='—';q('#goldActualEntryState').textContent='بانتظار سيناريو جديد';q('#goldTarget3').textContent='🔒';q('#goldTarget4').textContent='🔒';return}
  const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
  const entry=Number(lock.entry),lo=Number.isFinite(Number(lock.entryLow))?Number(lock.entryLow):entry-.5,hi=Number.isFinite(Number(lock.entryHigh))?Number(lock.entryHigh):entry+.5;
  q('#goldEntry').textContent=money(lo)+' — '+money(hi);
  const entered=Boolean(lock.entryTouched),actual=Number.isFinite(Number(lock.actualEntry))?Number(lock.actualEntry):Number.isFinite(Number(lock.entryTouchedPrice))?Number(lock.entryTouchedPrice):entry;
  q('#goldActualEntry').textContent=entered?money(actual):'—';q('#goldActualEntryState').textContent=entered?'✓ تم تفعيل الدخول داخل النطاق':'بانتظار لمس نطاق الدخول';
  const hits=Array.isArray(lock.tpHits)?lock.tpHits:[false,false,false,false],open=Boolean(hits[0]&&hits[1]);
  const c3=q('#goldTarget3Card'),c4=q('#goldTarget4Card');if(c3)c3.className='goldPlanCard '+(open?'extendedOpen':'extendedLocked');if(c4)c4.className='goldPlanCard '+(open?'extendedOpen':'extendedLocked');
  q('#goldTarget3').textContent=open?money(lock.target3):'🔒';q('#goldTarget4').textContent=open?money(lock.target4):'🔒';
  q('#goldEta3').textContent=open?(hits[2]?'✓ تحقق':'الهدف الثالث مفعّل'):'يتفعل بعد تحقق 1 و2';q('#goldEta4').textContent=open?(hits[3]?'✓ تحقق':'الهدف الرابع مفعّل'):'يتفعل بعد تحقق 1 و2';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(syncFinalGoldLayout,900);setInterval(syncFinalGoldLayout,1000)});else{setTimeout(syncFinalGoldLayout,900);setInterval(syncFinalGoldLayout,1000)}
`;
  if(!source.includes('function syncFinalGoldLayout')&&source.includes('(async()=>{'))source=source.replace('(async()=>{',client+'\n(async()=>{');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchFinalGoldLayout(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-trade-history-start.js');
