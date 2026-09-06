import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function patchGoldAutoUI(source){
  const css=`
.goldAutoPanel{margin:0 0 14px;border:1px solid #2f6a57;border-radius:18px;background:linear-gradient(145deg,#0f1e1a,#0b111b);padding:16px}.goldAutoHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.goldAutoHead h2{margin:0;color:#74e3b8;font-size:18px}.goldAutoHead p{margin:5px 0 0;color:#8fa9a0;font-size:11px}.goldAutoBadge{padding:6px 9px;border:1px solid #397963;border-radius:999px;color:#74e3b8;background:#10271f;font-size:11px;font-weight:900}.goldAutoGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.goldAutoCard{padding:11px;border:1px solid #29473f;border-radius:11px;background:#0d1421}.goldAutoCard span,.goldAutoCard small{display:block;color:#8fa9a0;font-size:11px}.goldAutoCard strong{display:block;margin:6px 0;font-size:18px;direction:ltr;text-align:right}.goldAutoNote{margin:10px 0 0;color:#8fa9a0;font-size:11px;line-height:1.7}@media(max-width:760px){.goldAutoGrid{grid-template-columns:repeat(2,1fr)}.goldAutoHead{flex-direction:column}}
`;
  if(source.includes('</style></head>'))source=source.replace('</style></head>',css+'</style></head>');

  const panel=`<article class="goldAutoPanel"><div class="goldAutoHead"><div><h2>XAUUSD — التداول الآلي</h2><p>تنفيذ MT5 للذهب فقط • BTC غير مستخدم</p></div><span id="goldAutoBadge" class="goldAutoBadge">MT5 XAU</span></div><section class="goldAutoGrid"><div class="goldAutoCard"><span>حالة التنفيذ</span><strong id="goldAutoAction">انتظار</strong><small id="goldAutoConfidence">جاري القراءة</small></div><div class="goldAutoCard"><span>نطاق الدخول</span><strong id="goldAutoRange">—</strong><small id="goldAutoEntryState">لا توجد إشارة فعالة</small></div><div class="goldAutoCard"><span>وقف الخسارة</span><strong id="goldAutoStop">—</strong><small>وقف بنيوي</small></div><div class="goldAutoCard"><span>الهدف الأول</span><strong id="goldAutoT1">—</strong><small id="goldAutoRR">R:R —</small></div><div class="goldAutoCard"><span>الهدف الثاني</span><strong id="goldAutoT2">—</strong><small>امتداد الصفقة</small></div><div class="goldAutoCard"><span>الهدف الثالث</span><strong id="goldAutoT3">—</strong><small>امتداد متقدم</small></div><div class="goldAutoCard"><span>الهدف الرابع</span><strong id="goldAutoT4">—</strong><small>الهدف الأخير</small></div><div class="goldAutoCard"><span>حالة MT5</span><strong id="goldAutoMt5">جاهز</strong><small id="goldAutoUpdated">—</small></div></section><p id="goldAutoNote" class="goldAutoNote">المحرك يقرأ الذهب ويصدر BUY/SELL فقط عند اكتمال شروط التنفيذ.</p></article>`;
  const goldPanel='<article class="goldPanel">';
  if(source.includes(goldPanel)&&!source.includes('id="goldAutoAction"'))source=source.replace(goldPanel,panel+goldPanel);

  const client=`let goldAutoUiLoading=false;
const goldAutoMoney=v=>v!=null&&Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
async function loadGoldAutoUi(){if(goldAutoUiLoading)return;goldAutoUiLoading=true;try{const r=await fetch('/api/auto-trade/signal?observe=1',{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Auto signal unavailable');const side=['BUY','SELL'].includes(d.action)?d.action:['BUY','SELL'].includes(d.candidateAction)?d.candidateAction:'WAIT',active=['BUY','SELL'].includes(side),status=String(d.status||'WAIT').toUpperCase(),actionLabel=side==='BUY'?'شراء':side==='SELL'?'بيع':status==='COLLECTING'?'جاري القراءة':'انتظار';$('#goldAutoAction').textContent=actionLabel;$('#goldAutoAction').className=side==='BUY'?'positive':side==='SELL'?'negative':'WATCH';$('#goldAutoConfidence').textContent='الثقة '+Number(d.confidence||0)+'% • '+Number(d.sampleCount||0)+' عينة';$('#goldAutoRange').textContent=active?goldAutoMoney(d.entryLow)+' — '+goldAutoMoney(d.entryHigh):'—';$('#goldAutoEntryState').textContent=status==='ACTIVE'?'إشارة فعالة':status==='MANAGING'?'إدارة صفقة قائمة':status==='CANDIDATE'?'مرشح للدخول':status==='COLLECTING'?'يجمع شموع M1':'لا توجد إشارة فعالة';$('#goldAutoStop').textContent=active?goldAutoMoney(d.stopLoss):'—';$('#goldAutoT1').textContent=active?goldAutoMoney(d.target1):'—';$('#goldAutoT2').textContent=active?goldAutoMoney(d.target2):'—';$('#goldAutoT3').textContent=active?goldAutoMoney(d.target3):'—';$('#goldAutoT4').textContent=active?goldAutoMoney(d.target4):'—';$('#goldAutoRR').textContent=d.riskReward!=null?'R:R 1:'+Number(d.riskReward).toFixed(2):'R:R —';$('#goldAutoMt5').textContent=status==='ACTIVE'&&['BUY','SELL'].includes(d.action)?'تنفيذ الآن':status==='MANAGING'?'إدارة':'جاهز';$('#goldAutoBadge').textContent=status==='ACTIVE'?'XAU ACTIVE':status==='MANAGING'?'XAU MANAGING':'MT5 XAU';$('#goldAutoUpdated').textContent=d.updatedAt?new Date(d.updatedAt).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'}):'—';$('#goldAutoNote').textContent=d.reason||'المحرك يقرأ الذهب ويصدر BUY/SELL فقط عند اكتمال شروط التنفيذ.';}catch(e){$('#goldAutoBadge').textContent='غير متاح';$('#goldAutoMt5').textContent='خطأ';$('#goldAutoNote').textContent=e.message;}finally{goldAutoUiLoading=false}}
`;
  const asyncAnchor='(async()=>{';
  if(source.includes(asyncAnchor)&&!source.includes('function loadGoldAutoUi'))source=source.replace(asyncAnchor,client+'\n'+asyncAnchor);
  source=source.replace('await loadGold();','await Promise.all([loadGold(),loadGoldAutoUi()]);');
  source=source.replaceAll('setInterval(loadGold,5000);','setInterval(loadGold,5000);\n  setInterval(loadGoldAutoUi,5000);');
  source=source.replaceAll('setInterval(loadGold,20000);','setInterval(loadGold,20000);\n  setInterval(loadGoldAutoUi,5000);');
  source=source.replaceAll('setInterval(loadGold,30000);','setInterval(loadGold,30000);\n  setInterval(loadGoldAutoUi,5000);');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return originalWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchGoldAutoUI(isBuffer?data.toString('utf8'):String(data));
  return originalWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-reading-ui-start.js');
