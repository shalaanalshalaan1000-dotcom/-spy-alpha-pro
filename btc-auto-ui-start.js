import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';

const originalWriteFileSync = fs.writeFileSync.bind(fs);

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error('BTC auto UI patch target was not found: ' + label);
  return source.replace(before, () => after);
}

function applyBtcAutoUi(source) {
  const css = `
.btcAutoPanel{margin:0 0 14px;border:1px solid #8a5a24;border-radius:18px;background:linear-gradient(145deg,#21170c,#0b111b);padding:16px}.btcAutoHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.btcAutoHead h2{margin:0;color:#f3bf66;font-size:18px}.btcAutoHead p{margin:5px 0 0;color:#b7a07a;font-size:11px}.btcAutoBadge{padding:6px 9px;border:1px solid #9d6d31;border-radius:999px;color:#f3bf66;background:#2a1c0d;font-size:11px;font-weight:900}.btcAutoGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.btcAutoCard{padding:11px;border:1px solid #5f4325;border-radius:11px;background:#0d1421}.btcAutoCard span,.btcAutoCard small{display:block;color:#ad9979;font-size:11px}.btcAutoCard strong{display:block;margin:6px 0;font-size:18px;direction:ltr;text-align:right}.btcAutoStatus{margin-top:4px;color:#d7c39f!important;font-weight:800}.btcAutoNote{margin:10px 0 0;color:#ad9979;font-size:11px;line-height:1.7}@media(max-width:760px){.btcAutoGrid{grid-template-columns:repeat(2,1fr)}.btcAutoHead{flex-direction:column}}
`;
  source = replaceRequired(source, '</style></head>', css + '</style></head>', 'style end');

  const panel = `<article class="btcAutoPanel"><div class="btcAutoHead"><div><h2>BTCUSD — التداول الآلي السريع</h2><p>محرك سكالب مستقل للبيتكوين • هذه هي حالة التنفيذ الفعلية التي يقرأها MT5</p></div><span id="btcAutoBadge" class="btcAutoBadge">BTC MT5 READY</span></div><section class="btcAutoGrid"><div class="btcAutoCard"><span>إشارة البيتكوين</span><strong id="btcAutoAction">انتظار</strong><small id="btcAutoConfidence">فحص السوق</small><small id="btcAutoStatus" class="btcAutoStatus">الحالة: فحص السوق</small></div><div class="btcAutoCard"><span>نطاق الدخول</span><strong id="btcAutoRange">—</strong><small>نافذة تنفيذ قصيرة</small></div><div class="btcAutoCard"><span>وقف الخسارة</span><strong id="btcAutoStop">—</strong><small>مستقل عن وقف الذهب</small></div><div class="btcAutoCard"><span>هدف السكالب الأول</span><strong id="btcAutoTarget">—</strong><small>هدف قريب لخروج سريع</small></div></section><p id="btcAutoNote" class="btcAutoNote">يبحث محرك BTC عن إشارة تنفيذ فعلية قبل إرسالها إلى MT5.</p></article>`;
  source = replaceRequired(source, '<article class="autoTradePanel">', panel + '<article class="autoTradePanel">', 'gold execution panel');

  const client = `let btcAutoTradeLoading=false;
async function loadBtcAutoTrade(){if(btcAutoTradeLoading)return;btcAutoTradeLoading=true;try{const r=await fetch('/api/auto-trade/signal?asset=BTCUSD',{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'BTC signal request failed');const execSide=['BUY','SELL'].includes(d.action)?d.action:'WAIT',knownSide=['BUY','SELL'].includes(d.candidateAction)?d.candidateAction:['BUY','SELL'].includes(d.side)?d.side:execSide,status=String(d.status||'WAIT').toUpperCase(),reason=String(d.reason||''),money=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>0?'$'+Number(v).toFixed(2):'—';let stateLabel=status,stateAr='انتظار';if(reason.includes('تهدئة')){stateLabel='COOLDOWN';stateAr='تهدئة مؤقتة'}else if(reason.includes('خسارتين')||reason.includes('إيقاف هذا الاتجاه')||reason.includes('اكتمل الهدف الرابع')){stateLabel='BLOCKED';stateAr='الاتجاه موقوف مؤقتًا'}else if(status==='ACTIVE'){stateAr=execSide!=='WAIT'?'جاهز للتنفيذ الآن':'إشارة فعالة — انتظار نطاق الدخول'}else if(status==='MANAGING'){stateAr='إدارة صفقة قائمة'}else if(status==='CANDIDATE'){stateAr='مرشح للدخول'}else if(status==='STALE'){stateAr='بيانات قديمة'}else if(status==='COLLECTING'){stateAr='تجميع بيانات'}else if(status==='WAIT'){stateAr='لا يوجد دخول الآن'};let label='انتظار';if(knownSide==='BUY')label=execSide==='BUY'?'شراء الآن':status==='MANAGING'?'إدارة شراء':'شراء — '+stateAr;else if(knownSide==='SELL')label=execSide==='SELL'?'بيع الآن':status==='MANAGING'?'إدارة بيع':'بيع — '+stateAr;else label=stateAr;const showLevels=['ACTIVE','MANAGING','CANDIDATE'].includes(status)&&knownSide!=='WAIT';$('#btcAutoAction').textContent=label;$('#btcAutoAction').className=knownSide==='BUY'?'positive':knownSide==='SELL'?'negative':'WATCH';$('#btcAutoConfidence').textContent='الثقة '+Number(d.confidence||0)+'% • '+String(d.strategy||'BTC SCALP');$('#btcAutoStatus').textContent='الحالة: '+stateLabel+' • '+stateAr;$('#btcAutoRange').textContent=showLevels?money(d.entryLow)+' — '+money(d.entryHigh):'—';$('#btcAutoStop').textContent=showLevels?money(d.stopLoss):'—';$('#btcAutoTarget').textContent=showLevels?money(d.target1):'—';$('#btcAutoBadge').textContent=execSide!=='WAIT'?'تنفيذ BTC الآن':status==='MANAGING'?'إدارة BTC':stateLabel==='COOLDOWN'?'BTC COOLDOWN':stateLabel==='BLOCKED'?'BTC BLOCKED':status==='STALE'?'بيانات قديمة':'BTC MT5 READY';$('#btcAutoNote').textContent=reason||'بانتظار إشارة تنفيذ فعلية للبيتكوين';}catch(error){$('#btcAutoBadge').textContent='غير متاح';$('#btcAutoStatus').textContent='الحالة: ERROR';$('#btcAutoNote').textContent=error.message}finally{btcAutoTradeLoading=false}}
`;
  source = replaceRequired(source, 'let autoTradeLoading=false;', client + 'let autoTradeLoading=false;', 'gold execution client');

  source = replaceRequired(
    source,
    'await Promise.all([loadGold(),loadBtc(),loadAutoTrade()]);',
    'await Promise.all([loadGold(),loadBtc(),loadAutoTrade(),loadBtcAutoTrade()]);',
    'startup loaders'
  );
  source = replaceRequired(
    source,
    'setInterval(loadAutoTrade,5000);',
    'setInterval(loadAutoTrade,5000);\n  setInterval(loadBtcAutoTrade,5000);',
    'execution refresh'
  );

  for (const marker of ['id="btcAutoAction"', 'id="btcAutoStatus"', 'asset=BTCUSD', 'loadBtcAutoTrade()', 'BTC COOLDOWN', 'BTC BLOCKED', 'setInterval(loadBtcAutoTrade,5000)']) {
    if (!source.includes(marker)) throw new Error('BTC auto UI patch failed: ' + marker);
  }
  return source;
}

fs.writeFileSync = function patchedWriteFileSync(path, data, ...args) {
  const p = String(path);
  if (!p.endsWith('/.runtime-server.mjs') && !p.endsWith('\\.runtime-server.mjs')) {
    return originalWriteFileSync(path, data, ...args);
  }
  const isBuffer = Buffer.isBuffer(data);
  const source = applyBtcAutoUi(isBuffer ? data.toString('utf8') : String(data));
  return originalWriteFileSync(path, isBuffer ? Buffer.from(source, 'utf8') : source, ...args);
};

syncBuiltinESMExports();
await import('./fast-warmup-start.js');
