import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync=fs.writeFileSync.bind(fs);

function patchCommercialDashboard(source){
  if(!source.includes('GOLD_ALPHA_JOURNAL_FILE')){
    const helperPrelude=`import perfFs from 'node:fs';
import perfPath from 'node:path';
const GOLD_ALPHA_JOURNAL_FILE=perfPath.join(process.env.GOLD_ALPHA_DATA_DIR||'/tmp/gold-alpha-commercial','xau-forward-journal.json');
function readCommercialJournal(){try{const x=JSON.parse(perfFs.readFileSync(GOLD_ALPHA_JOURNAL_FILE,'utf8'));return Array.isArray(x)?x:[]}catch{return[]}}
function commercialMetrics(rows){const executed=rows.filter(r=>r.executed),open=executed.filter(r=>!r.closedAt),closed=executed.filter(r=>r.closedAt),tp=n=>executed.filter(r=>r['tp'+n]===true).length,sl=executed.filter(r=>r.result==='SL'||r.stopped===true).length,wins=closed.filter(r=>r.tp1===true).length;return{signals:rows.length,executed:executed.length,open:open.length,closed:closed.length,tp1:tp(1),tp2:tp(2),tp3:tp(3),tp4:tp(4),sl,winRate:closed.length?Number((wins/closed.length*100).toFixed(1)):null}}
`;
    source=helperPrelude+source;
  }

  const serverAnchor="const server=http.createServer(async(req,res)=>{";
  if(source.includes(serverAnchor)&&!source.includes("/api/performance/journal")){
    source=source.replace(serverAnchor,serverAnchor+"const perfUrl=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&perfUrl.pathname==='/api/performance/journal'){const rows=readCommercialJournal();return sendJSON(res,200,{ok:true,persistent:!String(GOLD_ALPHA_JOURNAL_FILE).startsWith('/tmp/'),metrics:commercialMetrics(rows),trades:rows.slice().reverse().slice(0,100)})}");
  }

  const css=`\n.goldPerf{margin:14px 0 18px;border:1px solid #39475a;border-radius:18px;background:#0b111b;padding:14px}.goldPerf h2{margin:0 0 10px;color:#f0d58b;font-size:17px}.goldPerfGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}.goldPerfCard{border:1px solid #283446;border-radius:12px;padding:10px;text-align:center}.goldPerfCard span{display:block;color:#8f9bae;font-size:11px}.goldPerfCard strong{display:block;color:#eef3f8;font-size:18px;margin-top:3px}.goldPerfTableWrap{overflow-x:auto}.goldPerfTable{width:100%;min-width:1000px;border-collapse:collapse;font-size:12px}.goldPerfTable th,.goldPerfTable td{padding:9px 7px;border-bottom:1px solid #202938;text-align:center;white-space:nowrap}.goldPerfTable th{color:#9ca8b8}.goldPerfBuy,.goldPerfWin{color:#52e5a5;font-weight:900}.goldPerfSell,.goldPerfLoss{color:#ff718c;font-weight:900}.goldPerfNote{font-size:11px;color:#8e9aab;margin-top:8px}@media(max-width:760px){.goldPerfGrid{grid-template-columns:repeat(2,1fr)}}\n`;
  if(!source.includes('.goldPerf{')&&source.includes('</style></head>'))source=source.replace('</style></head>',css+'</style></head>');

  const panel=`<section class="goldPerf" id="goldPerformanceDashboard"><h2>📊 سجل أداء Gold Alpha — XAUUSD</h2><div class="goldPerfGrid"><div class="goldPerfCard"><span>الإشارات</span><strong id="perfSignals">0</strong></div><div class="goldPerfCard"><span>المنفذة</span><strong id="perfExecuted">0</strong></div><div class="goldPerfCard"><span>المفتوحة</span><strong id="perfOpen">0</strong></div><div class="goldPerfCard"><span>TP1</span><strong id="perfTp1">0</strong></div><div class="goldPerfCard"><span>TP2</span><strong id="perfTp2">0</strong></div><div class="goldPerfCard"><span>TP3</span><strong id="perfTp3">0</strong></div><div class="goldPerfCard"><span>TP4</span><strong id="perfTp4">0</strong></div><div class="goldPerfCard"><span>SL</span><strong id="perfSl">0</strong></div><div class="goldPerfCard"><span>Win Rate</span><strong id="perfWinRate">—</strong></div><div class="goldPerfCard"><span>التخزين</span><strong id="perfStorage">—</strong></div></div><div class="goldPerfTableWrap"><table class="goldPerfTable"><thead><tr><th>وقت الإشارة</th><th>الاتجاه</th><th>نطاق الدخول</th><th>الدخول الفعلي</th><th>TP1</th><th>TP2</th><th>TP3</th><th>TP4</th><th>SL</th><th>الحالة</th></tr></thead><tbody id="perfRows"></tbody></table></div><div class="goldPerfNote" id="perfNote">يتم احتساب النتائج من الصفقات التي تم تفعيل دخولها فقط. الإشارات غير المفعلة لا تُحسب كربح أو خسارة.</div></section>`;
  if(!source.includes('id="goldPerformanceDashboard"')){
    if(source.includes('</main>'))source=source.replace('</main>',panel+'</main>');
    else if(source.includes('</body>'))source=source.replace('</body>',panel+'</body>');
  }

  const client=`\nfunction perfMoney(v){return Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—'}\nfunction perfTime(v){try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return'—'}}\nasync function refreshGoldPerformance(){const root=document.getElementById('goldPerformanceDashboard');if(!root)return;try{const r=await fetch('/api/performance/journal',{cache:'no-store'});if(!r.ok)return;const d=await r.json(),m=d.metrics||{};for(const [id,val] of [['perfSignals',m.signals],['perfExecuted',m.executed],['perfOpen',m.open],['perfTp1',m.tp1],['perfTp2',m.tp2],['perfTp3',m.tp3],['perfTp4',m.tp4],['perfSl',m.sl]]){const e=document.getElementById(id);if(e)e.textContent=String(val??0)}const wr=document.getElementById('perfWinRate');if(wr)wr.textContent=m.winRate==null?'—':m.winRate+'%';const st=document.getElementById('perfStorage');if(st)st.textContent=d.persistent?'دائم ✓':'مؤقت ⚠';const body=document.getElementById('perfRows');if(!body)return;body.innerHTML='';for(const t of d.trades||[]){const tr=document.createElement('tr'),side=t.side==='BUY'?'BUY':'SELL',status=t.executed?(t.closedAt?(t.result||'CLOSED'):'OPEN'):(t.closedAt?(t.result||'CANCELLED'):'NOT TRIGGERED'),cls=side==='BUY'?'goldPerfBuy':'goldPerfSell',rcls=status==='SL'?'goldPerfLoss':(String(status).startsWith('TP')?'goldPerfWin':'');tr.innerHTML='<td>'+perfTime(t.issuedAt)+'</td><td class="'+cls+'">'+side+'</td><td>'+perfMoney(t.entryLow)+' — '+perfMoney(t.entryHigh)+'</td><td>'+perfMoney(t.executedPrice)+'</td><td>'+(t.tp1?'✓':'—')+'</td><td>'+(t.tp2?'✓':'—')+'</td><td>'+(t.tp3?'✓':'—')+'</td><td>'+(t.tp4?'✓':'—')+'</td><td>'+(t.stopped?'✓':'—')+'</td><td class="'+rcls+'">'+status+'</td>';body.appendChild(tr)}}catch{}}\nif(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(refreshGoldPerformance,1500);setInterval(refreshGoldPerformance,5000)});else{setTimeout(refreshGoldPerformance,1500);setInterval(refreshGoldPerformance,5000)}\n`;
  if(!source.includes('function refreshGoldPerformance')){
    const dashboardIndex=source.indexOf('id="goldPerformanceDashboard"');
    const scriptEnd=dashboardIndex>=0?source.indexOf('</script></body>',dashboardIndex):-1;
    if(scriptEnd<0)throw new Error('Commercial dashboard script anchor missing');
    source=source.slice(0,scriptEnd)+client+source.slice(scriptEnd);
  }
  return source;
}

fs.writeFileSync=function(file,data,...args){
  const p=String(file);
  const target=p.endsWith('/.runtime-server.mjs')||p.endsWith('\\.runtime-server.mjs')||p.endsWith('/gold-app-daily-ledger.mjs')||p.endsWith('\\gold-app-daily-ledger.mjs');
  if(!target)return originalWriteFileSync(file,data,...args);
  const isBuffer=Buffer.isBuffer(data),patched=patchCommercialDashboard(isBuffer?data.toString('utf8'):String(data));
  return originalWriteFileSync(file,isBuffer?Buffer.from(patched,'utf8'):patched,...args);
};

syncBuiltinESMExports();
await import('./gold-commercial-journal-start.js');
