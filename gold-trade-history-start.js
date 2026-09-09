import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const previousWriteFileSync=fs.writeFileSync.bind(fs);

function patchGoldTradeHistory(source){
  const css=`
.goldHistory{margin:14px 0 18px;border:1px solid #3a4658;border-radius:18px;background:#0b111b;padding:14px;overflow:hidden}.goldHistoryHead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.goldHistoryHead h2{margin:0;font-size:17px;color:#f0d58b}.goldHistoryHead span{font-size:11px;color:#8e9aab}.goldHistoryWrap{overflow-x:auto}.goldHistoryTable{width:100%;border-collapse:collapse;min-width:900px;font-size:12px}.goldHistoryTable th,.goldHistoryTable td{padding:10px 8px;border-bottom:1px solid #202938;text-align:center;white-space:nowrap}.goldHistoryTable th{color:#9ca8b8;font-weight:800}.goldHistoryTable td{color:#e8edf4}.goldHistoryTable .buy{color:#52e5a5;font-weight:900}.goldHistoryTable .sell{color:#ff718c;font-weight:900}.goldHistoryTable .win{color:#52e5a5;font-weight:900}.goldHistoryTable .loss{color:#ff718c;font-weight:900}.goldHistoryEmpty{padding:18px;text-align:center;color:#7f8ba3;font-size:12px}@media(max-width:760px){.goldHistory{padding:10px}}
`;
  if(!source.includes('.goldHistory{')&&source.includes('</style></head>'))source=source.replace('</style></head>',css+'</style></head>');

  const panel=`<section class="goldHistory"><div class="goldHistoryHead"><h2>جدول الصفقات — XAUUSD</h2><span>آخر 30 صفقة</span></div><div class="goldHistoryWrap"><table class="goldHistoryTable"><thead><tr><th>الوقت</th><th>الاتجاه</th><th>نطاق الدخول</th><th>الدخول الفعلي</th><th>وقف الخسارة</th><th>الأهداف</th><th>النتيجة</th></tr></thead><tbody id="goldHistoryBody"></tbody></table><div id="goldHistoryEmpty" class="goldHistoryEmpty">لا توجد صفقات مسجلة بعد.</div></div></section>`;
  if(!source.includes('id="goldHistoryBody"')){
    const autoPanelEnd='</article><article class="goldPanel">';
    if(source.includes(autoPanelEnd))source=source.replace(autoPanelEnd,'</article>'+panel+'<article class="goldPanel">');
    else if(source.includes('<article class="goldPanel">'))source=source.replace('<article class="goldPanel">',panel+'<article class="goldPanel">');
  }

  const client=`
const GOLD_HISTORY_KEY='gold_alpha_trade_history_v1',GOLD_HISTORY_LAST_KEY='gold_alpha_trade_history_last_lock_v1';
function readGoldHistory(){try{const x=JSON.parse(localStorage.getItem(GOLD_HISTORY_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
function writeGoldHistory(rows){try{localStorage.setItem(GOLD_HISTORY_KEY,JSON.stringify(rows.slice(-30)))}catch{}}
function goldHistoryKey(x){return [x?.state,x?.createdAt,x?.entry,x?.target1,x?.invalidation].join('|')}
function goldHistoryTime(ts){try{return new Date(Number(ts)||Date.now()).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})}catch{return'—'}}
function goldHistoryMoney(v){return Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—'}
function goldHistoryTargets(x){const h=Array.isArray(x?.tpHits)?x.tpHits:[false,false,false,false];const c=h.filter(Boolean).length;return c?('✓ '+c+'/4'):'0/4'}
function saveGoldHistorySnapshot(lock,result){if(!lock)return;const rows=readGoldHistory(),key=goldHistoryKey(lock),i=rows.findIndex(r=>r.key===key),row={key,openedAt:lock.createdAt||Date.now(),side:lock.state==='UP'?'BUY':'SELL',entryLow:Number.isFinite(Number(lock.entryLow))?Number(lock.entryLow):Number(lock.entry)-.5,entryHigh:Number.isFinite(Number(lock.entryHigh))?Number(lock.entryHigh):Number(lock.entry)+.5,entry:Number(lock.entry),stop:Number(lock.invalidation),tpHits:Array.isArray(lock.tpHits)?lock.tpHits:[false,false,false,false],result:result||'ACTIVE'};if(i>=0)rows[i]={...rows[i],...row};else rows.push(row);writeGoldHistory(rows)}
function syncGoldTradeHistory(){let lock=null;try{lock=readGoldTradeLock()}catch{}let last=null;try{last=JSON.parse(localStorage.getItem(GOLD_HISTORY_LAST_KEY)||'null')}catch{}if(lock){saveGoldHistorySnapshot(lock,'ACTIVE');try{localStorage.setItem(GOLD_HISTORY_LAST_KEY,JSON.stringify(lock))}catch{}}else if(last){let result='CLOSED';try{const cd=readGoldCooldown();if(cd?.reason==='STOP_HIT')result='SL';else if(Array.isArray(last.tpHits)&&last.tpHits.every(Boolean))result='TP4';else if(Array.isArray(last.tpHits)&&last.tpHits.some(Boolean))result='PARTIAL'}catch{}saveGoldHistorySnapshot(last,result);try{localStorage.removeItem(GOLD_HISTORY_LAST_KEY)}catch{}}renderGoldTradeHistory()}
function renderGoldTradeHistory(){const body=document.getElementById('goldHistoryBody'),empty=document.getElementById('goldHistoryEmpty');if(!body)return;const rows=readGoldHistory().slice().reverse();body.innerHTML='';if(empty)empty.style.display=rows.length?'none':'block';for(const r of rows){const tr=document.createElement('tr'),side=r.side==='BUY'?'BUY':'SELL',cls=side==='BUY'?'buy':'sell',result=String(r.result||'ACTIVE'),rcls=result==='SL'?'loss':result==='TP4'||result==='PARTIAL'?'win':'';tr.innerHTML='<td>'+goldHistoryTime(r.openedAt)+'</td><td class="'+cls+'">'+side+'</td><td>'+goldHistoryMoney(r.entryLow)+' — '+goldHistoryMoney(r.entryHigh)+'</td><td>'+goldHistoryMoney(r.entry)+'</td><td>'+goldHistoryMoney(r.stop)+'</td><td>'+goldHistoryTargets(r)+'</td><td class="'+rcls+'">'+result+'</td>';body.appendChild(tr)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(syncGoldTradeHistory,1200);setInterval(syncGoldTradeHistory,1000)});else{setTimeout(syncGoldTradeHistory,1200);setInterval(syncGoldTradeHistory,1000)}
`;
  if(!source.includes('function syncGoldTradeHistory')&&source.includes('(async()=>{'))source=source.replace('(async()=>{',client+'\n(async()=>{');
  return source;
}

fs.writeFileSync=function(path,data,...args){
  const p=String(path);
  if(!p.endsWith('/.runtime-server.mjs')&&!p.endsWith('\\.runtime-server.mjs'))return previousWriteFileSync(path,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchGoldTradeHistory(isBuffer?data.toString('utf8'):String(data));
  return previousWriteFileSync(path,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-target-range-fix-start.js');
